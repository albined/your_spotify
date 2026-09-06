// From apps/server: TIMELINE_TEST_MONGO_URI=mongodb://127.0.0.1:27028
// node --test test/raceTimeline.test.cjs (use a disposable MongoDB 6+ server).
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
  cumulativeTimelinePoints,
} = require("../../client/src/services/listeningTimeline");

test("cumulative chart coordinates keep the start, end and silent plateaus", () => {
  const points = cumulativeTimelinePoints(
    { start: 0, end: 100, count: 4, width: 25 },
    [
      [0, 3, 3, 3, 7],
      [0, 0, 1, 1, 1],
    ],
  );
  assert.deepEqual(
    points.map((point) => point.timestamp),
    [0, 25, 50, 75, 100],
  );
  assert.deepEqual(
    points.map((point) => point.series0),
    [0, 3, 3, 3, 7],
  );
});

test(
  "top races and competition preserve rankings, unique counts and filters",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    for (const key of [
      "CLIENT_ENDPOINT",
      "API_ENDPOINT",
      "SPOTIFY_PUBLIC",
      "SPOTIFY_SECRET",
    ])
      process.env[key] ??= "race-test";
    const mongoose = require("mongoose");
    const {
      InfosModel,
      ArtistModel,
      AlbumModel,
      TrackModel,
      UserModel,
    } = require("../src/database/Models");
    const {
      getTopTimeline,
      getCompetitionTimeline,
    } = require("../src/database/queries/raceTimeline");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `race_test_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const friend = new mongoose.Types.ObjectId();
      const silent = new mongoose.Types.ObjectId();
      const stranger = new mongoose.Types.ObjectId();
      const user = {
        _id: owner,
        settings: { timezone: "Europe/Stockholm", metricUsed: "number" },
      };
      await UserModel.collection.insertMany([
        { _id: owner, username: "You", spotifyId: "you" },
        { _id: friend, username: "Friend", spotifyId: "friend" },
        { _id: silent, username: "Quiet", spotifyId: "quiet" },
      ]);
      const start = new Date("2025-01-01T00:00:00Z");
      const day = 86_400_000;
      const end = new Date(start.getTime() + 365 * day);
      const at = (days) => new Date(start.getTime() + days * day);
      const makePlay = (person, index, days, hours, extra = {}) => ({
        owner: person,
        primaryArtistId: `artist-${index}`,
        albumId: `album-${index}`,
        id: `song-${index}`,
        durationMs: hours * 3_600_000,
        played_at: at(days),
        ...extra,
      });
      const plays = Array.from({ length: 12 }, (_, index) =>
        makePlay(owner, index, index * 3, index + 1),
      );
      plays.push(makePlay(owner, 11, 100, 2));
      plays.push(makePlay(owner, 11, 200, 3));
      plays.push(
        makePlay(friend, 11, 10, 4),
        makePlay(friend, 11, 150, 5),
        makePlay(friend, 10, 200, 1),
      );
      plays.push(makePlay(owner, 11, -1, 999), makePlay(owner, 11, 365, 999));
      plays.push(makePlay(owner, 11, 50, 999, { blacklistedBy: ["artist"] }));
      plays.push(makePlay(stranger, 11, 50, 999));
      await InfosModel.collection.insertMany(plays);
      await ArtistModel.collection.insertMany(
        Array.from({ length: 12 }, (_, i) => ({
          id: `artist-${i}`,
          name: `Artist ${i}`,
          images: [{ url: `artist-image-${i}` }],
        })),
      );
      await AlbumModel.collection.insertMany(
        Array.from({ length: 12 }, (_, i) => ({
          id: `album-${i}`,
          name: `Album ${i}`,
          artists: [`artist-${i}`],
          images: [{ url: `album-image-${i}` }],
        })),
      );
      await TrackModel.collection.insertMany(
        Array.from({ length: 12 }, (_, i) => ({
          id: `song-${i}`,
          name: `Song ${i}`,
          album: `album-${i}`,
          artists: [`artist-${i}`],
        })),
      );
      for (const kind of ["songs", "albums", "artists"]) {
        const result = await getTopTimeline(user, start, end, kind);
        assert.equal(result.count, 200);
        assert.equal(result.timezone, "Europe/Stockholm");
        assert.equal(result.series.length, 10);
        assert.equal(result.series[0].id, `${kind.slice(0, -1)}-11`);
        assert.equal(result.series[0].hours.at(-1), 17);
        assert.equal(result.series[9].hours.at(-1), 3);
        assert.equal(
          result.series[0].images[0].url,
          kind === "artists" ? "artist-image-11" : "album-image-11",
        );
        if (kind !== "artists")
          assert.equal(result.series[0].subtitle, "Artist 11");
        for (const series of result.series) {
          assert.equal(series.hours.length, 201);
          assert.equal(series.hours[0], 0);
          assert.ok(
            series.hours.every(
              (value, i) => i === 0 || value >= series.hours[i - 1],
            ),
          );
        }
        const narrow = await getTopTimeline(user, at(0), at(2), kind);
        assert.equal(narrow.series.length, 1);
        assert.equal(narrow.series[0].id, `${kind.slice(0, -1)}-0`);
        assert.equal(narrow.series[0].hours.at(-1), 1);
        assert.equal(
          (await getTopTimeline(user, at(300), at(301), kind)).series.length,
          0,
        );
      }
      const expected = {
        hours: [83, 10, 0],
        count: [14, 3, 0],
        differentTracks: [12, 2, 0],
        differentArtists: [12, 2, 0],
      };
      const ids = [owner, friend, silent].map(String);
      for (const [metric, totals] of Object.entries(expected)) {
        const result = await getCompetitionTimeline(
          user,
          [...ids, ids[0]],
          start,
          end,
          metric,
        );
        assert.equal(result.series.length, 3); // Repeated participant IDs do not duplicate totals.
        assert.deepEqual(
          result.series.map((item) => item.values.at(-1)),
          totals,
        );
        assert.equal(result.count, 200);
        result.series.forEach((item) => {
          assert.equal(item.values[0], 0);
          assert.equal(item.values.length, 201);
          assert.ok(
            item.values.every(
              (value, i) => i === 0 || value >= item.values[i - 1],
            ),
          );
        });
        const filtered = await getCompetitionTimeline(
          user,
          ids,
          start,
          end,
          metric,
          "artist-11",
        );
        assert.deepEqual(
          filtered.series.map((item) => item.values.at(-1)),
          metric === "hours"
            ? [17, 9, 0]
            : metric === "count"
              ? [3, 2, 0]
              : [1, 1, 0],
        );
      }
      // A narrowed range restarts uniqueness at zero, even for an old favourite.
      const narrowed = await getCompetitionTimeline(
        user,
        ids,
        at(90),
        at(210),
        "differentTracks",
      );
      assert.deepEqual(
        narrowed.series.map((item) => item.values.at(-1)),
        [1, 2, 0],
      );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
