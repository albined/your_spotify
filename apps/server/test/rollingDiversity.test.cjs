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

const DAY = 86400000;
const WINDOW = 7 * DAY;

function expectedDiversity(plays, timestamp, window = WINDOW) {
  const totals = new Map();
  for (const play of plays) {
    if (play.at >= timestamp - window && play.at < timestamp) {
      totals.set(play.artist, (totals.get(play.artist) ?? 0) + play.durationMs);
    }
  }
  const values = [...totals.values()];
  const total = values.reduce((sum, value) => sum + value, 0);
  return total
    ? total ** 2 / values.reduce((sum, value) => sum + value ** 2, 0)
    : 0;
}

test(
  "personal and competition diversity share adaptive windows and exact sample values",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel, UserModel } = require("../src/database/Models");
    const {
      getCompetitionInsights,
    } = require("../src/database/queries/competitionInsights");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `rolling_diversity_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      await UserModel.collection.insertOne({
        _id: owner,
        username: "Rolling",
        spotifyId: "rolling",
        settings: { timezone: "Europe/Stockholm", dateFormat: "default" },
      });
      const user = await UserModel.findById(owner);
      const start = Date.parse("2025-03-30T00:00:00Z");
      const plays = [
        { at: start - WINDOW - 1, artist: "expired", durationMs: 1e9 },
        { at: start - WINDOW, artist: "boundary", durationMs: 10800000 },
        { at: start - 10 * DAY, artist: "warm-up", durationMs: 3600000 },
        { at: start, artist: "new", durationMs: 1800000 },
        { at: start + DAY, artist: "new", durationMs: 1800000 },
        { at: start + 30 * DAY, artist: "later", durationMs: 600000 },
      ];
      let seed = 3197;
      for (let i = 0; i < 300; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        plays.push({
          at: start - 400 * DAY + Math.floor((seed / 2 ** 32) * 300 * DAY),
          artist: `artist-${i % 27}`,
          durationMs: 1000 + i * 1100,
        });
      }
      // Add a later phase well beyond the warm-up period and initial quiet spell.
      for (let i = 0; i < 100; i++)
        plays.push({
          at: start + (45 + i) * DAY + 1234,
          artist: `recent-${i % 11}`,
          durationMs: 180000,
        });
      await InfosModel.collection.insertMany([
        ...plays.map((play) => ({
          owner,
          id: play.artist,
          primaryArtistId: play.artist,
          played_at: new Date(play.at),
          durationMs: play.durationMs,
        })),
        {
          owner: other,
          primaryArtistId: "outsider",
          played_at: new Date(start),
          durationMs: 1e9,
        },
        {
          owner,
          primaryArtistId: "blocked",
          played_at: new Date(start - 5 * DAY),
          durationMs: 1e9,
          blacklistedBy: ["artist"],
        },
        {
          owner,
          primaryArtistId: "future",
          played_at: new Date("2099-01-01"),
          durationMs: 1e9,
        },
        ...[0, -1, NaN, Infinity, "1234"].map((durationMs) => ({
          owner,
          primaryArtistId: "invalid",
          played_at: new Date(start - 5 * DAY),
          durationMs,
        })),
      ]);
      const {
        getPersonalArtistDiversity,
      } = require("../src/database/queries/artistDiversity");
      const ids = [String(owner)];
      let sharedEnd;
      for (const [from, to] of [
        [start, start + 2 * DAY],
        [start, start + 31 * DAY],
        [start + 20 * DAY, start + 31 * DAY],
        [start - 500 * DAY, start + 200 * DAY],
        [start - 365 * DAY, start],
        [start - 5 * 365 * DAY, start],
        [start - 11 * 365 * DAY, start],
        [start + DAY + 1, start + 3 * DAY],
        [start + 400 * DAY, start + 431 * DAY],
      ]) {
        const data = await getCompetitionInsights(
          user,
          ids,
          new Date(from),
          new Date(to),
        );
        const personal = await getPersonalArtistDiversity(
          user,
          new Date(from),
          new Date(to),
        );
        assert.equal(personal.windowDays, data.windowDays);
        assert.deepEqual(
          personal.values,
          data.series[0].values.map((value) => value || null),
        );
        const series = data.series[0];
        assert.equal(series.values.length, data.count + 1);
        assert(data.count <= 200);
        for (let i = 0; i <= data.count; i++) {
          const timestamp = Math.min(data.end, data.start + i * data.width);
          const expected = expectedDiversity(
            plays,
            timestamp,
            data.windowDays * DAY,
          );
          assert(
            Math.abs(series.values[i] - expected) < 1e-9,
            `sample ${i} in ${from}..${to}: ${series.values[i]} vs ${expected}`,
          );
        }
        const selectedHours = plays
          .filter((play) => play.at >= from && play.at < to)
          .reduce((sum, play) => sum + play.durationMs / 3600000, 0);
        assert(
          Math.abs(
            series.hours.reduce((sum, value) => sum + value, 0) - selectedHours,
          ) < 1e-9,
        );
        if (to === start + 31 * DAY) {
          if (sharedEnd !== undefined)
            assert.equal(series.values.at(-1), sharedEnd);
          sharedEnd = series.values.at(-1);
        }
      }
      const beginning = await getCompetitionInsights(
        user,
        ids,
        new Date(start),
        new Date(start + DAY),
      );
      assert.equal(beginning.series[0].values[0], 1);
      // The left boundary is inclusive; one millisecond later that play expires.
      const afterBoundary = await getCompetitionInsights(
        user,
        ids,
        new Date(start + 1),
        new Date(start + DAY),
      );
      assert.equal(afterBoundary.series[0].values[0], 1);
      const quiet = await getCompetitionInsights(
        user,
        ids,
        new Date(start + 2 * DAY),
        new Date(start + 3 * DAY),
      );
      assert(quiet.series[0].values.some((value) => value > 0));
      assert.equal(
        quiet.series[0].hours.reduce((sum, value) => sum + value, 0),
        0,
      );
      const future = await getCompetitionInsights(
        user,
        ids,
        new Date("2098-01-01"),
        new Date("2100-01-01"),
      );
      assert(future.series[0].values.every((value) => value === 0));
      const current = await getCompetitionInsights(
        user,
        ids,
        new Date(start),
        new Date("2100-01-01"),
      );
      assert(current.end <= Date.now());
      assert.equal(current.series[0].values.at(-1), 0);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
