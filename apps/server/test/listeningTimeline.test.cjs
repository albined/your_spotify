// Run with: sh scripts/test-local.sh test/listeningTimeline.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb } = require("./helpers.cjs");
const {
  timelineBounds,
  denseHours,
  cumulativeHours,
  DAY_MS,
  HOUR_MS,
} = require("../src/database/queries/listeningTimelineTools");

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
      getArtistTimeline,
    } = require("../src/database/queries/listeningTimeline");
    await connectTestDb("timeline_test");
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
      // Remove the boundary fixture before testing lifetime results.
      await InfosModel.deleteOne({ owner, played_at: at(365) });
      const history = await getArtistTimeline(user, "a");
      assert.equal(history.total.length, 201);
      assert.equal(history.total[0], 0);
      assert.equal(history.total.at(-1), 17);
      assert.equal(history.albums[0].id, "album-a");
      assert.equal(history.albums[0].hours.at(-1), 11);
      assert.equal(history.songs[0].hours.at(-1), 11);
      assert.equal(history.milestones[0].hours, 10);
      assert.equal(
        history.milestones[0].date.toISOString(),
        at(6).toISOString(),
      );
      assert.ok(
        history.total.every(
          (value, i) => i === 0 || value >= history.total[i - 1],
        ),
      );
      assert.equal(await getArtistTimeline(user, "never-played"), null);
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
      await dropTestDb();
    }
  },
);
