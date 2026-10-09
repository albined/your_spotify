const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb, serveRoutes } = require("./helpers.cjs");
const {
  sessionSections,
  sessionArtwork,
  sessionArtistBlocks,
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
  assert.equal(timeline.listened, 13 * minute);
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
  assert.equal(sessionSections([]).duration, 0);
  assert.equal(sessionSections([track("bad", 0, NaN)]).duration, 0);
});

test(
  "longest sessions rank by listening time without pauses, include the final song and return local artist metadata",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel, ArtistModel } = require("../src/database/Models");
    const {
      getLongestListeningSession,
    } = require("../src/database/queries/stats");
    await connectTestDb("session_bars");
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
        // Longest elapsed (21 minutes) but only 12 minutes of music.
        play(2000, 6),
        play(2015, 6),
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
        sessions.map((session) => session.listeningMs),
        [20 * minute, 12 * minute, 10 * minute],
      );
      assert.deepEqual(
        sessions.map((session) => session.distanceToLast.distance.length),
        [1, 2, 2],
      );
      assert.equal(sessions[0].artists[0].name, "Artist");
      for (const session of sessions) {
        const tracks = JSON.parse(
          JSON.stringify(
            session.distanceToLast.distance.map((row) => row.info),
          ),
        );
        assert.equal(sessionSections(tracks).listened, session.listeningMs);
      }
    } finally {
      await dropTestDb();
    }
  },
);

test(
  "session pages preserve global ranking, break ties by date and validate pagination",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      TrackModel,
      ArtistModel,
      UserModel,
    } = require("../src/database/Models");
    const { router } = require("../src/routes/spotify");
    await connectTestDb("session_pages");
    let server;
    try {
      const owner = new mongoose.Types.ObjectId();
      const start = new Date("2025-01-01");
      const end = new Date("2025-02-01");
      await UserModel.collection.insertOne({
        _id: owner,
        username: "Sessions",
        spotifyId: "sessions",
        settings: { timezone: "UTC", dateFormat: "default" },
      });
      await ArtistModel.collection.insertOne({
        id: "artist",
        name: "Artist",
        images: [],
      });
      await TrackModel.collection.insertOne({ id: "song", name: "Song" });
      const plays = [10, 90, 25, 25, 80, 5, 90, 70, 65, 40, 5, 3].map(
        (duration, index) => ({
          owner,
          id: "song",
          primaryArtistId: "artist",
          played_at: new Date(start.getTime() + index * 1440 * minute),
          durationMs: duration * minute,
        }),
      );
      await InfosModel.collection.insertMany(plays);
      const expected = [...plays].sort(
        (a, b) => b.durationMs - a.durationMs || a.played_at - b.played_at,
      );

      server = await serveRoutes((app) => app.use("/spotify", router));
      const base = `${server.base}/spotify/top/sessions`;
      const headers = { Cookie: server.cookie(owner) };
      const request = (pagination = {}) =>
        fetch(
          `${base}?${new URLSearchParams({
            start: start.toISOString(),
            end: end.toISOString(),
            ...pagination,
          })}`,
          { headers },
        );
      assert.equal((await fetch(base)).status, 401);
      assert.equal((await (await request()).json()).length, 5);

      const collected = [];
      for (const offset of [0, 5, 10, 12]) {
        const response = await request({ offset, limit: 6 });
        assert.equal(response.status, 200);
        const batch = await response.json();
        assert.deepEqual(
          batch.map((session) => ({
            duration: session.listeningMs,
            start: session.distanceToLast.distance[0].info.played_at,
          })),
          expected
            .slice(offset, offset + 6)
            .map((play) => ({
              duration: play.durationMs,
              start: play.played_at.toISOString(),
            })),
        );
        for (const session of batch) {
          assert.equal(session.artists[0].name, "Artist");
          assert.equal(session.full_tracks.song.name, "Song");
        }
        collected.push(...batch.slice(0, 5));
      }
      assert.equal(collected.length, 12);
      assert.equal(
        new Set(
          collected.map(
            (session) => session.distanceToLast.distance[0].info._id,
          ),
        ).size,
        12,
      );
      // An exact multiple of five needs no extra empty-page click.
      const exact = await request({
        end: plays[10].played_at.toISOString(),
        offset: 5,
        limit: 6,
      });
      assert.equal((await exact.json()).length, 5);
      for (const pagination of [
        { offset: -1 },
        { offset: 1.5 },
        { offset: Number.MAX_SAFE_INTEGER + 1 },
        { offset: "5bad" },
        { limit: 0 },
        { limit: 21 },
        { limit: 1.5 },
        { limit: "NaN" },
      ]) {
        assert.equal((await request(pagination)).status, 400);
      }
    } finally {
      if (server) await server.close();
      await dropTestDb();
    }
  },
);
