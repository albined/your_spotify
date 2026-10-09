const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb, serveRoutes } = require("./helpers.cjs");

test(
  "artist visibility filters main credits per owner and never changes saved plays",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      UserModel,
      InfosModel,
      ArtistModel,
      TrackModel,
      AlbumModel,
      ArtistGroupModel,
    } = require("../src/database/Models");
    const { statisticsFor } = require("../src/database/listeningDuration");
    const {
      getArtistDistribution,
    } = require("../src/database/queries/artistDistribution");
    const {
      getTopTimeline,
      getCompetitionTimeline,
    } = require("../src/database/queries/raceTimeline");
    const { getSongs } = require("../src/database/queries/user");
    const {
      getDetailListening,
    } = require("../src/database/queries/detailListening");
    const {
      getArtistTimeline,
    } = require("../src/database/queries/listeningTimeline");
    const {
      getBest,
      getRankOf,
      ItemType,
    } = require("../src/database/queries/stats");
    const {
      getCollaborativeBestSongs,
      getCollaborativeBestAlbums,
      getCollaborativeBestArtists,
      CollaborativeMode,
    } = require("../src/database/queries/collaborative");
    const {
      saveArtistGroup,
      invalidateArtistGroups,
    } = require("../src/database/queries/artistGroups");
    const {
      setArtistVisibility,
      removeArtistVisibility,
      getArtistVisibility,
    } = require("../src/database/queries/artistVisibility");
    const {
      up: migrate,
    } = require("../src/migrations/1790899200000-add_artist_visibility");
    const { router } = require("../src/routes/artistVisibility");
    await connectTestDb("artist_visibility");
    invalidateArtistGroups();
    let server;
    try {
      const a = new mongoose.Types.ObjectId(),
        b = new mongoose.Types.ObjectId();
      await UserModel.collection.insertMany(
        [a, b].map((_id, i) => ({
          _id,
          username: `Person ${i}`,
          spotifyId: `visibility-${i}`,
          publicToken: `visibility-public-${i}`,
          settings: {
            metricUsed: "duration",
            timezone: "UTC",
            dateFormat: "default",
            allowCompetitions: true,
            blacklistedArtists: [],
          },
        })),
      );
      await migrate();
      const user = await UserModel.findById(a);
      assert.deepEqual(user.settings.artistVisibility.toObject(), []);
      const start = new Date("2025-01-01"),
        end = new Date("2025-02-01");
      await ArtistModel.collection.insertMany(
        ["a", "b", "c"].map((id) => ({
          id,
          name: `Artist ${id}`,
          images: [],
          genres: [],
        })),
      );
      await AlbumModel.collection.insertMany(
        ["a", "b", "c"].map((id) => ({
          id: `album-${id}`,
          name: `Album ${id}`,
          artists: [id],
          images: [],
        })),
      );
      await TrackModel.collection.insertMany(
        ["a", "b", "c"].map((id) => ({
          id: `song-${id}`,
          name: `Song ${id}`,
          album: `album-${id}`,
          artists: id === "b" ? ["b", "a"] : [id],
          duration_ms: 180000,
        })),
      );
      const play = (owner, id, i) => ({
        owner,
        id: `song-${id}`,
        albumId: `album-${id}`,
        primaryArtistId: id,
        artistIds: id === "b" ? ["b", "a"] : [id],
        durationMs: 180000,
        listenedMs: 60000,
        played_at: new Date(start.getTime() + 1000 + i * 180000),
        provider: "spotify",
        sourceKeys: [`visibility:${owner}:${i}`],
      });
      await InfosModel.collection.insertMany([
        play(a, "a", 0),
        play(a, "a", 1),
        play(a, "b", 2),
        play(a, "c", 3),
        play(b, "a", 0),
      ]);
      const original = await InfosModel.find().sort({ _id: 1 }).lean();
      const totals = () =>
        statisticsFor(user).aggregate([
          { $match: { owner: a } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              time: { $sum: "$durationMs" },
            },
          },
        ]);
      const before = await totals();
      assert.equal(before[0].count, 4);
      await setArtistVisibility(a, "a", true);
      await migrate(); // Must not reset an existing preference.
      assert.equal((await getArtistVisibility(a))[0].hidden, true);
      assert.equal((await totals())[0].count, 2);
      assert.equal((await totals())[0].time, 120000);
      const songs = await getSongs(String(a), 0, 50, { start, end });
      assert.deepEqual(songs.map((row) => row.id).sort(), ["song-b", "song-c"]);
      const best = await getBest(ItemType.artist, user, start, end, 10, 0);
      assert.deepEqual(best.map((row) => row.artist.id).sort(), ["b", "c"]);
      assert.deepEqual(
        (await getRankOf(ItemType.track, user, "song-a")).results,
        [],
      );
      const distribution = await getArtistDistribution(user, start, end);
      assert.deepEqual(distribution.series.map((row) => row.id).sort(), [
        "b",
        "c",
      ]);
      assert(
        !(await getTopTimeline(user, start, end, "songs")).series.some(
          (row) => row.id === "song-a",
        ),
      );
      const race = await getCompetitionTimeline(
        user,
        [String(a), String(b)],
        start,
        end,
        "count",
      );
      const plays = (owner) =>
        race.series.find((row) => row.id === String(owner)).values.at(-1);
      assert.equal(plays(a), 2);
      assert.equal(plays(b), 1);
      // Opening an artist explicitly still shows their complete saved history.
      const detail = await getDetailListening(user, "artist", "a");
      assert.equal(
        detail.days.reduce((sum, day) => sum + day.hours, 0),
        2 / 60,
      );
      assert.equal((await getArtistTimeline(user, "a")).total.at(-1), 2 / 60);
      await ArtistGroupModel.init();
      const group = await saveArtistGroup({
        name: "Together",
        memberIds: ["a", "b"],
        imageArtistId: "a",
        enabled: true,
      });
      const grouped = await getArtistDistribution(user, start, end);
      assert.equal(
        grouped.series
          .find((row) => row.id === group.id)
          .bins.reduce((sum, [, hours]) => sum + hours, 0),
        1 / 60,
      );
      // Disabling retains the row, and restoring it brings every old listen back.
      await setArtistVisibility(a, "a", false);
      assert.equal((await getArtistVisibility(a)).length, 1);
      assert.deepEqual(await totals(), before);
      await setArtistVisibility(a, "a", true);
      await InfosModel.create(play(a, "a", 4));
      const withNewPlay = await InfosModel.find().sort({ _id: 1 }).lean();
      assert.equal(withNewPlay.length, original.length + 1);
      assert.equal((await totals())[0].count, 2);
      await removeArtistVisibility(a, "a");
      assert.equal((await totals())[0].count, 5);
      assert.deepEqual(await getArtistVisibility(a), []);
      // Concurrent writes must retain both selections, without duplicate rows.
      await Promise.all([
        setArtistVisibility(a, "a", true),
        setArtistVisibility(a, "b", true),
        setArtistVisibility(a, "a", true),
      ]);
      assert.equal((await getArtistVisibility(a)).length, 2);
      await setArtistVisibility(a, "c", true);
      assert.deepEqual(await totals(), []);
      assert.deepEqual(
        await getBest(ItemType.artist, user, start, end, 10, 0),
        [],
      );
      // A participant with no visible listens contributes zero to affinity.
      for (const getSharedBest of [
        getCollaborativeBestSongs,
        getCollaborativeBestAlbums,
        getCollaborativeBestArtists,
      ]) {
        const shared = await getSharedBest(
          [String(a), String(b)],
          start,
          end,
          CollaborativeMode.AVERAGE,
          10,
        );
        assert.equal(shared.length, 1);
        assert.equal(shared[0][`percent_${a}`], 0);
        assert.equal(shared[0][`percent_${b}`], 1);
        assert.equal(shared[0].average_percents, 0.5);
      }
      await Promise.all([
        removeArtistVisibility(a, "a"),
        removeArtistVisibility(a, "b"),
        removeArtistVisibility(a, "c"),
      ]);
      assert.deepEqual(
        await InfosModel.find().sort({ _id: 1 }).lean(),
        withNewPlay,
      );
      assert.deepEqual(
        (await UserModel.findById(a)).settings.blacklistedArtists,
        [],
      );

      server = await serveRoutes((app) =>
        app.use("/artist-visibility", router),
      );
      const base = `${server.base}/artist-visibility`;
      const headers = {
        Cookie: server.cookie(a),
        "Content-Type": "application/json",
      };
      assert.equal((await fetch(base)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/a?token=visibility-public-0`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hidden: true }),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await fetch(`${base}/a`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ hidden: "true" }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(`${base}/unknown`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ hidden: true }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(`${base}/a`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ hidden: true, owner: String(b) }),
          })
        ).status,
        204,
      );
      assert.deepEqual(await getArtistVisibility(b), []);
      assert.equal(
        (await (await fetch(base, { headers })).json())[0].name,
        "Artist a",
      );
      assert.equal(
        (await (await fetch(`${base}/search?query=Artist`, { headers })).json())
          .length,
        3,
      );
      assert.deepEqual(
        await (
          await fetch(`${base}/search?query=${encodeURIComponent(".*")}`, {
            headers,
          })
        ).json(),
        [],
      );
      assert.equal(
        (await fetch(`${base}/a`, { method: "DELETE", headers })).status,
        204,
      );
      assert.deepEqual(
        await InfosModel.find().sort({ _id: 1 }).lean(),
        withNewPlay,
      );
    } finally {
      if (server) await server.close();
      await dropTestDb();
      invalidateArtistGroups();
    }
  },
);
