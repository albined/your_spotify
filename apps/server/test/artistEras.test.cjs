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
const {
  selectEraArtists,
} = require("../src/database/queries/artistErasSelection");
const {
  heatmapIntensity,
} = require("../../client/src/services/listeningPatterns");
const HOUR = 3_600_000;
const globalId = (i) => `global-${String(i).padStart(2, "0")}`;
function fixtures() {
  const rows = [];
  for (let period = 0; period < 24; period++) {
    for (let i = 0; i < 40; i++) {
      rows.push({ artist: globalId(i), period, duration: (2 - i / 40) * HOUR });
    }
  }
  for (const period of [1, 2])
    rows.push({ artist: "phase-a", period, duration: 5 * HOUR });
  for (const period of [6, 7, 8])
    rows.push({ artist: "phase-b", period, duration: 3 * HOUR });
  rows.push({ artist: "one-off", period: 12, duration: 6 * HOUR });
  for (const period of [100, 101])
    rows.push({ artist: "quiet", period, duration: HOUR / 2 });
  return rows;
}

test("era choices include recurring favorites outside the top 30 while protecting overall favorites", () => {
  const selections = selectEraArtists(fixtures());
  assert.deepEqual(selections[10], [
    ...Array.from({ length: 5 }, (_, i) => globalId(i)),
    "phase-b",
    "phase-a",
    globalId(5),
    globalId(6),
    globalId(7),
  ]);
  assert.deepEqual(
    selections[20].slice(0, 10),
    Array.from({ length: 10 }, (_, i) => globalId(i)),
  );
  assert.equal(selections[20].length, 20);
  for (const limit of [10, 20]) {
    assert.equal(new Set(selections[limit]).size, limit);
    assert.ok(!selections[limit].includes("quiet"));
    assert.ok(!selections[limit].includes("one-off"));
  }
  assert.ok(selections[10].every((id) => selections[20].includes(id)));
  assert.deepEqual(selectEraArtists(fixtures().reverse()), selections);
});

test("empty and short ranges fall back to totals; ties are deterministic", () => {
  assert.deepEqual(selectEraArtists([]), { 10: [], 20: [] });
  const rows = ["z", "b", "a"].map((artist) => ({
    artist,
    period: 0,
    duration: HOUR,
  }));
  assert.deepEqual(selectEraArtists(rows), {
    10: ["a", "b", "z"],
    20: ["a", "b", "z"],
  });
  const quiet = Array.from({ length: 25 }, (_, i) => ({
    artist: globalId(i),
    period: i,
    duration: (60 - i) * 1000,
  }));
  assert.deepEqual(
    selectEraArtists(quiet)[10],
    Array.from({ length: 10 }, (_, i) => globalId(i)),
  );
});

test("row emphasis reveals smaller eras while keeping silence empty and other heatmaps globally scaled", () => {
  assert.equal(heatmapIntensity(0, 100, 10, 0.8), 0);
  assert.equal(heatmapIntensity(0, 0, 0, 0.8), 0);
  assert.equal(heatmapIntensity(100, 100, 100, 0.8), 1);
  const smallPeak = heatmapIntensity(1, 100, 1, 0.8);
  assert.ok(smallPeak > 0.8 && smallPeak < 1);
  assert.ok(heatmapIntensity(0.5, 100, 1, 0.8) < smallPeak);
  assert.equal(heatmapIntensity(1, 100, 1), heatmapIntensity(1, 100, 100));
});

test(
  "query considers the full library, preserves hours, and respects local months/weeks and filters",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { ArtistModel, InfosModel } = require("../src/database/Models");
    const { getArtistEras } = require("../src/database/queries/artistEras");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `artist_eras_test_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      const user = { _id: owner, settings: { timezone: "Europe/Stockholm" } };
      const start = new Date("2024-01-01T00:00:00Z");
      const end = new Date("2026-01-01T00:00:00Z");
      // Quiet periods go in the two months preceding the main fixture.
      const rows = fixtures().map((row) => ({
        ...row,
        period: row.period >= 100 ? row.period - 102 : row.period,
      }));
      const queryStart = new Date("2023-11-01T00:00:00Z");
      const plays = rows.map((row) => ({
        owner,
        primaryArtistId: row.artist,
        durationMs: row.duration,
        played_at: new Date(Date.UTC(2024, row.period, 15, 12)),
      }));
      const excluded = (artist, extra) => ({
        owner,
        primaryArtistId: artist,
        durationMs: 999 * HOUR,
        played_at: start,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        ...plays,
        excluded("blocked", { blacklistedBy: ["artist"] }),
        excluded("other-owner", { owner: other }),
        excluded("before", { played_at: new Date(queryStart.getTime() - 1) }),
        excluded("at-end", { played_at: end }),
        excluded("negative", { durationMs: -HOUR }),
        excluded("invalid", { durationMs: NaN }),
        excluded("zero", { durationMs: 0 }),
        excluded(null, {}),
        excluded("", {}),
      ]);
      await ArtistModel.collection.insertMany(
        [...new Set(rows.map((row) => row.artist))].map((id) => ({
          id,
          name: `Artist ${id}`,
          images: [{ url: `image-${id}` }],
        })),
      );
      const result = await getArtistEras(user, queryStart, end);
      assert.deepEqual(result.selections, selectEraArtists(rows));
      assert.equal(result.series.length, 20);
      assert.equal(result.count, 256);
      assert.equal(result.timezone, "Europe/Stockholm");
      assert.ok(
        result.selections[10].every((id) =>
          result.series.some((series) => series.id === id),
        ),
      );
      for (const series of result.series) {
        const expected = rows
          .filter((row) => row.artist === series.id)
          .reduce((sum, row) => sum + row.duration / HOUR, 0);
        const actual = series.bins.reduce((sum, [, hours]) => sum + hours, 0);
        assert.ok(Math.abs(actual - expected) < 1e-8);
        assert.equal(series.name, `Artist ${series.id}`);
        assert.equal(series.image, `image-${series.id}`);
        assert.ok(series.bins.every(([bin]) => bin >= 0 && bin < result.count));
      }
      // Narrowing the range removes phases that happened outside it.
      const narrow = await getArtistEras(user, new Date("2025-01-01"), end);
      assert.ok(!narrow.selections[20].some((id) => id.startsWith("phase-")));
      const empty = await getArtistEras(
        user,
        new Date("2026-02-01"),
        new Date("2026-03-01"),
      );
      assert.deepEqual(empty.series, []);
      assert.deepEqual(empty.selections, { 10: [], 20: [] });
      // Sunday-night UTC plays cross local Monday, including the DST change.
      // A UTC or monthly grouping would miss the phase's two top-three weeks.
      const weeklyOwner = new mongoose.Types.ObjectId();
      await InfosModel.collection.insertMany([
        ...Array.from({ length: 25 }, (_, i) => ({
          owner: weeklyOwner,
          primaryArtistId: globalId(i),
          durationMs: (4 + i / 100) * HOUR,
          played_at: new Date("2025-03-23T22:45:00Z"),
        })),
        ...["2025-03-23T23:30:00Z", "2025-03-30T22:30:00Z"].map((time) => ({
          owner: weeklyOwner,
          primaryArtistId: "weekly-phase",
          durationMs: HOUR,
          played_at: new Date(time),
        })),
      ]);
      const weekly = await getArtistEras(
        { ...user, _id: weeklyOwner },
        new Date("2025-03-17T00:00:00Z"),
        new Date("2025-04-07T00:00:00Z"),
      );
      assert.ok(weekly.selections[10].includes("weekly-phase"));
      assert.equal(
        weekly.series
          .find((series) => series.id === "weekly-phase")
          .bins.reduce((sum, [, h]) => sum + h, 0),
        2,
      );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
