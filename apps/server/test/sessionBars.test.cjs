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
  sessionSections,
  sessionArtwork,
  sessionArtistBlocks,
  artistColor,
} = require("../../client/src/services/sessionBars");
const minute = 60000;
const track = (id, at, duration, artist = "a") => ({
  _id: id,
  id,
  primaryArtistId: artist,
  played_at: new Date(at * minute).toISOString(),
  durationMs: duration * minute,
});

test("session bars retain order, pauses, repeats, overlaps and a strict artwork budget", () => {
  const input = [
    track("3", 12, 4, "b"),
    track("1", 0, 5),
    track("2", 5, 5),
    track("4", 14, 1, "c"),
  ];
  const timeline = sessionSections(input);
  assert.equal(timeline.duration, 15 * minute);
  assert.deepEqual(timeline.sections, [
    { artist: "a", start: 0, end: 10 * minute, songs: 2 },
    { artist: "b", start: 12 * minute, end: 14 * minute, songs: 1 },
    { artist: "c", start: 14 * minute, end: 15 * minute, songs: 1 },
  ]);
  assert.equal(input[0]._id, "3");
  const repeated = sessionSections([
    track("1", 0, 1),
    track("2", 1, 1, "b"),
    track("3", 2, 1),
  ]);
  assert.deepEqual(
    repeated.sections.map((section) => section.artist),
    ["a", "b", "a"],
  );
  assert.deepEqual(sessionArtistBlocks(repeated), [
    { artist: "a", start: 0, end: 2 * minute, songs: 2 },
    { artist: "b", start: 2 * minute, end: 3 * minute, songs: 1 },
  ]);
  assert.equal(sessionArtistBlocks(timeline).at(-1).end, 13 * minute);
  const sections = Array.from({ length: 20 }, (_, i) => ({
    artist: String(i),
    start: i,
    end: i + 1,
    songs: 1,
  }));
  assert.equal(sessionArtwork(sections, 20, 800).size, 10);
  assert.equal(sessionArtwork(sections, 20, 300).size, 0);
  assert.equal(artistColor("a"), artistColor("a"));
  assert.notEqual(artistColor("a"), artistColor("b"));
  assert.equal(sessionSections([]).duration, 0);
  assert.equal(sessionSections([track("bad", 0, NaN)]).duration, 0);
});

test(
  "longest sessions include the final song when ranking and return local artist metadata",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel, ArtistModel } = require("../src/database/Models");
    const {
      getLongestListeningSession,
    } = require("../src/database/queries/stats");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `session_bars_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const start = new Date("2025-01-01");
      const end = new Date("2025-01-03");
      const play = (offset, duration, extra = {}) => ({
        owner,
        id: "song",
        primaryArtistId: "artist",
        durationMs: duration * minute,
        played_at: new Date(start.getTime() + offset * minute),
        ...extra,
      });
      await ArtistModel.collection.insertOne({
        id: "artist",
        name: "Artist",
        images: [],
      });
      await InfosModel.collection.insertMany([
        play(0, 20),
        play(1440, 5),
        play(1450, 5),
        play(2880, 999),
        play(30, 999, { blacklistedBy: ["artist"] }),
        play(60, 999, { owner: new mongoose.Types.ObjectId() }),
        play(30, -1),
        play(30, 1, { durationMs: "99999" }),
      ]);
      const sessions = await getLongestListeningSession(
        String(owner),
        start,
        end,
      );
      assert.deepEqual(
        sessions.map((session) => session.sessionLength),
        [20 * minute, 15 * minute],
      );
      assert.deepEqual(
        sessions.map((session) => session.distanceToLast.distance.length),
        [1, 2],
      );
      assert.equal(sessions[0].artists[0].name, "Artist");
      for (const session of sessions) {
        const tracks = JSON.parse(
          JSON.stringify(
            session.distanceToLast.distance.map((row) => row.info),
          ),
        );
        assert.equal(sessionSections(tracks).duration, session.sessionLength);
      }
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
