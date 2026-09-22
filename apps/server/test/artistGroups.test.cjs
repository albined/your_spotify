const assert = require("node:assert/strict");
const { once } = require("node:events");
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

test(
  "reversible global artist groups agree across rankings, detail pages, eras, affinity and competitions",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      ArtistGroupModel,
      ArtistModel,
      TrackModel,
      AlbumModel,
      InfosModel,
      UserModel,
      PrivateDataModel,
      GlobalPreferencesModel,
    } = require("../src/database/Models");
    const { StatisticsInfosModel } = require("../src/database/StatisticsInfos");
    const {
      saveArtistGroup,
      deleteArtistGroup,
      getStatisticsArtists,
      invalidateArtistGroups,
    } = require("../src/database/queries/artistGroups");
    const {
      getArtistDistribution,
    } = require("../src/database/queries/artistDistribution");
    const { getArtistEras } = require("../src/database/queries/artistEras");
    const {
      getDetailListening,
    } = require("../src/database/queries/detailListening");
    const {
      getArtistTimeline,
      getListeningDistribution,
    } = require("../src/database/queries/listeningTimeline");
    const {
      getArtistActivity,
    } = require("../src/database/queries/listeningPatterns");
    const {
      getBest,
      ItemType,
      getRankOf,
      getLongestListeningSession,
    } = require("../src/database/queries/stats");
    const {
      getTopTimeline,
      getCompetitionArtists,
      getCompetitionTimeline,
    } = require("../src/database/queries/raceTimeline");
    const {
      getCompetitionInsights,
    } = require("../src/database/queries/competitionInsights");
    const {
      getCollaborativeBestArtists,
      CollaborativeMode,
    } = require("../src/database/queries/collaborative");
    const { getSongs } = require("../src/database/queries/user");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `artist_groups_${Date.now()}_${process.pid}`,
    });
    invalidateArtistGroups();
    let server;
    try {
      await ArtistGroupModel.init();
      const a = new mongoose.Types.ObjectId(),
        b = new mongoose.Types.ObjectId();
      const start = new Date("2025-01-01"),
        end = new Date("2025-01-31");
      await UserModel.collection.insertMany(
        [a, b].map((id, i) => ({
          _id: id,
          username: `Person ${i}`,
          spotifyId: `p${i}`,
          admin: i === 0,
          settings: {
            timezone: "Europe/Stockholm",
            nbElements: 1,
            metricUsed: "duration",
            dateFormat: "default",
          },
        })),
      );
      const user = await UserModel.findById(a);
      await ArtistModel.collection.insertMany(
        ["a", "b", "c", "d"].map((id) => ({
          id,
          name: `Artist ${id}`,
          images: [{ url: `https://example.test/${id}.png` }],
          genres: [id],
          type: "artist",
          uri: `spotify:artist:${id}`,
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
          artists: id === "a" ? ["a", "b"] : [id],
          album: `album-${id}`,
          duration_ms: 180000,
          disc_number: 1,
          track_number: 1,
        })),
      );
      const plays = [
        ...["a", "b", "a", "b", "a", "b", "c", "c", "c", "c"].map((id, i) => ({
          owner: a,
          id: `song-${id}`,
          albumId: `album-${id}`,
          primaryArtistId: id,
          artistIds: id === "a" ? ["a", "b"] : [id],
          durationMs: 180000,
          played_at: new Date(start.getTime() + 1000 + i * 180000),
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          owner: b,
          id: "song-b",
          albumId: "album-b",
          primaryArtistId: "b",
          artistIds: ["b"],
          durationMs: 180000,
          played_at: new Date(start.getTime() + 1000 + i * 180000),
        })),
      ];
      await InfosModel.collection.insertMany(plays);
      const original = await InfosModel.find().sort({ _id: 1 }).lean();
      const originalArtists = await ArtistModel.find().sort({ id: 1 }).lean();
      const before = await getArtistDistribution(user, start, end);
      assert.equal(before.series.length, 3);
      let saved = await saveArtistGroup({
        name: "Together",
        memberIds: ["a", "b"],
        imageArtistId: "b",
        enabled: true,
      });
      const id = saved.id;
      assert.equal((await getStatisticsArtists(["a", "b"]))[0].id, id);
      assert.equal(
        (await getStatisticsArtists([id]))[0].images[0].url,
        "https://example.test/b.png",
      );
      const after = await getArtistDistribution(user, start, end);
      assert.equal(after.series.length, 2);
      assert.equal(after.series[0].id, id);
      assert(
        Math.abs(
          after.series[0].bins.reduce((sum, [, h]) => sum + h, 0) - 0.3,
        ) < 1e-10,
      );
      const best = await getBest(ItemType.artist, user, start, end, 1, 0);
      assert.equal(best[0].artist.id, id);
      const rank = await getRankOf(ItemType.artist, user, "a");
      assert(rank);
      const eras = await getArtistEras(user, start, end);
      assert(eras.series.some((row) => row.id === id));
      assert(!eras.series.some((row) => ["a", "b"].includes(row.id)));
      const activity = await getArtistActivity(user, start, end);
      assert(JSON.stringify(activity).includes(id));
      const overall = await getListeningDistribution(user, start, end);
      assert(overall.series.some((row) => row.id === id));
      for (const alias of [id, "a", "b"]) {
        const detail = await getDetailListening(user, "artist", alias);
        assert(
          Math.abs(detail.days.reduce((sum, day) => sum + day.hours, 0) - 0.3) <
            1e-10,
        );
        assert.equal(detail.eras.albums.length, 2);
        assert.equal(detail.eras.songs.length, 2);
        const timeline = await getArtistTimeline(user, alias);
        assert(Math.abs(timeline.total.at(-1) - 0.3) < 1e-10);
      }
      const race = await getTopTimeline(user, start, end, "artists");
      assert.equal(race.series[0].id, id);
      const songs = await getTopTimeline(user, start, end, "songs");
      assert(
        songs.series
          .filter((row) => ["song-a", "song-b"].includes(row.id))
          .every((row) => row.subtitle === "Together"),
      );
      const people = [String(a), String(b)];
      const common = await getCompetitionArtists(people, start, end);
      assert.equal(common[0].id, id);
      assert(Math.abs(common[0].minimumHours - 0.15) < 1e-10);
      const competition = await getCompetitionTimeline(
        user,
        people,
        start,
        end,
        "hours",
        id,
      );
      assert(Math.abs(competition.series[0].values.at(-1) - 0.3) < 1e-10);
      const insights = await getCompetitionInsights(user, people, start, end);
      assert(Math.abs(insights.series[0].values.at(-1) - 100 / 52) < 1e-10);
      assert.equal(insights.series[1].values.at(-1), 1);
      const affinity = await getCollaborativeBestArtists(
        people,
        start,
        end,
        CollaborativeMode.MINIMA,
      );
      assert.equal(affinity[0].artist.id, id);
      const sessions = await getLongestListeningSession(String(a), start, end);
      assert.equal(
        sessions[0].artists.filter((artist) => artist.id === id).length,
        1,
      );
      const history = await getSongs(String(a), 0, 10, { start, end });
      assert(
        history
          .filter((row) => row.id === "song-a")
          .every(
            (row) =>
              row.track.full_artists.length === 1 &&
              row.track.full_artists[0].id === id,
          ),
      );
      const credited = await StatisticsInfosModel.aggregate([
        { $match: { owner: a, id: "song-a" } },
        { $project: { artistIds: 1 } },
      ]);
      assert.deepEqual(credited[0].artistIds, [id]);
      await assert.rejects(
        () =>
          saveArtistGroup({
            name: "Overlap",
            memberIds: ["b", "c"],
            imageArtistId: "b",
            enabled: true,
          }),
        (error) => error.type === "CONFLICT",
      );
      await assert.rejects(() =>
        saveArtistGroup({
          name: "Nested",
          memberIds: [id, "c"],
          imageArtistId: "c",
          enabled: true,
        }),
      );
      await assert.rejects(() =>
        saveArtistGroup({
          name: "Image",
          memberIds: ["c", "d"],
          imageArtistId: "a",
          enabled: true,
        }),
      );

      const express = require("express"),
        cookieParser = require("cookie-parser"),
        { sign } = require("jsonwebtoken");
      const { router } = require("../src/routes/artistGroups");
      const { router: artistRouter } = require("../src/routes/artist");
      const { ErrorTypeToHTTPCode } = require("../src/tools/errors/error");
      await PrivateDataModel.create({ jwtPrivateKey: "groups-test" });
      await GlobalPreferencesModel.create({ allowAffinity: true });
      const app = express();
      app.use(express.json(), cookieParser());
      app.use("/artist-groups", router);
      app.use("/artist", artistRouter);
      app.use((error, req, res, _next) =>
        res
          .status(ErrorTypeToHTTPCode[error.type] ?? 500)
          .json({ message: error.message }),
      );
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      const headers = (owner) => ({
        Cookie: `token=${sign({ userId: String(owner) }, "groups-test")}`,
        "Content-Type": "application/json",
      });
      assert.equal((await fetch(`${base}/artist-groups`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/artist-groups`, {
            method: "POST",
            headers: headers(b),
            body: JSON.stringify({}),
          })
        ).status,
        403,
      );
      const detailResponse = await fetch(`${base}/artist/a/stats`, {
        headers: headers(a),
      });
      assert.equal(detailResponse.status, 200);
      const detailJson = await detailResponse.json();
      assert.equal(detailJson.artist.id, id);
      assert.equal(detailJson.total.count, 6);
      const { searchTrack } = require("../src/database/queries/track");
      const { searchAlbum } = require("../src/database/queries/album");
      const { searchArtist } = require("../src/database/queries/artist");
      assert.equal((await searchTrack("Song a"))[0].full_artists[0].id, id);
      assert.equal((await searchTrack("Song a"))[0].full_artists.length, 1);
      assert.equal((await searchAlbum("Album b"))[0].full_artists[0].id, id);
      assert.equal((await searchArtist("Artist b"))[0].id, id);
      const uniqueRace = await getCompetitionTimeline(
        user,
        people,
        start,
        end,
        "differentArtists",
      );
      assert.equal(uniqueRace.series[0].values.at(-1), 2);
      assert.equal(
        (
          await fetch(`${base}/artist/blacklist/${id}`, {
            method: "POST",
            headers: headers(a),
          })
        ).status,
        204,
      );
      const blocked = await getArtistDistribution(user, start, end);
      assert(!blocked.series.some((row) => row.id === id));
      assert.equal(
        (await getDetailListening(user, "artist", id)).eras.songs.length,
        2,
      );
      assert.equal(
        (
          await fetch(`${base}/artist/unblacklist/${id}`, {
            method: "POST",
            headers: headers(a),
          })
        ).status,
        204,
      );
      assert.deepEqual(await getArtistDistribution(user, start, end), after);
      const { getTracks } = require("../src/database/queries/track");
      assert.deepEqual((await getTracks(["song-a"]))[0].artists, ["a", "b"]);
      for (const method of ["PUT", "DELETE"]) {
        assert.equal(
          (
            await fetch(`${base}/artist-groups/${id}`, {
              method,
              headers: headers(b),
              body: JSON.stringify({ ...saved }),
            })
          ).status,
          403,
        );
      }
      const nextOwner = new mongoose.Types.ObjectId();
      const nextPlay = await InfosModel.create({
        owner: nextOwner,
        id: "song-b",
        albumId: "album-b",
        primaryArtistId: "b",
        artistIds: ["b"],
        durationMs: 180000,
        played_at: new Date("2025-01-02"),
      });
      const fresh = await getArtistDistribution(
        { ...user.toObject(), _id: nextOwner },
        start,
        end,
      );
      assert.equal(fresh.series[0].id, id);
      assert.equal(
        (await InfosModel.findById(nextPlay._id)).primaryArtistId,
        "b",
      );
      await InfosModel.deleteOne({ _id: nextPlay._id });
      assert.equal(
        (
          await fetch(`${base}/artist-groups/search?query=Artist`, {
            headers: headers(a),
          })
        ).status,
        200,
      );
      const previousRevision = saved.revision;
      saved = await saveArtistGroup(
        {
          name: "Renamed",
          memberIds: ["a", "b"],
          imageArtistId: "a",
          enabled: false,
        },
        id,
        saved.revision,
      );
      await assert.rejects(
        () =>
          saveArtistGroup(
            {
              name: "Stale",
              memberIds: ["a", "b"],
              imageArtistId: "a",
              enabled: true,
            },
            id,
            previousRevision,
          ),
        (error) => error.type === "CONFLICT",
      );
      assert.deepEqual(await getArtistDistribution(user, start, end), before);
      saved = await saveArtistGroup(
        {
          name: "Renamed",
          memberIds: ["a", "d"],
          imageArtistId: "a",
          enabled: true,
        },
        id,
        saved.revision,
      );
      assert.equal((await getStatisticsArtists(["b"]))[0].id, "b");
      assert.equal((await getStatisticsArtists(["a"]))[0].name, "Renamed");
      await deleteArtistGroup(id, saved.revision);
      assert.deepEqual(await getArtistDistribution(user, start, end), before);
      assert.deepEqual(
        await InfosModel.find().sort({ _id: 1 }).lean(),
        original,
      );
      assert.deepEqual(
        await ArtistModel.find().sort({ id: 1 }).lean(),
        originalArtists,
      );
      const concurrent = await Promise.allSettled([
        saveArtistGroup({
          name: "One",
          memberIds: ["a", "c"],
          imageArtistId: "a",
          enabled: true,
        }),
        saveArtistGroup({
          name: "Two",
          memberIds: ["a", "d"],
          imageArtistId: "a",
          enabled: true,
        }),
      ]);
      assert.equal(
        concurrent.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        concurrent.find((result) => result.status === "rejected").reason.type,
        "CONFLICT",
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      invalidateArtistGroups();
    }
  },
);
