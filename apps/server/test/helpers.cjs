// Shared setup for the server tests. Requiring this file lets a test load the
// TypeScript sources and gives the server the settings it will not start
// without, so every file runs the same way alone, together and in CI.
require("ts-node").register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: "Node16",
    moduleResolution: "Node16",
    target: "ES2022",
    esModuleInterop: true,
  },
});

for (const [name, value] of Object.entries({
  API_ENDPOINT: "http://127.0.0.1:8080",
  CLIENT_ENDPOINT: "http://127.0.0.1:3000",
  SPOTIFY_PUBLIC: "test",
  SPOTIFY_SECRET: "test",
})) {
  process.env[name] ??= value;
}

const mongoUri = process.env.TIMELINE_TEST_MONGO_URI;
// Every database a test creates carries this prefix, so a server that holds
// anything else can be recognised as not being a throwaway one.
const TEST_DB_PREFIX = "ystest_";
const testDbName = (name) =>
  `${TEST_DB_PREFIX}${name}_${Date.now()}_${process.pid}`;

async function refuseSharedServer(admin) {
  const { databases } = await admin.listDatabases({ nameOnly: true });
  const foreign = databases
    .map((database) => database.name)
    .filter(
      (name) =>
        !["admin", "config", "local"].includes(name) &&
        !name.startsWith(TEST_DB_PREFIX),
    );
  if (foreign.length) {
    throw new Error(
      `Refusing to run tests against a MongoDB server that holds other data (${foreign.join(", ")}). ` +
        "Use a throwaway one: pnpm --filter @your_spotify/server test:local",
    );
  }
}

async function connectTestDb(name) {
  const mongoose = require("mongoose");
  const { MongoClient } = require("mongodb");
  // Checked on its own connection: connecting the models already writes.
  const client = new MongoClient(mongoUri);
  try {
    await refuseSharedServer(client.db("admin").admin());
  } finally {
    await client.close();
  }
  await mongoose.connect(mongoUri, { dbName: testDbName(name) });
  return mongoose;
}

// An index build that is still running would recreate its collection after the
// database is dropped and leave an empty database behind.
function indexesBuilt() {
  const mongoose = require("mongoose");
  return Promise.allSettled(
    Object.values(mongoose.models).map((model) => model.init()),
  );
}

async function dropTestDb() {
  const mongoose = require("mongoose");
  await indexesBuilt();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

// Serves routers on a free local port, answering errors the way the app does,
// and signs login cookies the routes accept. Needs a connected test database.
async function serveRoutes(mount) {
  const express = require("express");
  const cookieParser = require("cookie-parser");
  const { sign } = require("jsonwebtoken");
  const { once } = require("node:events");
  const { PrivateDataModel } = require("../src/database/Models");
  const { ErrorTypeToHTTPCode } = require("../src/tools/errors/error");
  const secret = "server-test-only";
  await PrivateDataModel.create({ jwtPrivateKey: secret });
  const app = express();
  app.use(express.json(), cookieParser());
  mount(app);
  app.use((error, _req, res, _next) =>
    res.status(ErrorTypeToHTTPCode[error.type] ?? 500).send(error),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    cookie: (userId) =>
      `token=${sign({ userId: String(userId) }, secret, { expiresIn: "1h" })}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = {
  mongoUri,
  testDbName,
  refuseSharedServer,
  indexesBuilt,
  connectTestDb,
  dropTestDb,
  serveRoutes,
};
