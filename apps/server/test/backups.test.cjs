const assert = require("node:assert/strict");
const { test } = require("node:test");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, readdir, writeFile, rm } = require("node:fs/promises");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { MongoClient } = require("mongodb");
const {
  testDbName,
  refuseSharedServer,
  indexesBuilt,
} = require("./helpers.cjs");
const exec = promisify(execFile);

test(
  "backup restores to an isolated database and a failed dump releases the write lock",
  { skip: !process.env.BACKUP_TEST_MONGO_URI },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "listening-backup-test-"));
    const name = testDbName("backup_source");
    const restoredName = `${name}_restored`;
    const uri = process.env.BACKUP_TEST_MONGO_URI;
    process.env.MONGO_ENDPOINT = `${uri}/${name}`;
    process.env.BACKUPS_ENABLED = "true";
    process.env.BACKUP_DIR = dir;
    const { runBackup, backupStatus } = require("../src/tools/backups");
    const client = new MongoClient(uri);
    await client.connect();
    const originalPath = process.env.PATH;
    try {
      // The backup takes a write lock on the whole server.
      await refuseSharedServer(client.db("admin").admin());
      const db = client.db(name);
      await db.collection("infos").insertMany([
        { song: "a", listenedMs: 45000 },
        { song: "b", durationMs: 240000 },
      ]);
      const archive = await runBackup("import");
      await exec("mongorestore", [
        "--uri",
        uri,
        "--gzip",
        `--archive=${join(dir, archive)}`,
        `--nsFrom=${name}.*`,
        `--nsTo=${restoredName}.*`,
      ]);
      const records = await client
        .db(restoredName)
        .collection("infos")
        .find()
        .toArray();
      assert.equal(records.length, 2);
      assert.equal(records.find((r) => r.song === "a").listenedMs, 45000);
      const failBin = join(dir, "mongodump");
      await writeFile(failBin, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      process.env.PATH = `${dir}:${originalPath}`;
      await assert.rejects(runBackup("import"), /Database backup failed/);
      assert.equal((await backupStatus()).running, false);
      assert.ok((await backupStatus()).lastError);
      assert.notEqual(
        (await client.db("admin").command({ currentOp: 1 })).fsyncLock,
        true,
      );
      await db.collection("infos").insertOne({ song: "after-failure" });
      const mongoose = require("mongoose");
      await mongoose.connect(`${uri}/${name}`);
      try {
        const {
          UserModel,
          ImporterStateModel,
        } = require("../src/database/Models");
        const {
          prepareImport,
          runImporter,
        } = require("../src/tools/importers/importer");
        const user = await UserModel.create({
          username: "Backup test",
          spotifyId: "backup-test",
          settings: { dateFormat: "default" },
        });
        const input = join(dir, "history.json");
        await writeFile(
          input,
          JSON.stringify([
            {
              ts: "2024-01-01T12:00:45Z",
              ms_played: 45000,
              spotify_track_uri: "spotify:track:song",
              master_metadata_track_name: "Song",
              master_metadata_album_artist_name: "Artist",
            },
          ]),
        );
        const job = await prepareImport(user, "full-privacy", [input], "UTC");
        const count = await db.collection("infos").countDocuments();
        await runImporter(job._id.toString(), user);
        const failed = await ImporterStateModel.findById(job._id);
        assert.equal(failed.status, "failure");
        assert.equal(failed.current, 0);
        assert.match(failed.error, /backup failed/);
        assert.equal(await db.collection("infos").countDocuments(), count);
      } finally {
        await indexesBuilt();
        await mongoose.disconnect();
      }

      const files = await readdir(dir);
      assert.ok(files.includes(archive));
      assert.ok(!files.some((file) => file.endsWith(".partial")));
    } finally {
      process.env.PATH = originalPath;
      await client.db(name).dropDatabase();
      await client.db(restoredName).dropDatabase();
      await client.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
