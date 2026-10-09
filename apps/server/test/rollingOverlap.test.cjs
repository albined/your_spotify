const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb } = require("./helpers.cjs");
const { rollingOverlap } = require("../src/database/queries/artistDiversity");

const DAY = 86400000;

// What two people have in common over a window, straight from their plays.
function expectedOverlap(plays, first, second, timestamp, window) {
  const shares = [first, second].map((person) => {
    const totals = new Map();
    for (const play of plays) {
      if (
        play.person === person &&
        play.at >= timestamp - window &&
        play.at < timestamp
      )
        totals.set(
          play.artist,
          (totals.get(play.artist) ?? 0) + play.durationMs,
        );
    }
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
    return { total, totals };
  });
  if (!shares[0].total || !shares[1].total) return null;
  let shared = 0;
  for (const [artist, duration] of shares[0].totals)
    shared += Math.min(
      duration / shares[0].total,
      (shares[1].totals.get(artist) ?? 0) / shares[1].total,
    );
  return shared;
}

test("pairs share the smaller part of each artist as listening enters and leaves", () => {
  const change = (bucket, artist, durationMs) => ({
    bucket,
    artist,
    durationMs,
  });
  const pairs = rollingOverlap(3, [
    [change(1, "both", 60), change(1, "mine", 40), change(3, "both", -60)],
    [change(1, "both", 10), change(2, "theirs", 30)],
    [],
  ]);
  assert.deepEqual(
    pairs.map((pair) => pair.members),
    [
      [0, 1],
      [0, 2],
      [1, 2],
    ],
  );
  // Nothing yet, then 60% against 100%, 25%, and none once "both" has expired.
  assert.deepEqual(pairs[0].values, [null, 0.6, 0.25, 0]);
  assert.deepEqual(pairs[1].values, [null, null, null, null]);
  assert.deepEqual(pairs[2].values, [null, null, null, null]);
});

test(
  "competition overlap matches an independent calculation at every sample",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel, UserModel } = require("../src/database/Models");
    const {
      getCompetitionInsights,
    } = require("../src/database/queries/competitionInsights");
    await connectTestDb("rolling_overlap");
    try {
      const owners = Array.from(
        { length: 4 },
        () => new mongoose.Types.ObjectId(),
      );
      await UserModel.collection.insertMany(
        owners.map((_id, person) => ({
          _id,
          username: `Person ${person}`,
          spotifyId: `person-${person}`,
          settings: { timezone: "Europe/Stockholm", dateFormat: "default" },
        })),
      );
      const user = await UserModel.findById(owners[0]);
      const start = Date.parse("2025-03-30T00:00:00Z");
      const plays = [];
      let seed = 7919;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      // The third person only starts listening well into the first ranges.
      for (const [person, from, artists] of [
        [0, -400, 23],
        [1, -400, 17],
        [2, 12, 9],
      ])
        for (let i = 0; i < 400; i++)
          plays.push({
            person,
            at: start + Math.floor((from + random() * (460 - from)) * DAY),
            artist: `artist-${Math.floor(random() * artists)}`,
            durationMs: 60000 + Math.floor(random() * 240000),
          });
      await InfosModel.collection.insertMany([
        ...plays.map((play) => ({
          owner: owners[play.person],
          primaryArtistId: play.artist,
          played_at: new Date(play.at),
          durationMs: play.durationMs,
        })),
        {
          owner: owners[0],
          primaryArtistId: "artist-0",
          played_at: new Date(start - 5 * DAY),
          durationMs: 1e9,
          blacklistedBy: ["artist"],
        },
      ]);
      const trio = owners.slice(0, 3).map(String);
      for (const [from, to, windowDays] of [
        [start, start + 31 * DAY, 30],
        [start + 20 * DAY, start + 22 * DAY, 30],
        [start, start + 200 * DAY, 60],
        [start - 365 * DAY, start + 90 * DAY, 90],
        [start - 5 * 365 * DAY, start, 180],
      ]) {
        const data = await getCompetitionInsights(
          user,
          trio,
          new Date(from),
          new Date(to),
        );
        assert.equal(data.overlap.windowDays, windowDays);
        assert.deepEqual(
          data.overlap.pairs.map((pair) => pair.members),
          [
            [0, 1],
            [0, 2],
            [1, 2],
          ],
        );
        for (const pair of data.overlap.pairs) {
          assert.equal(pair.values.length, data.count + 1);
          for (let i = 0; i <= data.count; i++) {
            const timestamp = Math.min(data.end, data.start + i * data.width);
            const expected = expectedOverlap(
              plays,
              ...pair.members,
              timestamp,
              windowDays * DAY,
            );
            const actual = pair.values[i];
            assert(
              expected === null
                ? actual === null
                : Math.abs(actual - expected) < 1e-9,
              `sample ${i} of ${pair.members} in ${from}..${to}: ${actual} vs ${expected}`,
            );
          }
        }
        // The longer warm-up of the overlap leaves each person's own charts
        // as they are when that person is looked at alone.
        const alone = await getCompetitionInsights(
          user,
          [trio[1]],
          new Date(from),
          new Date(to),
        );
        assert.equal(alone.overlap, null);
        assert.deepEqual(Object.keys(data.series[1]).sort(), [
          "hours",
          "id",
          "name",
          "percentages",
          "values",
        ]);
        assert.equal(data.series[1].id, alone.series[0].id);
        // The two queries add up the same plays in a different order, so a
        // total can differ in its last digit.
        for (const key of ["values", "hours", "percentages"]) {
          const together = data.series[1][key];
          const single = alone.series[0][key];
          assert.equal(together.length, single.length);
          together.forEach((value, i) =>
            assert(
              value === null || single[i] === null
                ? value === single[i]
                : Math.abs(value - single[i]) < 1e-9,
              `${key} ${i} in ${from}..${to}: ${value} vs ${single[i]}`,
            ),
          );
        }
      }
      const pair = await getCompetitionInsights(
        user,
        trio.slice(0, 2),
        new Date(start),
        new Date(start + 31 * DAY),
      );
      assert.deepEqual(
        pair.overlap.pairs.map((item) => item.members),
        [[0, 1]],
      );
      // Four people are not compared pair by pair, and nor is a future range.
      assert.equal(
        (
          await getCompetitionInsights(
            user,
            owners.map(String),
            new Date(start),
            new Date(start + 31 * DAY),
          )
        ).overlap,
        null,
      );
      assert.equal(
        (
          await getCompetitionInsights(
            user,
            trio,
            new Date("2099-01-01"),
            new Date("2099-02-01"),
          )
        ).overlap,
        null,
      );
    } finally {
      await dropTestDb();
    }
  },
);
