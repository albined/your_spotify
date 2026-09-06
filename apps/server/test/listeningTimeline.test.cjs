// Run with: node --test test/listeningTimeline.test.cjs
// Integration cases require TIMELINE_TEST_MONGO_URI pointing to a disposable
// MongoDB 6+ server. Each run creates and drops its own uniquely named database.
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
  timelineBounds,
  denseHours,
  cumulativeHours,
  DAY_MS,
  HOUR_MS,
} = require("../src/database/queries/listeningTimelineTools");

// The chart transformations are pure, even though they share a module with a hook.
const {
  distributionPoints,
  rollingDailyAverage,
} = require("../../client/src/services/listeningTimeline");

test("timelines keep long ranges detailed and preserve sparse totals", () => {
  const bounds = timelineBounds(new Date(0), new Date(365 * DAY_MS), 100);
  assert.equal(bounds.count, 100);
  assert.equal(bounds.width * bounds.count, 365 * DAY_MS);
  const hours = denseHours(bounds, [
    { _id: 0, duration: HOUR_MS },
    { _id: 99, duration: 2 * HOUR_MS },
  ]);
  const cumulative = cumulativeHours(hours);
  assert.equal(cumulative.length, 101);
  assert.equal(cumulative[0], 0);
  assert.equal(cumulative[50], 1);
  assert.equal(cumulative.at(-1), 3);
  assert.equal(timelineBounds(new Date(0), new Date(HOUR_MS), 100).count, 1);
});

test("share, cumulative and smoothing handle silent intervals without NaN", () => {
  const bounds = timelineBounds(new Date(0), new Date(3 * DAY_MS), 3);
  const result = {
    ...bounds,
    series: [{ hours: [1, 0, 2] }, { hours: [3, 0, 0] }],
  };
  const share = distributionPoints(result, "share", false);
  assert.equal(share[0].series0, 25);
  assert.equal(share[0].series1, 75);
  assert.equal(share[1].series0, 0);
  assert.equal(share[1].series1, 0);
  const cumulative = distributionPoints(result, "cumulative", true);
  assert.equal(cumulative[0].timestamp, bounds.start);
  assert.equal(cumulative.at(-1).timestamp, bounds.end);
  assert.equal(cumulative.at(-1).series0, 3);
  assert.equal(cumulative.at(-1).series1, 3);
  assert.deepEqual(rollingDailyAverage([2, 2, 2], DAY_MS), [2, 2, 2]);
  // A window beginning halfway through a bucket counts only the overlap.
  assert.equal(rollingDailyAverage([40, 0], 20 * DAY_MS)[1], 16 / 28);
});

test(
  "MongoDB timelines preserve totals, owner isolation, ranking and event dates",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    // Environment validation runs on import; placeholders keep tests offline.
    for (const key of [
      "CLIENT_ENDPOINT",
      "API_ENDPOINT",
      "SPOTIFY_PUBLIC",
      "SPOTIFY_SECRET",
    ]) {
      process.env[key] ??= "timeline-test";
    }
    const mongoose = require("mongoose");
    const {
      InfosModel,
      ArtistModel,
      AlbumModel,
      TrackModel,
    } = require("../src/database/Models");
    const {
      getListeningDistribution,
      getArtistTimeline,
    } = require("../src/database/queries/listeningTimeline");
    const dbName = `timeline_test_${Date.now()}_${process.pid}`;
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, { dbName });
    try {
      const owner = new mongoose.Types.ObjectId();
      const otherOwner = new mongoose.Types.ObjectId();
      const user = { _id: owner, settings: { timezone: "Europe/Stockholm" } };
      const start = new Date("2024-01-01T00:00:00Z");
      const at = (days) => new Date(start.getTime() + days * DAY_MS);
      const plays = [];
      function play(
        day,
        hours,
        artist = "a",
        album = "album-a",
        song = "song-a",
        extra = {},
      ) {
        plays.push({
          owner,
          played_at: at(day),
          durationMs: hours * HOUR_MS,
          primaryArtistId: artist,
          albumId: album,
          id: song,
          ...extra,
        });
      }
      play(-100, 1); // Existing favourite, before the distribution period.
      play(0, 4);
      play(6, 6, "a", "album-b", "song-b"); // Exactly ten hours in seven days.
      play(7, 3); // Day zero must be outside this seven-day window.
      play(29, 2);
      play(120, 1); // Rediscovery after 91 days.
      for (let i = 0; i < 6; i += 1)
        play(5, i + 1, `new-${i}`, `album-${i}`, `song-${i}`);
      play(5, 999, "blocked", "blocked", "blocked", {
        blacklistedBy: ["artist"],
      });
      play(5, 999, "a", "album-a", "song-a", { owner: otherOwner });
      play(365, 999); // Excluded at the selected end boundary.
      await InfosModel.collection.insertMany(plays);
      await ArtistModel.collection.insertMany([
        { id: "a", name: "Artist A", images: [] },
        ...Array.from({ length: 6 }, (_, i) => ({
          id: `new-${i}`,
          name: `New ${i}`,
          images: [],
        })),
      ]);
      await AlbumModel.collection.insertMany([
        { id: "album-a", name: "Album A", images: [] },
        { id: "album-b", name: "Album B", images: [] },
      ]);
      await TrackModel.collection.insertMany([
        { id: "song-a", name: "Song A", album: "album-a" },
        { id: "song-b", name: "Song B", album: "album-b" },
      ]);
      const distribution = await getListeningDistribution(user, start, at(365));
      assert.equal(distribution.count, 200);
      assert.equal(distribution.timezone, "Europe/Stockholm");
      assert.equal(
        distribution.totalHours.reduce((a, b) => a + b, 0),
        37,
      );
      assert.equal(
        distribution.newHours.reduce((a, b) => a + b, 0),
        21,
      );
      assert.equal(
        distribution.familiarHours.reduce((a, b) => a + b, 0),
        16,
      );
      assert.equal(distribution.series.length, 7);
      assert.equal(distribution.series[0].id, "a");
      assert.equal(distribution.series[1].id, "new-5");
      assert.equal(distribution.series.at(-1).id, "new-0");
      assert.ok(distribution.topFiveShare.some((value) => value === null));
      assert.ok(
        distribution.topFiveShare.some((value) => value > 0 && value < 1),
      );
      distribution.totalHours.forEach((total, i) => {
        assert.equal(
          distribution.series.reduce((sum, series) => sum + series.hours[i], 0),
          total,
        );
      });
      // Keep ten artist bands and preserve every remaining listen in the line.
      const extra = Array.from({ length: 30 }, (_, index) => ({
        owner,
        played_at: at(10),
        durationMs: HOUR_MS,
        primaryArtistId: `extra-${index}`,
        albumId: "extra",
        id: "extra",
      }));
      await InfosModel.collection.insertMany(extra);
      const expanded = await getListeningDistribution(user, start, at(365));
      assert.equal(expanded.series.length, 11);
      assert.equal(expanded.series.at(-1).id, "other");
      assert.equal(expanded.series.at(-1).lineOnly, true);
      assert.equal(
        expanded.series.reduce(
          (total, series) => total + series.hours.reduce((a, b) => a + b, 0),
          0,
        ),
        67,
      );
      assert.equal(
        expanded.totalHours.reduce((a, b) => a + b, 0),
        67,
      );
      await InfosModel.deleteMany({
        owner,
        primaryArtistId: { $in: extra.map((item) => item.primaryArtistId) },
      });
      // Remove the boundary fixture before testing lifetime results.
      await InfosModel.deleteOne({ owner, played_at: at(365) });
      const history = await getArtistTimeline(user, "a");
      assert.equal(history.total.length, 201);
      assert.equal(history.total[0], 0);
      assert.equal(history.total.at(-1), 17);
      assert.equal(history.albums[0].id, "album-a");
      assert.equal(history.albums[0].hours.at(-1), 11);
      assert.equal(history.songs[0].hours.at(-1), 11);
      assert.deepEqual(
        history.peaks.map((peak) => peak.hours),
        [10, 15],
      );
      assert.equal(history.peaks[0].end.toISOString(), at(6).toISOString());
      assert.equal(history.milestones[0].hours, 10);
      assert.equal(
        history.milestones[0].date.toISOString(),
        at(6).toISOString(),
      );
      assert.deepEqual(
        history.rediscoveries.map((event) => event.gapDays),
        [91, 100],
      );
      assert.ok(
        history.total.every(
          (value, i) => i === 0 || value >= history.total[i - 1],
        ),
      );
      assert.equal(await getArtistTimeline(user, "never-played"), null);
      const empty = await getListeningDistribution(user, at(200), at(201));
      assert.equal(empty.series.length, 0);
      assert.ok(empty.totalHours.every((value) => value === 0));
      // Explicit artist detail follows the existing inclusion of blacklisted artists.
      assert.equal(
        (await getArtistTimeline(user, "blocked")).total.at(-1),
        999,
      );
      await InfosModel.collection.insertMany(
        Array.from({ length: 6 }, (_, index) => ({
          owner,
          played_at: at(0),
          primaryArtistId: "ranking",
          albumId: `ranking-album-${index}`,
          id: `ranking-song-${index}`,
          durationMs: (index + 1) * HOUR_MS,
        })),
      );
      const ranked = await getArtistTimeline(user, "ranking");
      assert.equal(ranked.albums.length, 5);
      assert.equal(ranked.songs.length, 5);
      assert.equal(ranked.albums[0].id, "ranking-album-5");
      assert.equal(ranked.songs[0].id, "ranking-song-5");
      assert.equal(ranked.total.at(-1), 21);
      assert.equal(ranked.songs[0].name, "Unknown song");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
