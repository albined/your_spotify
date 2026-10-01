const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, writeFile, rm, access } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
process.env.CLIENT_ENDPOINT = "http://127.0.0.1:3000";
process.env.API_ENDPOINT = "http://127.0.0.1:8080";
process.env.SPOTIFY_PUBLIC = "test";
process.env.SPOTIFY_SECRET = "test";
process.env.BACKUPS_ENABLED = "false";
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
  parseExportDate,
  readImportRecords,
} = require("../src/tools/importers/records");

test("export dates are timezone-independent and reject ambiguous DST dates", () => {
  assert.equal(
    parseExportDate("2024-01-01 12:30", "UTC").toISOString(),
    "2024-01-01T12:30:00.000Z",
  );
  assert.equal(
    parseExportDate("2024-01-01 12:30:00", "Europe/Stockholm").toISOString(),
    "2024-01-01T11:30:00.000Z",
  );
  assert.ok(
    Number.isNaN(
      parseExportDate("2024-10-27 02:30:00", "Europe/Stockholm").getTime(),
    ),
  );
  assert.ok(
    Number.isNaN(
      parseExportDate("2024-03-31 02:30:00", "Europe/Stockholm").getTime(),
    ),
  );
});

test("all export formats preserve durations, invalid values and short plays for reporting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "listening-formats-"));
  try {
    const full = join(dir, "full.json");
    const privacy = join(dir, "privacy.json");
    await writeFile(
      full,
      JSON.stringify([
        {
          ts: "2024-01-01T12:00:00Z",
          ms_played: 45000,
          spotify_track_uri: "spotify:track:abc",
          master_metadata_track_name: "Song",
          master_metadata_album_artist_name: "Artist",
        },
      ]),
    );
    await writeFile(
      privacy,
      JSON.stringify([
        {
          endTime: "2024-01-01 12:00",
          msPlayed: 45000,
          trackName: "Song",
          artistName: "Artist",
        },
      ]),
    );
    assert.equal(
      (await readImportRecords("full-privacy", [full]))[0].listenedMs,
      45000,
    );
    assert.equal(
      (await readImportRecords("privacy", [privacy]))[0].precisionMs,
      60000,
    );
    const XLSX = require("xlsx");
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(
        [76, -1, 12].map((time) => ({
          "Song Title": "Song",
          Artist: "Artist",
          ISRC: "abc",
          "Listening Time": time,
          Date: "2024-01-01 12:00:00",
        })),
      ),
      "10_listeningHistory",
    );
    const xlsx = join(dir, "deezer.xlsx");
    XLSX.writeFile(book, xlsx);
    const rows = await readImportRecords("deezer", [xlsx]);
    assert.deepEqual(
      rows.map((r) => r.listenedMs),
      [76000, null, 12000],
    );
    assert.equal(rows[0].provider, "deezer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Deezer timestamp collisions are identified before importing and ignore file order", async () => {
  const XLSX = require("xlsx");
  const dir = await mkdtemp(join(tmpdir(), "deezer-collisions-"));
  try {
    const source = [
      {
        "Song Title": "First",
        Artist: "Artist",
        ISRC: "FIRST",
        "Listening Time": 180,
        Date: "2020-12-12 16:11:27",
      },
      {
        "Song Title": "Second",
        Artist: "Artist",
        ISRC: "SECOND",
        "Listening Time": 210,
        Date: "2020-12-12 16:11:27",
      },
      {
        "Song Title": "Later",
        Artist: "Artist",
        ISRC: "LATER",
        "Listening Time": 180,
        Date: "2020-12-12 16:20:00",
      },
    ];
    const parsed = [];
    for (const rows of [source, [...source].reverse()]) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(rows),
        "10_listeningHistory",
      );
      const file = join(dir, "history.xlsx");
      XLSX.writeFile(book, file);
      parsed.push(
        (await readImportRecords("deezer", [file]))
          .map((r) => [r.key, !!r.ambiguous])
          .sort(),
      );
    }
    assert.deepEqual(parsed[0], parsed[1]);
    assert.equal(parsed[0].filter(([, conflict]) => conflict).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "imports reconcile live history, preserve play counts and resume durably",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async (t) => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      UserModel,
      TrackModel,
      ImporterStateModel,
    } = require("../src/database/Models");
    const {
      reconcileImport,
      hasLivePlay,
    } = require("../src/database/queries/importListening");
    const { statisticsFor } = require("../src/database/listeningDuration");
    const {
      prepareImport,
      runImporter,
      canUserImport,
    } = require("../src/tools/importers/importer");
    const {
      getListeningOverview,
    } = require("../src/database/queries/listeningOverview");
    const {
      listeningAccuracy,
    } = require("../src/database/queries/listeningAccuracy");
    const { longWriteDbLock } = require("../src/tools/lock");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `listening_imports_test_${Date.now()}`,
    });
    const dir = await mkdtemp(join(tmpdir(), "listening-imports-"));
    try {
      await InfosModel.init();
      const user = await UserModel.create({
        username: "Test",
        spotifyId: "test",
        settings: { dateFormat: "yyyy-MM-dd", timezone: "UTC" },
      });
      const track = {
        id: "song",
        duration_ms: 240000,
        artists: ["artist"],
        album: "album",
        name: "Song",
      };
      const other = { ...track, id: "other", name: "Other" };
      await TrackModel.create([track, other]);
      const row = (extra = {}) => ({
        key: "export1",
        source: "full-privacy",
        provider: "spotify",
        at: new Date("2024-01-01T12:00:45Z"),
        precisionMs: 1000,
        listenedMs: 45000,
        spotifyId: "song",
        title: "Song",
        artist: "Artist",
        ...extra,
      });
      const live = (extra = {}) => ({
        owner: user._id,
        id: "song",
        durationMs: 240000,
        albumId: "album",
        primaryArtistId: "artist",
        artistIds: ["artist"],
        played_at: new Date("2024-01-01T12:00:00Z"),
        provider: "spotify",
        ...extra,
      });
      await t.test(
        "API overlap is corrected in place; repeated and overlapping exports add nothing",
        async () => {
          const before = await InfosModel.create(live());
          assert.deepEqual(
            await reconcileImport(user, row(), track, "job1", 0),
            { outcome: "updated", deltaMs: -195000 },
          );
          assert.equal(await InfosModel.countDocuments(), 1);
          assert.equal(
            (await InfosModel.findById(before._id)).durationMs,
            240000,
          );
          assert.equal(
            (await InfosModel.findById(before._id)).listenedMs,
            45000,
          );
          assert.equal(
            (await reconcileImport(user, row(), track, "job2", 0)).outcome,
            "unchanged",
          );
          assert.equal(
            (
              await reconcileImport(
                user,
                row({
                  key: "account1",
                  source: "privacy",
                  precisionMs: 60000,
                  at: new Date("2024-01-01T12:00:00Z"),
                }),
                track,
                "job3",
                0,
              )
            ).outcome,
            "unchanged",
          );
          assert.equal(await InfosModel.countDocuments(), 1);
          assert.equal(
            await hasLivePlay(
              user._id,
              "song",
              new Date("2024-01-01T12:00:00Z"),
            ),
            true,
          );
          assert.equal(
            await hasLivePlay(
              user._id,
              "song",
              new Date("2024-01-01T12:00:45Z"),
            ),
            true,
          );
        },
      );
      await t.test(
        "known durations have priority, preferences affect only calculations",
        async () => {
          await reconcileImport(
            user,
            row({
              key: "account2",
              source: "privacy",
              precisionMs: 60000,
              listenedMs: 90000,
            }),
            track,
            "job4",
            0,
          );
          const total = async (u) =>
            (
              await statisticsFor(u).aggregate([
                { $match: { owner: user._id } },
                { $group: { _id: null, ms: { $sum: "$durationMs" } } },
              ])
            )[0].ms;
          assert.equal(await total(user), 45000);
          assert.equal(
            await total({ settings: { useFullSongDurations: true } }),
            240000,
          );
          assert.equal((await InfosModel.findOne()).durationMs, 240000);
          const overview = await getListeningOverview(
            user,
            new Date("2024-01-01"),
            new Date("2024-01-02"),
            "day",
          );
          assert.ok(
            Math.abs(
              overview.buckets.reduce((sum, b) => sum + b.hours, 0) -
                45000 / 3600000,
            ) < 1e-8,
          );
        },
      );
      await t.test(
        "distinct songs at the same timestamp and repeat listens survive",
        async () => {
          assert.equal(
            (
              await reconcileImport(
                user,
                row({ key: "other", spotifyId: "other", title: "Other" }),
                other,
                "job5",
                0,
              )
            ).outcome,
            "added",
          );
          assert.equal(
            (
              await reconcileImport(
                user,
                row({ key: "repeat", at: new Date("2024-01-01T12:01:30Z") }),
                track,
                "job5",
                1,
              )
            ).outcome,
            "added",
          );
          assert.equal(await InfosModel.countDocuments(), 3);
        },
      );
      await t.test("providers and accounts remain distinct", async () => {
        await reconcileImport(
          user,
          row({ key: "deezer1", provider: "deezer", source: "deezer" }),
          track,
          "job6",
          0,
        );
        const different = await UserModel.create({
          username: "Other",
          spotifyId: "other",
          settings: { dateFormat: "yyyy-MM-dd" },
        });
        await reconcileImport(different, row(), track, "job6", 1);
        assert.equal(await InfosModel.countDocuments(), 5);
      });
      await t.test(
        "ambiguous API candidates are held aside without insertion or correction",
        async () => {
          await InfosModel.create([
            live({ played_at: new Date("2024-01-02T12:00:00Z") }),
            live({ played_at: new Date("2024-01-02T12:00:45Z") }),
          ]);
          const before = await InfosModel.countDocuments();
          assert.equal(
            (
              await reconcileImport(
                user,
                row({ key: "ambiguous", at: new Date("2024-01-02T12:00:45Z") }),
                track,
                "job7",
                0,
              )
            ).outcome,
            "ambiguous",
          );
          assert.equal(await InfosModel.countDocuments(), before);
        },
      );
      await t.test(
        "write before checkpoint is replayable with the original outcome",
        async () => {
          const entry = row({
            key: "crash",
            at: new Date("2024-01-03T12:00:45Z"),
          });
          const first = await reconcileImport(user, entry, track, "job8", 0);
          assert.equal(first.outcome, "added");
          assert.deepEqual(
            await reconcileImport(user, entry, track, "job8", 0),
            first,
          );
          assert.equal(
            await InfosModel.countDocuments({ sourceKeys: "crash" }),
            1,
          );
        },
      );
      await t.test(
        "serialized live polling and import cannot both insert the same play",
        async () => {
          const date = new Date("2024-01-04T12:00:00Z");
          const entry = row({
            key: "concurrent",
            at: new Date("2024-01-04T12:00:45Z"),
          });
          const locked = async (fn) => {
            await longWriteDbLock.lock();
            try {
              return await fn();
            } finally {
              longWriteDbLock.unlock();
            }
          };
          await Promise.all([
            locked(() => reconcileImport(user, entry, track, "job9", 0)),
            locked(async () => {
              if (!(await hasLivePlay(user._id, "song", date)))
                await InfosModel.create(live({ played_at: date }));
            }),
          ]);
          assert.equal(
            await InfosModel.countDocuments({
              owner: user._id,
              played_at: { $gte: date, $lt: new Date("2024-01-05") },
            }),
            1,
          );
        },
      );
      await t.test(
        "minute-precision and extended exports match in either order",
        async () => {
          const count = await InfosModel.countDocuments();
          const standard = row({
            key: "minute-first",
            source: "privacy",
            precisionMs: 60000,
            at: new Date("2024-03-01T12:00:00Z"),
            listenedMs: 30000,
          });
          await reconcileImport(user, standard, track, "minute1", 0);
          assert.equal(
            (
              await reconcileImport(
                user,
                row({
                  key: "precise-second",
                  at: new Date("2024-03-01T12:00:59Z"),
                  listenedMs: 35000,
                }),
                track,
                "minute2",
                0,
              )
            ).outcome,
            "updated",
          );
          await reconcileImport(
            user,
            row({
              key: "precise-first",
              at: new Date("2024-03-01T12:02:59Z"),
              listenedMs: 35000,
            }),
            track,
            "minute3",
            0,
          );
          assert.equal(
            (
              await reconcileImport(
                user,
                {
                  ...standard,
                  key: "minute-second",
                  at: new Date("2024-03-01T12:02:00Z"),
                },
                track,
                "minute4",
                0,
              )
            ).outcome,
            "unchanged",
          );
          assert.equal(await InfosModel.countDocuments(), count + 2);
        },
      );
      await t.test(
        "retry after a failed checkpoint preserves counts and keeps the source file",
        async () => {
          const file = join(dir, "retry.json");
          await writeFile(
            file,
            JSON.stringify([
              {
                ts: "2024-04-01T12:00:45Z",
                ms_played: 45000,
                spotify_track_uri: "spotify:track:song",
                master_metadata_track_name: "Song",
                master_metadata_album_artist_name: "Artist",
              },
            ]),
          );
          const job = await prepareImport(user, "full-privacy", [file], "UTC");
          const count = await InfosModel.countDocuments();
          const update = ImporterStateModel.updateOne;
          let failed = false;
          ImporterStateModel.updateOne = function (filter, fields, ...args) {
            if (!failed && fields.current === 1) {
              failed = true;
              return Promise.reject(new Error("Injected checkpoint failure"));
            }
            return update.call(this, filter, fields, ...args);
          };
          try {
            await runImporter(job._id.toString(), user);
          } finally {
            ImporterStateModel.updateOne = update;
          }
          assert.equal(
            (await ImporterStateModel.findById(job._id)).status,
            "failure",
          );
          await access(file);
          assert.equal(await InfosModel.countDocuments(), count + 1);
          await runImporter(job._id.toString(), user);
          const result = await ImporterStateModel.findById(job._id);
          assert.equal(result.status, "success");
          assert.equal(result.summary.added, 1);
          assert.equal(result.summary.deltaMs, 45000);
          assert.equal(await InfosModel.countDocuments(), count + 1);
        },
      );
      await t.test(
        "a failed grouped checkpoint replays skipped rows without losing counts",
        async () => {
          const file = join(dir, "grouped.json");
          const source = Array.from({ length: 101 }, (_, index) => ({
            ts: new Date(Date.UTC(2024, 7, 1, 0, index)).toISOString(),
            ms_played: index < 100 ? 12000 : 45000,
            spotify_track_uri: "spotify:track:song",
            master_metadata_track_name: "Song",
            master_metadata_album_artist_name: "Artist",
          }));
          await writeFile(file, JSON.stringify(source));
          const job = await prepareImport(user, "full-privacy", [file], "UTC");
          const update = ImporterStateModel.updateOne;
          ImporterStateModel.updateOne = function (filter, fields, ...args) {
            if (fields.current === 100)
              return Promise.reject(
                new Error("Injected grouped checkpoint failure"),
              );
            return update.call(this, filter, fields, ...args);
          };
          try {
            await runImporter(String(job._id), user);
          } finally {
            ImporterStateModel.updateOne = update;
          }
          assert.equal((await ImporterStateModel.findById(job._id)).current, 0);
          await runImporter(String(job._id), user);
          const result = await ImporterStateModel.findById(job._id);
          assert.equal(result.status, "success");
          assert.equal(result.summary.short, 100);
          assert.equal(result.summary.added, 1);
          const before = await InfosModel.find().sort({ _id: 1 }).lean();
          await writeFile(file, JSON.stringify(source));
          const repeat = await prepareImport(
            user,
            "full-privacy",
            [file],
            "UTC",
          );
          await runImporter(String(repeat._id), user);
          const repeated = await ImporterStateModel.findById(repeat._id);
          assert.equal(repeated.summary.unchanged, 1);
          assert.equal(repeated.summary.short, 100);
          assert.deepEqual(
            await InfosModel.find().sort({ _id: 1 }).lean(),
            before,
          );
        },
      );
      await t.test(
        "a changed source file is rejected before modifying history",
        async () => {
          const file = join(dir, "changed.json");
          const data = [
            {
              ts: "2024-05-01T12:00:45Z",
              ms_played: 45000,
              spotify_track_uri: "spotify:track:song",
              master_metadata_track_name: "Song",
              master_metadata_album_artist_name: "Artist",
            },
          ];
          await writeFile(file, JSON.stringify(data));
          const job = await prepareImport(user, "full-privacy", [file], "UTC");
          const count = await InfosModel.countDocuments();
          data[0].ms_played = 50000;
          await writeFile(file, JSON.stringify(data));
          await runImporter(job._id.toString(), user);
          assert.equal(
            (await ImporterStateModel.findById(job._id)).status,
            "failure",
          );
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "migration preserves existing preferences and duration data",
        async () => {
          const {
            up,
          } = require("../src/migrations/1790592000000-add_listening_durations");
          await UserModel.updateOne(
            { _id: user._id },
            { "settings.useFullSongDurations": true },
          );
          const before = await InfosModel.find().sort({ _id: 1 }).lean();
          await up();
          await up();
          assert.equal(
            (await UserModel.findById(user._id)).settings.useFullSongDurations,
            true,
          );
          assert.deepEqual(
            await InfosModel.find().sort({ _id: 1 }).lean(),
            before,
          );
        },
      );
      await t.test(
        "import routes protect ownership and the duration preference persists",
        async () => {
          const express = require("express");
          const cookieParser = require("cookie-parser");
          const { sign } = require("jsonwebtoken");
          const { once } = require("node:events");
          const { PrivateDataModel } = require("../src/database/Models");
          const { router: importRouter } = require("../src/routes/importer");
          const { router: settingsRouter } = require("../src/routes/index");
          const { ErrorTypeToHTTPCode } = require("../src/tools/errors/error");
          await PrivateDataModel.create({ jwtPrivateKey: "import-test-only" });
          const app = express();
          app.use(express.json(), cookieParser(), importRouter, settingsRouter);
          app.use((err, req, res, _next) =>
            res.status(ErrorTypeToHTTPCode[err.type] ?? 500).end(),
          );
          const server = app.listen(0, "127.0.0.1");
          await once(server, "listening");
          const base = `http://127.0.0.1:${server.address().port}`;
          const token = sign({ userId: String(user._id) }, "import-test-only");
          const headers = {
            Cookie: `token=${token}`,
            "Content-Type": "application/json",
          };
          try {
            assert.equal((await fetch(`${base}/imports`)).status, 401);
            assert.equal(
              (await fetch(`${base}/imports/backups`, { headers })).status,
              403,
            );
            assert.equal(
              (
                await fetch(`${base}/settings`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ useFullSongDurations: false }),
                })
              ).status,
              200,
            );
            assert.equal(
              (await UserModel.findById(user._id)).settings
                .useFullSongDurations,
              false,
            );
            assert.equal(
              (
                await fetch(`${base}/settings`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ useFullSongDurations: "false" }),
                })
              ).status,
              400,
            );
            const foreign = await ImporterStateModel.create({
              user: new mongoose.Types.ObjectId(),
              type: "privacy",
              total: 1,
              status: "ready",
              metadata: [],
            });
            assert.equal(
              (
                await fetch(`${base}/import/start`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    existingStateId: String(foreign._id),
                  }),
                })
              ).status,
              404,
            );
            assert.equal(
              (
                await fetch(`${base}/import/clean/${foreign._id}`, {
                  method: "DELETE",
                  headers,
                })
              ).status,
              404,
            );
            const data = new FormData();
            data.append(
              "imports",
              new Blob(
                [
                  JSON.stringify([
                    {
                      endTime: "2024-06-01 12:00",
                      trackName: "Song",
                      artistName: "Artist",
                      msPlayed: 45000,
                    },
                  ]),
                ],
                { type: "application/json" },
              ),
              "history.json",
            );
            const result = await fetch(`${base}/import/privacy`, {
              method: "POST",
              headers: { Cookie: `token=${token}` },
              body: data,
            });
            assert.equal(result.status, 200);
            const prepared = await result.json();
            assert.equal(prepared.code, "IMPORT_READY");
            const jobs = await (
              await fetch(`${base}/imports`, { headers })
            ).json();
            assert.ok(
              jobs.every(
                (job) => !job.metadata && String(job.user) === String(user._id),
              ),
            );
            assert.equal(
              (
                await fetch(`${base}/import/clean/${prepared.id}`, {
                  method: "DELETE",
                  headers,
                })
              ).status,
              204,
            );
          } finally {
            await new Promise((resolve) => server.close(resolve));
          }
        },
      );
      await t.test(
        "extended-history resolution batches metadata and reuses local tracks",
        async () => {
          const { SpotifyAPI } = require("../src/tools/apis/spotifyApi");
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const { AlbumModel, ArtistModel } = require("../src/database/Models");
          await AlbumModel.updateOne(
            { id: "album" },
            { $setOnInsert: { id: "album", artists: ["artist"] } },
            { upsert: true },
          );
          await ArtistModel.updateOne(
            { id: "artist" },
            { $setOnInsert: { id: "artist", name: "Artist" } },
            { upsert: true },
          );
          const original = SpotifyAPI.prototype.getTracks;
          const calls = [];
          SpotifyAPI.prototype.getTracks = async (ids) => {
            calls.push(ids.length);
            return ids.map((id) => ({
              ...track,
              id,
              album: { id: "album" },
              artists: [{ id: "artist", name: "Artist" }],
            }));
          };
          try {
            const rows = Array.from({ length: 100 }, (_, i) =>
              row({ spotifyId: `batch${i % 50}` }),
            );
            const resolver = new ImportResolver(String(user._id));
            await resolver.prefetch(rows);
            await resolver.prefetch(rows);
            for (const item of rows)
              assert.equal((await resolver.resolve(item)).id, item.spotifyId);
            assert.deepEqual(calls, [45, 5]);
          } finally {
            SpotifyAPI.prototype.getTracks = original;
          }
        },
      );
      await t.test(
        "release IDs with one ISRC correct the original play without duplicating it",
        async () => {
          const oldRelease = {
            ...track,
            id: "old-release",
            name: "Recording",
            external_ids: { isrc: "TESTRECORDING" },
          };
          const newRelease = {
            ...oldRelease,
            id: "new-release",
            album: "single",
          };
          await TrackModel.create([oldRelease, newRelease]);
          const at = new Date("2024-07-01T12:00:00Z");
          const original = await InfosModel.create(
            live({ id: oldRelease.id, played_at: at, provider: undefined }),
          );
          const count = await InfosModel.countDocuments();
          const entry = row({
            key: "recording-key",
            source: "deezer",
            provider: "deezer",
            spotifyId: undefined,
            isrc: "TESTRECORDING",
            title: "Recording",
            at,
          });
          assert.equal(
            (await reconcileImport(user, entry, newRelease, "recording-job", 0))
              .outcome,
            "updated",
          );
          const corrected = await InfosModel.findById(original._id);
          assert.equal(corrected.id, oldRelease.id);
          assert.equal(corrected.listenedMs, 45000);
          assert.equal(corrected.durationMs, oldRelease.duration_ms);
          assert.equal(await InfosModel.countDocuments(), count);
          assert.equal(
            (
              await reconcileImport(
                user,
                entry,
                newRelease,
                "recording-repeat",
                0,
              )
            ).outcome,
            "unchanged",
          );
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "overlapping exports with changed track labels keep the same recording event",
        async () => {
          const release = await TrackModel.findOne({
            id: "new-release",
          }).lean();
          const count = await InfosModel.countDocuments();
          const entry = row({
            key: "renamed-export-key",
            source: "deezer",
            provider: "deezer",
            spotifyId: undefined,
            isrc: "TESTRECORDING",
            title: "RECORDING",
            at: new Date("2024-07-01T12:00:00Z"),
            listenedMs: 50000,
          });
          assert.equal(
            (await reconcileImport(user, entry, release, "renamed-job", 0))
              .outcome,
            "updated",
          );
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "distinct precise timestamps are not collapsed by the timing tolerance",
        async () => {
          const count = await InfosModel.countDocuments();
          await reconcileImport(
            user,
            row({ key: "precise-a", at: new Date("2024-09-01T12:00:00.100Z") }),
            track,
            "precise-job",
            0,
          );
          await reconcileImport(
            user,
            row({ key: "precise-b", at: new Date("2024-09-01T12:00:00.600Z") }),
            track,
            "precise-job",
            1,
          );
          assert.equal(await InfosModel.countDocuments(), count + 2);
        },
      );
      await t.test(
        "live polling recognizes an imported Spotify recording under another release ID",
        async () => {
          const oldRelease = await TrackModel.findOne({
            id: "old-release",
          }).lean();
          const at = new Date("2024-07-10T12:00:45Z");
          await reconcileImport(
            user,
            row({
              key: "spotify-release-alias",
              at,
              spotifyId: oldRelease.id,
              title: oldRelease.name,
            }),
            oldRelease,
            "spotify-release-job",
            0,
          );
          assert.equal(
            await hasLivePlay(
              user._id,
              "new-release",
              new Date("2024-07-10T12:00:00Z"),
              "TESTRECORDING",
            ),
            true,
          );
          assert.equal(
            await hasLivePlay(
              user._id,
              "new-release",
              new Date("2024-07-10T12:10:00Z"),
              "TESTRECORDING",
            ),
            false,
          );
          assert.equal(
            await hasLivePlay(
              user._id,
              "new-release",
              new Date("2024-07-01T12:00:00Z"),
              "TESTRECORDING",
            ),
            false,
          ); // Deezer event remains separate.
        },
      );
      await t.test(
        "case variants of a title without confirmed recording identity are held aside",
        async () => {
          const unknown = {
            ...track,
            id: "unknown-release",
            name: "Uncertain recording",
          };
          const alternate = {
            ...unknown,
            id: "alternate-release",
            name: "UNCERTAIN RECORDING",
            external_ids: { isrc: "ANOTHERRECORDING" },
          };
          await TrackModel.create([unknown, alternate]);
          const at = new Date("2024-07-02T12:00:00Z");
          const original = await InfosModel.create(
            live({ id: unknown.id, played_at: at, provider: undefined }),
          );
          const count = await InfosModel.countDocuments();
          const entry = row({
            key: "uncertain-recording",
            source: "deezer",
            provider: "deezer",
            spotifyId: undefined,
            isrc: "ANOTHERRECORDING",
            title: unknown.name,
            at,
          });
          assert.equal(
            (
              await reconcileImport(
                user,
                entry,
                alternate,
                "uncertain-recording-job",
                0,
              )
            ).outcome,
            "ambiguous",
          );
          assert.equal(
            (await InfosModel.findById(original._id)).listenedMs,
            undefined,
          );
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "legacy Deezer timestamp collisions with unknown identity are not inserted",
        async () => {
          const at = new Date("2024-07-03T12:00:00Z");
          await InfosModel.create(
            live({
              id: "wrong-old-mapping",
              played_at: at,
              provider: undefined,
            }),
          );
          const count = await InfosModel.countDocuments();
          const entry = row({
            key: "legacy-collision",
            source: "deezer",
            provider: "deezer",
            at,
          });
          assert.equal(
            (
              await reconcileImport(
                user,
                entry,
                track,
                "legacy-collision-job",
                0,
              )
            ).outcome,
            "ambiguous",
          );
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "fetched recording metadata enriches old tracks without replacing release details",
        async () => {
          const {
            getTracksAlbumsArtists,
            storeTrackAlbumArtist,
            storeRecordingIds,
          } = require("../src/spotify/dbTools");
          const original = {
            ...track,
            id: "enrich-existing",
            name: "Original release title",
          };
          await TrackModel.create(original);
          const fetched = {
            ...original,
            name: "New title",
            duration_ms: 999999,
            external_ids: { isrc: "enrichedisrc" },
            album: { id: "other-album" },
            artists: [{ id: "other-artist", name: "Different metadata" }],
          };
          await storeTrackAlbumArtist(
            await getTracksAlbumsArtists(String(user._id), [fetched]),
          );
          const saved = await TrackModel.findOne({ id: original.id }).lean();
          assert.equal(saved.external_ids.isrc, "ENRICHEDISRC");
          assert.equal(saved.name, original.name);
          assert.equal(saved.duration_ms, original.duration_ms);
          assert.equal(saved.album, original.album);
          await storeRecordingIds([
            { id: original.id, external_ids: { isrc: "CONFLICTING" } },
          ]);
          assert.equal(
            (await TrackModel.findOne({ id: original.id })).external_ids.isrc,
            "ENRICHEDISRC",
          );
        },
      );
      await t.test(
        "Deezer legacy metadata is fetched once per catalog track and confirms old releases",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const { SpotifyAPI } = require("../src/tools/apis/spotifyApi");
          const older = {
            ...track,
            id: "refresh-legacy",
            name: "Legacy title",
          };
          const newer = {
            ...older,
            id: "refresh-alternate",
            external_ids: { isrc: "REFRESHISRC" },
          };
          await TrackModel.create([older, newer]);
          const at = new Date("2024-10-01T12:00:00Z");
          const play = await InfosModel.create(
            live({ id: older.id, played_at: at, provider: undefined }),
          );
          const entry = row({
            source: "deezer",
            provider: "deezer",
            spotifyId: undefined,
            key: "refresh-row",
            title: older.name,
            isrc: "REFRESHISRC",
            at,
          });
          const identity = new ImportContext();
          assert.ok(
            (await identity.matchingTracks(entry, newer)).uncertain.includes(
              older.id,
            ),
          );
          const original = SpotifyAPI.prototype.getTracks;
          const calls = [];
          SpotifyAPI.prototype.getTracks = async (ids) => {
            calls.push(ids);
            return ids.map((id) => ({
              ...older,
              id,
              external_ids: { isrc: "REFRESHISRC" },
              album: { id: "album" },
              artists: [{ id: "artist", name: "Artist" }],
            }));
          };
          try {
            const resolver = new ImportResolver(String(user._id));
            for (const item of await resolver.prefetchLegacyRecordings(
              Array(30).fill(entry),
            ))
              identity.remember(item);
            await resolver.prefetchLegacyRecordings([entry]);
            assert.deepEqual(calls, [[older.id]]);
            assert.ok(
              (await identity.matchingTracks(entry, newer)).confirmed.includes(
                older.id,
              ),
            );
            assert.equal(
              (
                await reconcileImport(
                  user,
                  entry,
                  newer,
                  "refresh-job",
                  0,
                  identity,
                )
              ).outcome,
              "updated",
            );
            assert.equal((await InfosModel.findById(play._id)).id, older.id);
            assert.equal(
              (await InfosModel.findById(play._id)).provider,
              "deezer",
            );
          } finally {
            SpotifyAPI.prototype.getTracks = original;
          }
        },
      );
      await t.test(
        "legacy enrichment never assigns a relinked track's recording ID to the requested track",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const { SpotifyAPI } = require("../src/tools/apis/spotifyApi");
          const old = { ...track, id: "unavailable-legacy" };
          await TrackModel.create(old);
          const at = new Date("2024-10-02T12:00:00Z");
          await InfosModel.create(
            live({ id: old.id, played_at: at, provider: undefined }),
          );
          const entry = row({ source: "deezer", provider: "deezer", at });
          const original = SpotifyAPI.prototype.getTracks;
          let calls = 0;
          SpotifyAPI.prototype.getTracks = async () => {
            calls++;
            return [
              {
                ...old,
                id: "some-other-release",
                external_ids: { isrc: "DO_NOT_ASSIGN" },
              },
            ];
          };
          try {
            const resolver = new ImportResolver(String(user._id));
            await resolver.prefetchLegacyRecordings([entry]);
            await resolver.prefetchLegacyRecordings([entry]);
            assert.equal(calls, 1);
            assert.equal(
              (await TrackModel.findOne({ id: old.id })).external_ids?.isrc,
              undefined,
            );
          } finally {
            SpotifyAPI.prototype.getTracks = original;
          }
        },
      );
      await t.test(
        "recording cache handles renamed export labels and searches beyond the first candidate",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const { SpotifyAPI } = require("../src/tools/apis/spotifyApi");
          const original = SpotifyAPI.prototype.raw;
          const correct = {
            ...track,
            id: "multi-result",
            external_ids: { isrc: "MULTIISRC" },
            album: { id: "album" },
            artists: [{ id: "artist", name: "Artist" }],
          };
          let calls = 0;
          SpotifyAPI.prototype.raw = async () => {
            calls++;
            return {
              data: {
                tracks: {
                  items: [
                    {
                      ...correct,
                      id: "wrong-result",
                      external_ids: { isrc: "WRONG" },
                    },
                    correct,
                  ],
                },
              },
            };
          };
          try {
            const resolver = new ImportResolver(String(user._id));
            for (let i = 0; i < 30; i++) {
              const resolved = await resolver.resolve(
                row({
                  spotifyId: undefined,
                  isrc: "MULTIISRC",
                  title: `Spelling ${i}`,
                }),
              );
              assert.equal(resolved.id, correct.id);
            }
            assert.equal(calls, 1);
            assert.equal(
              (
                await new ImportResolver(String(user._id)).resolve(
                  row({ spotifyId: undefined, isrc: "MULTIISRC" }),
                )
              ).id,
              correct.id,
            );
            assert.equal(calls, 1);
          } finally {
            SpotifyAPI.prototype.raw = original;
          }
        },
      );
      await t.test(
        "known export rows bypass catalog resolution, preserve provenance and still correct changed time",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const XLSX = require("xlsx");
          const file = join(dir, "known-deezer.xlsx");
          const writeExport = (seconds) => {
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(
              book,
              XLSX.utils.json_to_sheet([
                {
                  "Song Title": "Legacy title",
                  Artist: "Artist",
                  ISRC: "REFRESHISRC",
                  Date: "2024-10-01 12:00:00",
                  "Listening Time": seconds,
                },
              ]),
              "10_listeningHistory",
            );
            XLSX.writeFile(book, file);
          };
          writeExport(45);
          const [entry] = await readImportRecords("deezer", [file], "UTC");
          const old = await TrackModel.findOne({ id: "refresh-legacy" }).lean();
          await reconcileImport(user, entry, old, "known-origin", 0);
          const original = ImportResolver.prototype.resolve;
          const prefetch = ImportResolver.prototype.prefetch;
          ImportResolver.prototype.resolve = async () => {
            throw new Error("Known source key should not resolve again");
          };
          ImportResolver.prototype.prefetch = async (rows) => {
            assert.equal(rows.length, 0);
          };
          try {
            for (const [seconds, outcome] of [
              [45, "unchanged"],
              [50, "updated"],
            ]) {
              writeExport(seconds);
              const job = await prepareImport(user, "deezer", [file], "UTC");
              await runImporter(String(job._id), user);
              const saved = await ImporterStateModel.findById(job._id);
              assert.equal(saved.status, "success");
              assert.equal(saved.summary[outcome], 1);
              const play = await InfosModel.findOne({
                owner: user._id,
                sourceKeys: entry.key,
              });
              assert.equal(play.provider, "deezer");
              assert.equal(play.listenedMs, seconds * 1000);
              if (outcome === "updated")
                assert.equal(play.durationImportId, String(job._id));
              assert.equal(typeof saved.fingerprint, "string");
              assert.equal(saved.fingerprint.length, 64);
            }
          } finally {
            ImportResolver.prototype.resolve = original;
            ImportResolver.prototype.prefetch = prefetch;
          }
        },
      );
      await t.test(
        "opt-in Deezer version repairs preserve events and replay durably",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const old = {
            ...track,
            id: "aba-old",
            name: "Wake Me Up",
            external_ids: { isrc: "ORIGINAL" },
          };
          const correct = {
            ...old,
            id: "aba-correct",
            name: "Wake Me Up - Avicii By Avicii",
            album: "aba-album",
            duration_ms: 420000,
            external_ids: { isrc: "ABA" },
          };
          await TrackModel.create([old, correct]);
          const at = new Date("2025-02-01T12:00:00Z");
          const play = await InfosModel.create(
            live({
              id: old.id,
              provider: undefined,
              played_at: at,
              listenedMs: 45000,
              blacklistedBy: "artist",
            }),
          );
          const entry = row({
            key: "aba-key",
            source: "deezer",
            provider: "deezer",
            at,
            title: old.name,
            isrc: "ABA",
          });
          const count = await InfosModel.countDocuments();
          assert.equal(
            (await reconcileImport(user, entry, correct, "repair-off", 0))
              .outcome,
            "ambiguous",
          );
          const result = await reconcileImport(
            user,
            entry,
            correct,
            "repair-on",
            0,
            new ImportContext(true),
          );
          assert.deepEqual(result, { outcome: "updated", deltaMs: 0 });
          const saved = await InfosModel.findById(play._id).lean();
          assert.equal(saved.id, correct.id);
          assert.equal(saved.albumId, correct.album);
          assert.equal(saved.durationMs, correct.duration_ms);
          assert.equal(saved.played_at.getTime(), at.getTime());
          assert.deepEqual(saved.blacklistedBy, ["artist"]);
          assert.deepEqual(saved.recordingRepair, {
            importId: "repair-on",
            blacklistedBy: ["artist"],
            id: old.id,
            albumId: "album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
            durationMs: 240000,
          });
          assert.deepEqual(
            await reconcileImport(
              user,
              entry,
              correct,
              "repair-on",
              0,
              new ImportContext(true),
            ),
            result,
          );
          assert.deepEqual(
            await reconcileImport(
              user,
              entry,
              correct,
              "repair-repeat",
              0,
              new ImportContext(true),
            ),
            { outcome: "unchanged", deltaMs: 0 },
          );
          assert.deepEqual(await InfosModel.findById(play._id).lean(), saved);
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "legacy repairs reject unrelated titles, artists, provenance and multiple exact events",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const correct = await TrackModel.findOne({
            id: "aba-correct",
          }).lean();
          for (const [index, changes] of [
            { name: "Another Song" },
            { artists: ["another-artist"] },
            { external_ids: undefined },
            { sourceKeys: ["api:already-known"] },
            { listeningSource: "full-privacy" },
            { duplicate: true },
          ].entries()) {
            const { sourceKeys, listeningSource, duplicate, ...metadata } =
              changes;
            const old = {
              ...track,
              id: `guard-${index}`,
              name: "Wake Me Up",
              external_ids: { isrc: "OTHER" },
              ...metadata,
            };
            await TrackModel.create(old);
            const at = new Date(`2025-03-0${index + 1}T12:00:00Z`);
            const play = await InfosModel.create(
              live({
                id: old.id,
                provider: undefined,
                played_at: at,
                sourceKeys,
                listeningSource,
              }),
            );
            if (duplicate)
              await InfosModel.create(
                live({ id: old.id, provider: undefined, played_at: at }),
              );
            const before = await InfosModel.findById(play._id).lean();
            const count = await InfosModel.countDocuments();
            assert.deepEqual(
              await reconcileImport(
                user,
                row({
                  key: `guard-key-${index}`,
                  source: "deezer",
                  provider: "deezer",
                  at,
                  title: "Wake Me Up",
                  isrc: "ABA",
                }),
                correct,
                "guard-job",
                index,
                new ImportContext(true),
              ),
              { outcome: "ambiguous", deltaMs: 0 },
            );
            assert.deepEqual(
              await InfosModel.findById(play._id).lean(),
              before,
            );
            assert.equal(await InfosModel.countDocuments(), count);
          }
        },
      );
      await t.test(
        "exact Deezer matches take precedence over a separate nearby listen",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const correct = await TrackModel.findOne({
            id: "aba-correct",
          }).lean();
          const at = new Date("2025-04-01T12:00:00Z");
          const earlier = await InfosModel.create(
            live({
              id: "aba-old",
              provider: undefined,
              played_at: new Date(at.getTime() - 90000),
            }),
          );
          const exact = await InfosModel.create(
            live({ id: "aba-old", provider: undefined, played_at: at }),
          );
          const before = await InfosModel.findById(earlier._id).lean();
          const entry = row({
            key: "exact-repair",
            source: "deezer",
            provider: "deezer",
            title: "Wake Me Up",
            isrc: "ABA",
            at,
          });
          assert.deepEqual(
            await reconcileImport(
              user,
              entry,
              correct,
              "exact-job",
              0,
              new ImportContext(true),
            ),
            { outcome: "updated", deltaMs: -195000 },
          );
          assert.equal((await InfosModel.findById(exact._id)).id, correct.id);
          assert.deepEqual(
            await InfosModel.findById(earlier._id).lean(),
            before,
          );
          const confirmedAt = new Date("2025-04-02T12:00:00Z");
          const confirmed = await InfosModel.create(
            live({
              id: correct.id,
              provider: undefined,
              played_at: confirmedAt,
            }),
          );
          await InfosModel.create(
            live({
              id: "aba-old",
              provider: undefined,
              played_at: new Date(confirmedAt.getTime() - 90000),
            }),
          );
          assert.equal(
            (
              await reconcileImport(
                user,
                { ...entry, key: "exact-confirmed", at: confirmedAt },
                correct,
                "confirmed-job",
                0,
              )
            ).outcome,
            "updated",
          );
          assert.equal(
            (await InfosModel.findById(confirmed._id)).recordingRepair,
            undefined,
          );
        },
      );
      await t.test(
        "known Spotify plays remain separate and repair settings survive preparation",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const correct = await TrackModel.findOne({
            id: "aba-correct",
          }).lean();
          const at = new Date("2025-05-01T12:00:00Z");
          const existing = await InfosModel.create(
            live({ id: "aba-old", played_at: at }),
          );
          assert.equal(
            (
              await reconcileImport(
                user,
                row({
                  key: "separate-provider",
                  source: "deezer",
                  provider: "deezer",
                  title: "Wake Me Up",
                  isrc: "ABA",
                  at,
                }),
                correct,
                "provider-job",
                0,
                new ImportContext(true),
              )
            ).outcome,
            "added",
          );
          assert.equal((await InfosModel.findById(existing._id)).id, "aba-old");
          const XLSX = require("xlsx");
          const file = join(dir, "repair-preparation.xlsx");
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.json_to_sheet([
              {
                "Song Title": "Wake Me Up",
                Artist: "Artist",
                ISRC: "ABA",
                Date: "2025-05-02 12:00:00",
                "Listening Time": 60,
              },
            ]),
            "10_listeningHistory",
          );
          XLSX.writeFile(book, file);
          const repairAt = new Date("2025-05-02T12:00:00Z");
          const old = await InfosModel.create(
            live({ id: "aba-old", provider: undefined, played_at: repairAt }),
          );
          const job = await prepareImport(user, "deezer", [file], "UTC", true);
          assert.equal(
            (await ImporterStateModel.findById(job._id)).repairLegacyDeezer,
            true,
          );
          await runImporter(String(job._id), user);
          assert.equal(
            (await ImporterStateModel.findById(job._id)).summary.updated,
            1,
          );
          assert.equal((await InfosModel.findById(old._id)).id, correct.id);
          await assert.rejects(
            prepareImport(user, "full-privacy", [], "UTC", true),
          );
        },
      );
      await t.test(
        "version labels and contributor brackets are normalized without dropping meaningful titles",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          for (const [index, [title, oldName, newName, expected]] of [
            [
              "Get Lucky",
              "Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]",
              "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
              true,
            ],
            ["Cupid", "Cupid", "Cupid - Twin Version", true],
            [
              "In Your Arms",
              "In Your Arms (with X Ambassadors)",
              "In Your Arms (with X Ambassadors) [Alan Walker Remix]",
              true,
            ],
            [
              "Don't Start Now",
              "Don’t Start Now",
              "Don't Start Now - Purple Disco Machine Remix",
              true,
            ],
            [
              "Love Of My Life",
              "Love Of My Life - Remastered 2011",
              "Love Of My Life - Live At Rock In Rio Festival, 18 January 1985",
              true,
            ],
            [
              "Dance The Night",
              "Dance The Night - From Barbie The Album",
              "Dance The Night",
              true,
            ],
            ["Song", "Song (Part II)", "Song - Radio Edit", false],
            ["Song", "Song - A Different Song", "Song - Remix", false],
          ].entries()) {
            const old = {
              ...track,
              id: `title-old-${index}`,
              name: oldName,
              external_ids: { isrc: `OLD${index}` },
            };
            const target = {
              ...track,
              id: `title-new-${index}`,
              name: newName,
              external_ids: { isrc: `NEW${index}` },
            };
            await TrackModel.create([old, target]);
            const at = new Date(`2025-06-0${index + 1}T12:00:00Z`);
            const play = await InfosModel.create(
              live({ id: old.id, provider: undefined, played_at: at }),
            );
            const result = await reconcileImport(
              user,
              row({
                key: `title-key-${index}`,
                source: "deezer",
                provider: "deezer",
                at,
                title,
                isrc: `NEW${index}`,
              }),
              target,
              "title-job",
              index,
              new ImportContext(true),
            );
            assert.equal(
              result.outcome,
              expected ? "updated" : "ambiguous",
              title,
            );
            assert.equal(
              (await InfosModel.findById(play._id)).id,
              expected ? target.id : old.id,
            );
          }
        },
      );
      await t.test(
        "local ISRC lookup wins over title matching and avoids Spotify calls",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const { SpotifyAPI } = require("../src/tools/apis/spotifyApi");
          const original = SpotifyAPI.prototype.raw;
          SpotifyAPI.prototype.raw = async () => {
            throw new Error("Unexpected Spotify request");
          };
          try {
            const resolver = new ImportResolver(String(user._id));
            const result = await resolver.resolve(
              row({
                spotifyId: undefined,
                isrc: "TESTRECORDING",
                title: "Different exported spelling",
              }),
            );
            assert.equal(result.external_ids.isrc, "TESTRECORDING");
            assert.ok(["old-release", "new-release"].includes(result.id));
          } finally {
            SpotifyAPI.prototype.raw = original;
          }
        },
      );
      await t.test(
        "source-key lookups use their index without scanning a user's history",
        async () => {
          const {
            importSourceKeyFilter,
          } = require("../src/database/queries/importListening");
          for (const key of ["recording-key", "never-imported-key"]) {
            const plan = await InfosModel.find(
              importSourceKeyFilter(user._id, key),
            )
              .limit(1)
              .explain("executionStats");
            assert.match(
              JSON.stringify(plan.queryPlanner.winningPlan),
              /owner_1_sourceKeys_1/,
            );
            assert.ok(plan.executionStats.totalDocsExamined <= 1);
          }
        },
      );
      await t.test(
        "preview writes no plays, complete import reports all rows and a repeat is unchanged",
        async () => {
          const source = [45000, 12000, -1].map((ms, index) => ({
            ts: `2024-02-01T12:0${index}:45Z`,
            ms_played: ms,
            spotify_track_uri: "spotify:track:song",
            master_metadata_track_name: "Song",
            master_metadata_album_artist_name: "Artist",
          }));
          const file = join(dir, "job.json");
          await writeFile(file, JSON.stringify(source));
          const before = await InfosModel.countDocuments();
          const preview = await prepareImport(
            user,
            "full-privacy",
            [file],
            "UTC",
          );
          assert.equal(preview.status, "ready");
          assert.equal(await InfosModel.countDocuments(), before);
          await runImporter(preview._id.toString(), user);
          const result = await ImporterStateModel.findById(preview._id);
          assert.equal(result.status, "success");
          assert.equal(result.current, 3);
          assert.deepEqual(
            [
              result.summary.added,
              result.summary.short,
              result.summary.invalid,
            ],
            [1, 1, 1],
          );
          assert.equal(canUserImport(user._id.toString()), true);
          await assert.rejects(access(file));
          await writeFile(file, JSON.stringify(source));
          const repeat = await prepareImport(
            user,
            "full-privacy",
            [file],
            "UTC",
          );
          await runImporter(repeat._id.toString(), user);
          assert.equal(
            (await ImporterStateModel.findById(repeat._id)).summary.unchanged,
            1,
          );
          assert.equal(await InfosModel.countDocuments(), before + 1);
          const accuracy = await listeningAccuracy(user);
          assert.ok(accuracy.reported > 0);
          assert.ok(accuracy.lastImport);
        },
      );
      await t.test(
        "extended exports prefer qualifying listens over nearby skips with stable ties",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          for (const reverse of [false, true]) {
            const owner = await UserModel.create({
              username: "Delayed API",
              spotifyId: `delayed-${reverse}`,
              settings: { dateFormat: "yyyy-MM-dd", timezone: "UTC" },
            });
            const events = [0, 40000, 50000, 60000, 1200000].map(
              (offset, index) =>
                row({
                  key: `delayed-${index}`,
                  at: new Date(Date.UTC(2026, 0, 1, 12) + offset),
                  listenedMs: index === 2 ? 500 : 35000,
                }),
            );
            const plays = await InfosModel.create([
              live({
                owner: owner._id,
                played_at: new Date(+events[0].at + 2230),
                sourceKeys: ["api:delay"],
              }),
              live({ owner: owner._id, played_at: events[2].at }),
              live({
                owner: owner._id,
                played_at: new Date(+events[3].at + 21900),
              }),
              live({
                owner: owner._id,
                played_at: new Date(+events[4].at + 120000),
              }),
            ]);
            const identity = new ImportContext(false, events);
            const outcomes = {};
            for (const entry of reverse ? [...events].reverse() : events) {
              if (entry.listenedMs < 30000) continue;
              outcomes[entry.key] = (
                await reconcileImport(
                  owner,
                  entry,
                  track,
                  "delay",
                  entry.key,
                  identity,
                )
              ).outcome;
            }
            assert.deepEqual(outcomes, {
              "delayed-0": "updated",
              "delayed-1": "updated",
              "delayed-3": "updated",
              "delayed-4": "ambiguous",
            });
            assert.equal(
              await InfosModel.countDocuments({ owner: owner._id }),
              4,
            );
            const tied = await InfosModel.findById(plays[1]._id).lean();
            assert.equal(tied.listenedMs, 35000);
            assert.equal(+tied.sourceEndedAt, +events[1].at);
            assert.equal(+tied.played_at, +plays[1].played_at);
            assert.deepEqual(
              await InfosModel.findById(plays[3]._id).lean(),
              plays[3].toObject(),
            );
            assert.equal(
              (await InfosModel.findById(plays[0]._id)).listenedMs,
              35000,
            );
          }
        },
      );
      await t.test(
        "nearest qualifying events resolve competing API candidates while respecting export coverage",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          for (const scenario of [
            { name: "delayed", offset: 300000, expected: "updated" },
            { name: "interior", offset: -90000, expected: "updated" },
            {
              name: "two candidates",
              offset: 300000,
              second: 310000,
              expected: "updated",
            },
            {
              name: "competing repeat",
              offset: 300000,
              competitor: 620000,
              expected: "updated",
            },
            {
              name: "competing skip",
              offset: 300000,
              competitor: 620000,
              short: true,
              expected: "updated",
            },
            {
              name: "outside export",
              offset: 300000,
              partial: true,
              expected: "ambiguous",
            },
            { name: "too distant", offset: 901000, expected: "added" },
            {
              name: "before song window",
              offset: -400000,
              expected: "updated",
            },
          ]) {
            const owner = await UserModel.create({
              username: scenario.name,
              spotifyId: scenario.name,
              settings: { dateFormat: "yyyy-MM-dd" },
            });
            const entry = row({
              key: scenario.name,
              at: new Date("2026-05-01T12:00:00Z"),
              listenedMs: 120000,
            });
            const events = [entry];
            if (!scenario.partial)
              events.push(
                row({
                  key: "range-before",
                  spotifyId: "other",
                  at: new Date(+entry.at - 3600000),
                }),
                row({
                  key: "range-after",
                  spotifyId: "other",
                  at: new Date(+entry.at + 3600000),
                }),
              );
            if (scenario.competitor)
              events.push(
                row({
                  key: "repeat",
                  at: new Date(+entry.at + scenario.competitor),
                  listenedMs: scenario.short ? 500 : 120000,
                }),
              );
            const saved = await InfosModel.create(
              live({
                owner: owner._id,
                played_at: new Date(+entry.at + scenario.offset),
                sourceKeys: ["api:test"],
              }),
            );
            const second = scenario.second
              ? await InfosModel.create(
                  live({
                    owner: owner._id,
                    played_at: new Date(+entry.at + scenario.second),
                    sourceKeys: ["api:second"],
                  }),
                )
              : null;
            const identity = new ImportContext(false, events);
            const result = await reconcileImport(
              owner,
              entry,
              track,
              "isolated",
              0,
              identity,
            );
            assert.equal(result.outcome, scenario.expected, scenario.name);
            if (result.outcome === "updated") {
              const updated = await InfosModel.findById(saved._id).lean();
              assert.equal(updated.listenedMs, 120000);
              assert.equal(+updated.played_at, +saved.played_at);
              assert.equal(
                await InfosModel.countDocuments({ owner: owner._id }),
                scenario.second ? 2 : 1,
              );
              if (second)
                assert.deepEqual(
                  await InfosModel.findById(second._id).lean(),
                  second.toObject(),
                );
              assert.equal(
                (
                  await reconcileImport(
                    owner,
                    entry,
                    track,
                    "repeat",
                    0,
                    new ImportContext(false, [...events].reverse()),
                  )
                ).outcome,
                "unchanged",
              );
            } else
              assert.deepEqual(
                await InfosModel.findById(saved._id).lean(),
                saved.toObject(),
              );
          }
        },
      );
      await t.test(
        "one API record cannot be reused for separate exported listens, even after timing review",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          for (const reverse of [false, true]) {
            const owner = await UserModel.create({
              username: "Sequence",
              spotifyId: `sequence-${reverse}`,
              settings: { dateFormat: "yyyy-MM-dd" },
            });
            const events = [0, 240000, 600000].map((offset, index) =>
              row({
                key: `sequence-${index}`,
                at: new Date(Date.UTC(2026, 6, 1, 12) + offset),
                listenedMs: 60000,
              }),
            );
            const context = new ImportContext(false, [
              ...events,
              row({
                key: "nearby-skip",
                at: new Date(+events[2].at + 1000),
                listenedMs: 500,
              }),
              row({
                key: "coverage",
                spotifyId: "other",
                at: new Date(+events[2].at + 300000),
              }),
            ]);
            context.holdUnmatched = true;
            const saved = await InfosModel.create(
              live({
                owner: owner._id,
                played_at: new Date(+events[2].at + 2000),
                sourceKeys: ["api:sequence"],
              }),
            );
            for (const entry of reverse ? [...events].reverse() : events) {
              const result = await reconcileImport(
                owner,
                entry,
                track,
                "sequence",
                entry.key,
                context,
              );
              assert.equal(
                result.outcome,
                entry.key === "sequence-2" ? "updated" : "added",
              );
            }
            assert.equal(
              await InfosModel.countDocuments({ owner: owner._id }),
              3,
            );
            assert.equal(
              +(await InfosModel.findById(saved._id)).sourceEndedAt,
              +events[2].at,
            );
            const before = await InfosModel.find({ owner: owner._id })
              .sort({ _id: 1 })
              .lean();
            for (const entry of [...events].reverse())
              assert.equal(
                (
                  await reconcileImport(
                    owner,
                    entry,
                    track,
                    "again",
                    entry.key,
                    context,
                  )
                ).outcome,
                "unchanged",
              );
            assert.deepEqual(
              await InfosModel.find({ owner: owner._id })
                .sort({ _id: 1 })
                .lean(),
              before,
            );
          }
        },
      );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
