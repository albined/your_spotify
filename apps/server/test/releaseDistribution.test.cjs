const assert = require("node:assert/strict");
const { test } = require("node:test");
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
const { releaseYear } = require("../src/database/queries/releaseDistribution");
const {
  releaseMatrix,
} = require("../../client/src/services/releaseDistribution");

test("release dates accept Spotify precision and reject invalid dates", () => {
  assert.equal(releaseYear("1999"), 1999);
  assert.equal(releaseYear("2000-02"), 2000);
  assert.equal(releaseYear("2000-02-29"), 2000);
  assert.equal(releaseYear("1900-02-29"), null);
  assert.equal(releaseYear("2020-13-01"), null);
  assert.equal(releaseYear("unknown"), null);
});

test("release matrix coarsens columns while preserving every hour", () => {
  const data = {
    start: 0,
    end: 256 * 3600000,
    count: 256,
    width: 3600000,
    timezone: "Europe/Stockholm",
    totalPlays: 10,
    unknownPlays: 0,
    years: [],
    decades: [
      { decade: 1990, plays: 10, hours: Array.from({ length: 256 }, () => 1) },
      { decade: 2000, plays: 10, hours: Array.from({ length: 256 }, () => 2) },
    ],
  };
  const result = releaseMatrix(data, 390);
  assert.ok(result.columns <= 64);
  assert.ok(result.rows.every((row) => row.values.length === result.columns));
  assert.equal(
    result.rows[0].values.reduce((a, b) => a + b, 0),
    256,
  );
  assert.equal(
    result.rows[1].values.reduce((a, b) => a + b, 0),
    512,
  );
  assert.ok(result.rows.length * result.columns <= 480);
});

test("release matrix preserves an exact one percent decade", () => {
  const data = {
    start: 0,
    end: 4 * 3600000,
    count: 4,
    width: 3600000,
    timezone: "Europe/Stockholm",
    totalPlays: 100,
    unknownPlays: 0,
    years: [],
    decades: [
      { decade: 1920, plays: 1, hours: [1, 0, 0, 0] },
      { decade: 2020, plays: 99, hours: [0, 1, 0, 0] },
    ],
  };
  const result = releaseMatrix(data, 390);
  assert.equal(result.rows.length, 2);
});
