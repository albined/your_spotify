const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, writeFile, access, rm } = require("node:fs/promises");
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
const { spotifyTrackId } = require("../src/tools/importers/reviewCatalog");
const { importFingerprint } = require("../src/tools/importers/records");
const {
  recordingKey,
  reviewRowKey,
} = require("../src/tools/importers/reviewIdentity");
const targetId = "1234567890123456789012";
test("track links are parsed locally and reject unrelated URLs", () => {
  for (const input of [
    targetId,
    `spotify:track:${targetId}`,
    `https://open.spotify.com/track/${targetId}?si=abc`,
    `https://open.spotify.com/intl-sv/track/${targetId}`,
  ])
    assert.equal(spotifyTrackId(input), targetId);
  for (const input of [
    "https://evil.test/track/" + targetId,
    "http://127.0.0.1/secret",
    "https://open.spotify.com/album/" + targetId,
    "spotify:episode:" + targetId,
  ])
    assert.throws(() => spotifyTrackId(input));
});
test("review identity groups recording labels while retaining contradictory evidence", () => {
  const row = {
    provider: "deezer",
    source: "deezer",
    isrc: " ABC ",
    title: "Song",
    artist: "Artist",
    key: "key",
    at: new Date(),
    listenedMs: 45000,
  };
  assert.equal(
    recordingKey(row),
    recordingKey({ ...row, isrc: "abc", title: "Another spelling" }),
  );
  assert.notEqual(
    recordingKey(row),
    recordingKey({ ...row, provider: "spotify" }),
  );
  assert.notEqual(
    reviewRowKey(row),
    reviewRowKey({ ...row, listenedMs: 46000 }),
  );
  assert.notEqual(
    reviewRowKey({ ...row, listenedMs: null, sourceListeningTime: "-1" }),
    reviewRowKey({ ...row, listenedMs: null, sourceListeningTime: "-2" }),
  );
  assert.notEqual(
    importFingerprint([row], 2),
    importFingerprint([{ ...row, album: "Album" }], 2),
  );
  assert.equal(
    importFingerprint([row]),
    importFingerprint([
      {
        ...row,
        album: "Album",
        sourceTimestamp: "x",
        sourceListeningTime: "45",
      },
    ]),
  );
});
test(
  "saved review, choices, overlap protection and recovery",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async (t) => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      UserModel,
      TrackModel,
      ImportReviewModel,
      ImportMappingModel,
      ImporterStateModel,
    } = require("../src/database/Models");
    const {
      ReviewStore,
      listReviewGroups,
      getReviewRows,
    } = require("../src/database/queries/importReview");
    const {
      previewReview,
      applyReview,
      chooseNoMatch,
    } = require("../src/tools/importers/review");
    const {
      prepareImport,
      runImporter,
    } = require("../src/tools/importers/importer");
    const {
      reconcileImport,
    } = require("../src/database/queries/importListening");
    const {
      claimImportWork,
      releaseImportWork,
    } = require("../src/tools/importers/work");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `import_review_test_${Date.now()}`,
    });
    const dir = await mkdtemp(join(tmpdir(), "import-review-"));
    try {
      await Promise.all([
        InfosModel.init(),
        ImportReviewModel.init(),
        ImportMappingModel.init(),
      ]);
      const user = await UserModel.create({
        username: "Review",
        spotifyId: "review",
        settings: {
          timezone: "UTC",
          dateFormat: "yyyy-MM-dd",
          blacklistedArtists: ["old-artist"],
        },
      });
      const other = await UserModel.create({
        username: "Other",
        spotifyId: "other",
        settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
      });
      const track = await TrackModel.create({
        id: targetId,
        name: "Song - Correct Version",
        album: "correct-album",
        artists: ["artist"],
        duration_ms: 180000,
        external_ids: { isrc: "CORRECT" },
      });
      const row = (extra = {}) => ({
        source: "deezer",
        provider: "deezer",
        key: "source-key",
        at: new Date("2024-01-01T12:00:00Z"),
        precisionMs: 1000,
        listenedMs: 45000,
        title: "Song",
        artist: "Artist",
        album: "Source album",
        isrc: "UNAVAILABLE",
        ...extra,
      });
      const save = async (entry, category = "recording", id = "job") => {
        const store = new ReviewStore();
        await store.initialize(user, [entry]);
        await store.save(user, entry, category, "Needs review", id);
      };
      await t.test(
        "full queue survives upload deletion, exceeds 100 examples and deduplicates reimports",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const old = ImportResolver.prototype.resolve;
          ImportResolver.prototype.resolve = async () => null;
          const XLSX = require("xlsx");
          const file = join(dir, "history.xlsx");
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.json_to_sheet(
              Array.from({ length: 125 }, (_, i) => ({
                "Song Title": "Bulk Song",
                Artist: "Bulk Artist",
                "Album Title": "Source release",
                ISRC: "BULK",
                Date: new Date(Date.UTC(2023, 0, 1, 12, i)).toISOString(),
                "Listening Time": 45,
              })),
            ),
            "10_listeningHistory",
          );
          try {
            for (let repeat = 0; repeat < 2; repeat++) {
              XLSX.writeFile(book, file);
              const job = await prepareImport(user, "deezer", [file], "UTC");
              await runImporter(String(job._id), user);
              const receipt = await ImporterStateModel.findById(job._id);
              assert.equal(receipt.status, "success");
              assert.equal(receipt.issues.length, 100);
              assert.equal(receipt.issueCounts.recording, 125);
              await assert.rejects(access(file));
            }
            assert.equal(
              await ImportReviewModel.countDocuments({ owner: user._id }),
              125,
            );
            const { groups } = await listReviewGroups(user, "recording");
            assert.equal(groups.length, 1);
            assert.equal(groups[0].count, 125);
            assert.equal(groups[0].sourceRows, 125);
            const page = await getReviewRows(
              user,
              "recording",
              groups[0]._id,
              100,
            );
            assert.equal(page.rows.length, 25);
            assert.equal(page.rows[0].record.album, "Source release");
          } finally {
            ImportResolver.prototype.resolve = old;
          }
        },
      );
      await t.test("queue and choices are isolated per account", async () => {
        assert.equal(
          (await listReviewGroups(other, "recording")).groups.length,
          0,
        );
        const group = (await listReviewGroups(user, "recording")).groups[0];
        assert.equal(
          (await getReviewRows(other, "recording", group._id)).total,
          0,
        );
        await assert.rejects(
          previewReview(other, group._id, targetId),
          /no pending/,
        );
      });
      await t.test(
        "preview writes no plays; applying a group saves provenance and repeats safely",
        async () => {
          await save(row());
          await save(
            row({ key: "source-key-2", at: new Date("2024-01-02T12:00:00Z") }),
          );
          const group = recordingKey(row());
          const count = await InfosModel.countDocuments();
          const preview = await previewReview(user, group, targetId);
          assert.equal(preview.summary.added, 2);
          assert.equal(await InfosModel.countDocuments(), count);
          assert.equal(await ImportMappingModel.countDocuments(), 0);
          const result = await applyReview(
            user,
            group,
            targetId,
            preview.token,
          );
          assert.equal(result.summary.added, 2);
          const mapping = await ImportMappingModel.findOne({
            owner: user._id,
            recordingKey: group,
          });
          assert.ok(mapping);
          const plays = await InfosModel.find({
            recordingMappingId: String(mapping._id),
          }).lean();
          assert.equal(plays.length, 2);
          assert.ok(
            plays.every((p) => p.id === targetId && p.provider === "deezer"),
          );
          assert.equal(
            (await getReviewRows(user, "recording", group)).total,
            0,
          );
          await assert.rejects(
            applyReview(user, group, targetId, preview.token),
            /no pending/,
          );
          assert.equal(await InfosModel.countDocuments(), count + 2);
        },
      );
      await t.test(
        "saved recording choice applies to future exports and avoids catalog resolution",
        async () => {
          const XLSX = require("xlsx");
          const file = join(dir, "future.xlsx");
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(
            book,
            XLSX.utils.json_to_sheet([
              {
                "Song Title": "Song renamed in a later export",
                Artist: "Artist",
                "Album Title": "Another release",
                ISRC: "UNAVAILABLE",
                Date: "2024-02-01 12:00:00",
                "Listening Time": 55,
              },
            ]),
            "10_listeningHistory",
          );
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const old = ImportResolver.prototype.resolve;
          ImportResolver.prototype.resolve = async () => {
            throw new Error("Unexpected resolver call");
          };
          try {
            for (let i = 0; i < 2; i++) {
              XLSX.writeFile(book, file);
              const job = await prepareImport(user, "deezer", [file], "UTC");
              await runImporter(String(job._id), user);
              const receipt = await ImporterStateModel.findById(job._id);
              assert.equal(receipt.status, "success");
              assert.equal(receipt.summary[i ? "unchanged" : "added"], 1);
            }
          } finally {
            ImportResolver.prototype.resolve = old;
          }
        },
      );
      await t.test(
        "manual exact-time repair can correct artist ordering and recomputes blacklist",
        async () => {
          const entry = row({
            key: "artist-order",
            isrc: "ORDER",
            at: new Date("2024-03-01T12:00:00Z"),
          });
          await save(entry, "legacy");
          await TrackModel.create({
            id: "old",
            name: "Song",
            album: "old-album",
            artists: ["old-artist", "artist"],
            duration_ms: 200000,
            external_ids: { isrc: "OLD" },
          });
          const old = await InfosModel.create({
            owner: user._id,
            id: "old",
            played_at: entry.at,
            durationMs: 200000,
            albumId: "old-album",
            primaryArtistId: "old-artist",
            artistIds: ["old-artist", "artist"],
            blacklistedBy: "artist",
          });
          const preview = await previewReview(
            user,
            recordingKey(entry),
            targetId,
          );
          assert.equal(preview.summary.updated, 1);
          await applyReview(user, recordingKey(entry), targetId, preview.token);
          const play = await InfosModel.findById(old._id).lean();
          assert.equal(play.id, targetId);
          assert.equal(play.primaryArtistId, "artist");
          assert.equal(play.blacklistedBy, undefined);
          assert.deepEqual(play.recordingRepair.blacklistedBy, ["artist"]);
          assert.equal(play.played_at.getTime(), entry.at.getTime());
        },
      );
      await t.test(
        "stale preview and concurrent import are rejected",
        async () => {
          const entry = row({
            key: "stale",
            isrc: "STALE",
            at: new Date("2024-04-01T12:00:00Z"),
          });
          await save(entry);
          const group = recordingKey(entry);
          const preview = await previewReview(user, group, targetId);
          await InfosModel.create({
            owner: user._id,
            id: targetId,
            played_at: entry.at,
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
          });
          await assert.rejects(
            applyReview(user, group, targetId, preview.token),
            /History changed/,
          );
          assert.equal(
            await ImportMappingModel.countDocuments({ recordingKey: group }),
            0,
          );
          claimImportWork(String(user._id));
          try {
            await assert.rejects(previewReview(user, group, targetId), /Wait/);
            await assert.rejects(
              applyReview(user, group, targetId, preview.token),
              /already running/,
            );
          } finally {
            releaseImportWork(String(user._id));
          }
        },
      );
      await t.test(
        "retry after a play commits but queue update fails creates no duplicate",
        async () => {
          const entry = row({
            key: "crash",
            isrc: "CRASH",
            at: new Date("2024-05-01T12:00:00Z"),
          });
          await save(entry);
          const group = recordingKey(entry);
          const first = await previewReview(user, group, targetId);
          const update = ImportReviewModel.updateOne;
          let fail = true;
          ImportReviewModel.updateOne = function (...args) {
            if (fail) {
              fail = false;
              throw new Error("Injected checkpoint failure");
            }
            return update.apply(this, args);
          };
          try {
            await assert.rejects(
              applyReview(user, group, targetId, first.token),
              /checkpoint/,
            );
          } finally {
            ImportReviewModel.updateOne = update;
          }
          const second = await previewReview(user, group, targetId);
          await applyReview(user, group, targetId, second.token);
          assert.equal(
            await InfosModel.countDocuments({
              owner: user._id,
              sourceKeys: entry.key,
            }),
            1,
          );
          assert.equal(
            (await getReviewRows(user, "recording", group)).total,
            0,
          );
        },
      );
      await t.test(
        "a chosen recording cannot override an uncertain timestamp",
        async () => {
          const entry = row({
            key: "timing",
            isrc: "TIMING",
            at: new Date("2024-06-01T12:01:00Z"),
            listenedMs: 120000,
          });
          await save(entry, "legacy");
          await InfosModel.create({
            owner: user._id,
            id: targetId,
            played_at: new Date("2024-06-01T12:00:00Z"),
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
          });
          const group = recordingKey(entry);
          const preview = await previewReview(user, group, targetId);
          assert.equal(preview.summary.ambiguous, 1);
          const before = await InfosModel.countDocuments();
          await applyReview(user, group, targetId, preview.token);
          assert.equal(await InfosModel.countDocuments(), before);
          assert.equal(
            (await getReviewRows(user, "recording", group)).total,
            1,
          );
        },
      );
      await t.test(
        "source conflicts retain variants and occurrence counts across repeated files",
        async () => {
          const a = row({
            key: "conflict",
            isrc: "CONFLICT",
            at: new Date("2024-07-01T12:00:00Z"),
            ambiguous: true,
          });
          const b = { ...a, listenedMs: 90000 };
          const store = new ReviewStore();
          await store.initialize(user, [a, a, b]);
          for (const r of [a, a, b])
            await store.save(user, r, "timestamp", "Conflict", "conflict-job");
          const again = new ReviewStore();
          await again.initialize(user, [a, a, b]);
          for (const r of [a, a, b])
            await again.save(user, r, "timestamp", "Conflict", "repeat");
          const { groups } = await listReviewGroups(user, "timestamp");
          const group = groups.find((g) => g.isrc === "CONFLICT");
          assert.equal(group.count, 2);
          assert.equal(group.sourceRows, 3);
          await assert.rejects(
            previewReview(user, group._id, targetId),
            /no pending/,
          );
        },
      );
      await t.test(
        "conflicting pending values from overlapping exports move out of recording review",
        async () => {
          const a = row({
            key: "overlap",
            isrc: "OVERLAP",
            at: new Date("2024-08-01T12:00:00Z"),
          });
          await save(a);
          await save({ ...a, listenedMs: 90000 });
          const docs = await ImportReviewModel.find({
            owner: user._id,
            "record.key": a.key,
          }).lean();
          assert.equal(docs.length, 2);
          assert.ok(docs.every((d) => d.category === "timestamp"));
          const store = new ReviewStore();
          await store.initialize(user, [a]);
          assert.equal(store.isConflicting(a), true);
        },
      );
      await t.test(
        "multiple pending identities at one timestamp cannot inflate the preview or apply",
        async () => {
          const a = row({
            key: "overlap-label-a",
            isrc: "SAMESTAMP",
            at: new Date("2024-08-03T12:00:00Z"),
          });
          const b = {
            ...a,
            key: "overlap-label-b",
            title: "Renamed source label",
          };
          await save(a);
          await save(b);
          const group = recordingKey(a);
          const preview = await previewReview(user, group, targetId);
          assert.equal(preview.summary.ambiguous, 2);
          assert.equal(preview.summary.added, 0);
          const count = await InfosModel.countDocuments();
          await applyReview(user, group, targetId, preview.token);
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "an unavailable saved choice never silently falls back to another recording",
        async () => {
          const {
            savedMappings,
          } = require("../src/database/queries/importReview");
          const entry = row({ isrc: "MISSINGMAPPING" });
          await ImportMappingModel.create({
            owner: user._id,
            recordingKey: recordingKey(entry),
            trackId: "missing-track",
          });
          const choice = (await savedMappings(user)).get(recordingKey(entry));
          assert.equal(choice.trackId, "missing-track");
          assert.equal(choice.track, undefined);
        },
      );
      await t.test(
        "review migrations can run twice without changing existing queue data",
        async () => {
          const {
            up,
          } = require("../src/migrations/1790592000003-add_import_review");
          const count = await ImportReviewModel.countDocuments();
          await up();
          await up();
          assert.equal(await ImportReviewModel.countDocuments(), count);
        },
      );
      await t.test(
        "a known source event cannot silently retain a different recording than the saved choice",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const entry = row({
            key: "known-other-recording",
            isrc: "USERPICK",
            at: new Date("2024-08-05T12:00:00Z"),
          });
          const play = await InfosModel.create({
            owner: user._id,
            id: "old",
            played_at: entry.at,
            durationMs: 200000,
            albumId: "old-album",
            primaryArtistId: "old-artist",
            artistIds: ["old-artist"],
            provider: "deezer",
            sourceKeys: [entry.key],
            listeningSource: "deezer",
            listenedMs: 45000,
            sourceEndedAt: entry.at,
          });
          const identity = new ImportContext();
          identity.reviewMapping = { id: "choice", trackId: targetId };
          const result = await reconcileImport(
            user,
            entry,
            track,
            "known-choice",
            0,
            identity,
          );
          assert.equal(result.outcome, "ambiguous");
          assert.equal(
            (await InfosModel.findById(play._id)).recordingMappingId,
            undefined,
          );
        },
      );
      await t.test(
        "saved choices do not rewrite already-correct accepted events outside the review",
        async () => {
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          const entry = row({
            key: "already-correct",
            isrc: "UNAVAILABLE",
            at: new Date("2024-08-06T12:00:00Z"),
          });
          await reconcileImport(user, entry, track, "old-exact-import", 0);
          const before = await InfosModel.findOne({
            owner: user._id,
            sourceKeys: entry.key,
          }).lean();
          const identity = new ImportContext();
          identity.reviewMapping = { id: "saved-choice", trackId: targetId };
          assert.deepEqual(
            await reconcileImport(
              user,
              entry,
              track,
              "repeat-with-choice",
              0,
              identity,
            ),
            { outcome: "unchanged", deltaMs: 0 },
          );
          assert.deepEqual(
            await InfosModel.findById(before._id).lean(),
            before,
          );
        },
      );
      await t.test(
        "Spotify same-minute overlaps stay ambiguous and short rows do not delete API plays",
        async () => {
          const at = new Date("2024-09-01T12:00:00Z");
          for (const shift of [0, 10000])
            await InfosModel.create({
              owner: user._id,
              id: targetId,
              played_at: new Date(+at + shift),
              durationMs: 180000,
              albumId: "correct-album",
              primaryArtistId: "artist",
              artistIds: ["artist"],
              provider: "spotify",
            });
          const entry = row({
            key: "spotify-overlap",
            provider: "spotify",
            source: "full-privacy",
            isrc: undefined,
            spotifyId: targetId,
            at: new Date(+at + 45000),
          });
          const count = await InfosModel.countDocuments();
          assert.equal(
            (await reconcileImport(user, entry, track, "spotify-job", 0))
              .outcome,
            "ambiguous",
          );
          assert.equal(await InfosModel.countDocuments(), count);
          const file = join(dir, "short.json");
          await writeFile(
            file,
            JSON.stringify([
              {
                ts: new Date(+at + 10000).toISOString(),
                ms_played: 10000,
                spotify_track_uri: `spotify:track:${targetId}`,
                master_metadata_track_name: "Song",
                master_metadata_album_artist_name: "Artist",
              },
            ]),
          );
          const job = await prepareImport(user, "full-privacy", [file], "UTC");
          await runImporter(String(job._id), user);
          assert.equal(
            (await ImporterStateModel.findById(job._id)).summary.short,
            1,
          );
          assert.equal(await InfosModel.countDocuments(), count);
        },
      );
      await t.test(
        "minute exports exclude skips before conflicts and repair older review queues",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const {
            readImportRecords,
          } = require("../src/tools/importers/records");
          const owner = await UserModel.create({
            username: "Minute export",
            spotifyId: "minute-export",
            settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
          });
          const file = join(dir, "minute-export.json");
          const source = [
            ["2024-11-01 12:00", [0, 1000, 29999]],
            ["2024-11-02 12:00", [45000, 1000, 45000]],
            ["2024-11-03 12:00", [30000, 45000, 1000]],
          ].flatMap(([endTime, durations]) =>
            durations.map((msPlayed) => ({
              endTime,
              msPlayed,
              trackName: "Minute Song",
              artistName: "Artist",
            })),
          );
          await writeFile(file, JSON.stringify(source));
          const raw = await readImportRecords("privacy", [file]);
          assert.ok(raw.every((entry) => entry.ambiguous));
          const oldReview = new ReviewStore();
          await oldReview.initialize(owner, raw);
          for (const entry of raw)
            await oldReview.save(
              owner,
              entry,
              "timestamp",
              "Old conflict",
              "old",
            );
          // A short export row must not delete a previously API-counted play.
          const api = await InfosModel.create({
            owner: owner._id,
            id: targetId,
            played_at: raw[0].at,
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
            provider: "spotify",
            sourceKeys: ["api:short-play"],
          });
          const previous = ImportResolver.prototype.resolve;
          ImportResolver.prototype.resolve = async () => track.toObject();
          try {
            for (let repeat = 0; repeat < 2; repeat++) {
              await writeFile(
                file,
                JSON.stringify(repeat ? [...source].reverse() : source),
              );
              const job = await prepareImport(owner, "privacy", [file], "UTC");
              await runImporter(String(job._id), owner);
              const receipt = await ImporterStateModel.findById(job._id);
              assert.equal(receipt.status, "success");
              assert.equal(receipt.summary.short, 5);
              assert.equal(receipt.summary.ambiguous, 2);
              assert.equal(receipt.summary.added, repeat ? 0 : 1);
              assert.equal(receipt.summary.unchanged, repeat ? 2 : 1);
              assert.equal(
                await InfosModel.countDocuments({ owner: owner._id }),
                2,
              );
              assert.deepEqual(
                await InfosModel.findById(api._id).lean(),
                api.toObject(),
              );
              const pending = await ImportReviewModel.find({
                owner: owner._id,
                status: "pending",
              }).lean();
              assert.equal(pending.length, 2);
              assert.ok(
                pending.every(
                  (item) =>
                    item.category === "timestamp" &&
                    item.record.listenedMs >= 30000,
                ),
              );
            }
          } finally {
            ImportResolver.prototype.resolve = previous;
          }
        },
      );
      await t.test(
        "extended exports retire short timestamp conflicts without hiding qualifying conflicts",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const {
            readImportRecords,
          } = require("../src/tools/importers/records");
          const owner = await UserModel.create({
            username: "Extended skips",
            spotifyId: "extended-skips",
            settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
          });
          const file = join(dir, "extended-skips.json");
          const source = [
            ["2024-11-01T12:00:00Z", [0, 161, 628]],
            ["2024-11-02T12:00:00Z", [45000]],
            ["2024-11-03T12:00:00Z", [0, 45000]],
            ["2024-11-04T12:00:00Z", [30000, 60000]],
          ].flatMap(([ts, durations]) =>
            durations.map((ms_played) => ({
              ts,
              ms_played,
              spotify_track_uri: `spotify:track:${targetId}`,
              master_metadata_track_name: "Song",
              master_metadata_album_artist_name: "Artist",
            })),
          );
          source.push({
            ts: "2024-11-05T12:00:00Z",
            ms_played: 500,
            spotify_track_uri: null,
            master_metadata_track_name: null,
            master_metadata_album_artist_name: null,
          });
          await writeFile(file, JSON.stringify(source));
          const raw = await readImportRecords("full-privacy", [file]);
          const oldReview = new ReviewStore();
          await oldReview.initialize(owner, raw);
          for (const entry of raw.filter((r) => r.ambiguous))
            await oldReview.save(
              owner,
              entry,
              "timestamp",
              "Old conflict",
              "old",
            );
          const api = await InfosModel.create({
            owner: owner._id,
            id: targetId,
            played_at: raw[0].at,
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
            provider: "spotify",
            sourceKeys: ["api:extended-short"],
          });
          const previous = ImportResolver.prototype.resolve;
          ImportResolver.prototype.resolve = async () => track.toObject();
          try {
            for (let repeat = 0; repeat < 2; repeat++) {
              await writeFile(
                file,
                JSON.stringify(repeat ? [...source].reverse() : source),
              );
              const job = await prepareImport(
                owner,
                "full-privacy",
                [file],
                "UTC",
              );
              await runImporter(String(job._id), owner);
              const receipt = await ImporterStateModel.findById(job._id);
              assert.equal(receipt.status, "success");
              assert.equal(receipt.summary.short, 4);
              assert.equal(receipt.summary.invalid, 1);
              assert.equal(receipt.summary.ambiguous, 2);
              assert.equal(receipt.summary.added, repeat ? 0 : 2);
              assert.equal(receipt.summary.updated, 0);
              assert.equal(
                await InfosModel.countDocuments({ owner: owner._id }),
                3,
              );
              assert.deepEqual(
                await InfosModel.findById(api._id).lean(),
                api.toObject(),
              );
              const pending = await ImportReviewModel.find({
                owner: owner._id,
                category: "timestamp",
                status: "pending",
              }).lean();
              assert.equal(pending.length, 2);
              assert.ok(
                pending.every((item) => item.record.listenedMs >= 30000),
              );
              const resolved = await ImportReviewModel.find({
                owner: owner._id,
                status: "resolved",
                outcome: "short",
              }).lean();
              assert.equal(resolved.length, 4);
              assert.ok(resolved.every((item) => item.record.ambiguous));
            }
          } finally {
            ImportResolver.prototype.resolve = previous;
          }
        },
      );
      await t.test(
        "reuploading a minute export does not silently resolve earlier timing decisions",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const owner = await UserModel.create({
            username: "Stable review",
            spotifyId: "stable-review",
            settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
          });
          await InfosModel.create({
            owner: owner._id,
            id: targetId,
            played_at: new Date("2025-01-01T12:02:15Z"),
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
            provider: "spotify",
            sourceKeys: ["api:stable-review"],
          });
          const file = join(dir, "stable-review.json");
          const source = ["12:00", "12:02"].map((time) => ({
            endTime: `2025-01-01 ${time}`,
            trackName: "Stable Song",
            artistName: "Artist",
            msPlayed: 45000,
          }));
          const previous = ImportResolver.prototype.resolve;
          ImportResolver.prototype.resolve = async () => track.toObject();
          let snapshot;
          try {
            for (let repeat = 0; repeat < 2; repeat++) {
              await writeFile(file, JSON.stringify(source));
              const job = await prepareImport(owner, "privacy", [file], "UTC");
              await runImporter(String(job._id), owner);
              const receipt = await ImporterStateModel.findById(job._id);
              assert.equal(receipt.status, "success");
              assert.equal(receipt.summary.added, 0);
              assert.equal(receipt.summary.updated, repeat ? 0 : 1);
              assert.equal(receipt.summary.ambiguous, 1);
              const plays = await InfosModel.find({ owner: owner._id }).lean();
              assert.equal(plays.length, 1);
              if (repeat) assert.deepEqual(plays, snapshot);
              snapshot = plays;
              assert.equal(
                await ImportReviewModel.countDocuments({
                  owner: owner._id,
                  category: "legacy",
                  status: "pending",
                }),
                1,
              );
            }
          } finally {
            ImportResolver.prototype.resolve = previous;
          }
        },
      );
      await t.test(
        "precise exports repair standard recording guesses, retire conflicts and preserve exclusions in either direction",
        async () => {
          const {
            readImportRecords,
          } = require("../src/tools/importers/records");
          const owner = await UserModel.create({
            username: "Upgrade",
            spotifyId: "upgrade",
            settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
          });
          const standardFile = join(dir, "upgrade-standard.json");
          const fullFile = join(dir, "upgrade-full.json");
          const source = [
            ["12:00", 60000],
            ["12:01", 31000],
            ["12:01", 45000],
            ["12:02", 40000],
          ].map(([time, msPlayed]) => ({
            endTime: `2026-01-01 ${time}`,
            msPlayed,
            trackName: "Song",
            artistName: "Artist",
          }));
          await writeFile(standardFile, JSON.stringify(source));
          const standard = await readImportRecords("privacy", [standardFile]);
          const full = source.map((entry, index) => ({
            ts: `${entry.endTime.replace(" ", "T")}:${[23, 10, 55, 1][index].toString().padStart(2, "0")}Z`,
            ms_played: entry.msPlayed,
            spotify_track_uri: `spotify:track:${targetId}`,
            master_metadata_track_name: "Song",
            master_metadata_album_artist_name: "Artist",
          }));
          const prior = await InfosModel.create({
            owner: owner._id,
            id: "wrong-standard-version",
            played_at: standard[0].at,
            durationMs: 180000,
            listenedMs: 60000,
            albumId: "wrong-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
            provider: "spotify",
            listeningSource: "privacy",
            sourceEndedAt: standard[0].at,
            sourceKeys: [standard[0].key],
          });
          const review = new ReviewStore();
          await review.initialize(owner, standard);
          for (const entry of standard.slice(1))
            await review.save(
              owner,
              entry,
              entry.ambiguous ? "timestamp" : "legacy",
              "Old question",
              "old",
            );
          await ImportReviewModel.updateOne(
            { owner: owner._id, "record.key": standard[3].key },
            { status: "resolved", excluded: true, outcome: "excluded" },
          );
          for (const sourceType of [
            "full-privacy",
            "privacy",
            "full-privacy",
          ]) {
            const file = sourceType === "privacy" ? standardFile : fullFile;
            await writeFile(
              file,
              JSON.stringify(sourceType === "privacy" ? source : full),
            );
            const job = await prepareImport(owner, sourceType, [file], "UTC");
            await runImporter(String(job._id), owner);
            const receipt = await ImporterStateModel.findById(job._id);
            assert.equal(receipt.status, "success");
            assert.equal(receipt.summary.ambiguous, 0);
            assert.equal(receipt.summary.excluded, 1);
            assert.equal(
              await InfosModel.countDocuments({ owner: owner._id }),
              3,
            );
            assert.equal(
              await ImportReviewModel.countDocuments({
                owner: owner._id,
                status: "pending",
              }),
              0,
            );
            const repaired = await InfosModel.findById(prior._id);
            assert.equal(repaired.id, targetId);
            assert.equal(repaired.recordingRepair.id, "wrong-standard-version");
            assert.equal(repaired.listeningSource, "full-privacy");
            assert.equal(repaired.listenedMs, 60000);
          }
          assert.equal(
            await ImportReviewModel.countDocuments({
              owner: owner._id,
              outcome: "extended-export",
            }),
            2,
          );
        },
      );
      await t.test(
        "Spotify timing review links API provenance but protects other export claims",
        async () => {
          const {
            reviewTiming,
            applyTimingChoice,
          } = require("../src/tools/importers/review");
          const {
            ImportContext,
          } = require("../src/database/queries/importContext");
          for (const [index, source] of ["privacy", "full-privacy"].entries()) {
            const entry = row({
              key: `api-review-${source}`,
              source,
              provider: "spotify",
              isrc: undefined,
              title: `API review ${source}`,
              at: new Date(Date.UTC(2024, 9, index + 1, 12)),
              precisionMs: source === "privacy" ? 60000 : 1000,
              listenedMs: 120000,
            });
            await save(entry, "legacy");
            const group = recordingKey(entry);
            const mapping = await ImportMappingModel.create({
              owner: user._id,
              recordingKey: group,
              trackId: targetId,
            });
            const apiKey = `api:${targetId}:${entry.at.toISOString()}`;
            const base = {
              owner: user._id,
              id: targetId,
              played_at: new Date(
                +entry.at + (source === "privacy" ? 90000 : -60000),
              ),
              durationMs: 180000,
              albumId: "correct-album",
              primaryArtistId: "artist",
              artistIds: ["artist"],
              provider: "spotify",
            };
            const apiPlay = await InfosModel.create({
              ...base,
              sourceKeys: [apiKey],
            });
            const protectedPlays = await InfosModel.create([
              { ...base, sourceKeys: [`other-export-${source}`] },
              {
                ...base,
                sourceKeys: [`api:claimed-${source}`, `export-${source}`],
              },
              {
                ...base,
                sourceKeys: [`api:reported-${source}`],
                listeningSource: "full-privacy",
                listenedMs: 45000,
              },
              { ...base, provider: "deezer" },
              { ...base, owner: other._id },
            ]);
            const before = await InfosModel.countDocuments();
            const comparison = await reviewTiming(user, group);
            assert.deepEqual(
              comparison.candidates.filter((p) => p.canUse).map((p) => p.id),
              [String(apiPlay._id)],
            );
            const identity = new ImportContext();
            identity.reviewMapping = {
              id: String(mapping._id),
              trackId: targetId,
            };
            for (const play of protectedPlays) {
              await assert.rejects(
                reconcileImport(
                  user,
                  entry,
                  track,
                  "review",
                  0,
                  identity,
                  false,
                  { existingId: String(play._id) },
                ),
                /already linked/,
              );
            }
            const result = await applyTimingChoice(
              user,
              group,
              comparison.rowId,
              comparison.token,
              String(apiPlay._id),
            );
            assert.equal(result.outcome, "updated");
            const saved = await InfosModel.findById(apiPlay._id).lean();
            assert.equal(saved.listenedMs, 120000);
            assert.equal(saved.listeningSource, source);
            assert.deepEqual(saved.sourceKeys, [apiKey, entry.key]);
            assert.equal(+saved.played_at, +apiPlay.played_at);
            assert.equal(await InfosModel.countDocuments(), before);
            assert.equal(
              (await reconcileImport(user, entry, track, "repeat", 0)).outcome,
              "unchanged",
            );
            if (source === "privacy") {
              const precise = {
                ...entry,
                source: "full-privacy",
                spotifyId: targetId,
                key: "precise-after-manual",
                at: new Date(+entry.at + 15000),
                precisionMs: 1000,
                listenedMs: 110000,
              };
              assert.equal(
                (await reconcileImport(user, precise, track, "full", 0))
                  .outcome,
                "updated",
              );
              const upgraded = await InfosModel.findById(apiPlay._id).lean();
              assert.equal(upgraded.listenedMs, 110000);
              assert.equal(upgraded.listeningSource, "full-privacy");
              assert.equal(+upgraded.played_at, +apiPlay.played_at);
              assert.equal(await InfosModel.countDocuments(), before);
              assert.equal(
                (await reconcileImport(user, entry, track, "account-repeat", 0))
                  .outcome,
                "unchanged",
              );
              assert.equal(
                (await InfosModel.findById(apiPlay._id)).listenedMs,
                110000,
              );
            }
          }
        },
      );
      await t.test(
        "extended timing questions use the supplied recording ID without requiring another song choice",
        async () => {
          const {
            reviewTiming,
            applyTimingChoice,
          } = require("../src/tools/importers/review");
          const owner = await UserModel.create({
            username: "Direct timing",
            spotifyId: "direct-timing",
            settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
          });
          const entry = row({
            source: "full-privacy",
            provider: "spotify",
            spotifyId: targetId,
            isrc: undefined,
            key: "direct-timing",
            at: new Date("2026-02-01T12:00:00Z"),
            listenedMs: 60000,
          });
          const review = new ReviewStore();
          await review.initialize(owner, [entry]);
          await review.save(
            owner,
            entry,
            "legacy",
            "Uncertain API time",
            "import",
          );
          const api = await InfosModel.create({
            owner: owner._id,
            id: targetId,
            played_at: new Date(+entry.at + 120000),
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
            provider: "spotify",
            sourceKeys: ["api:direct-timing"],
          });
          const { groups } = await listReviewGroups(owner, "recording");
          assert.equal(groups[0].savedTrackId, targetId);
          assert.equal(
            await ImportMappingModel.countDocuments({ owner: owner._id }),
            0,
          );
          const comparison = await reviewTiming(owner, groups[0]._id);
          assert.equal(comparison.export.track.id, targetId);
          assert.equal(comparison.candidates[0].canUse, true);
          await review.save(
            owner,
            {
              ...entry,
              source: "privacy",
              key: "old-direct-timing",
              precisionMs: 60000,
              spotifyId: undefined,
            },
            "legacy",
            "Older question",
            "old",
          );
          const result = await applyTimingChoice(
            owner,
            groups[0]._id,
            comparison.rowId,
            comparison.token,
            String(api._id),
          );
          assert.equal(result.outcome, "updated");
          assert.equal((await InfosModel.findById(api._id)).listenedMs, 60000);
          assert.equal(
            await InfosModel.countDocuments({ owner: owner._id }),
            1,
          );
          assert.equal(
            (await listReviewGroups(owner, "recording")).groups.length,
            0,
          );
          const excluded = {
            ...entry,
            key: "excluded-precise",
            at: new Date("2026-02-02T12:00:15Z"),
          };
          await review.save(
            owner,
            excluded,
            "legacy",
            "Timing question",
            "import",
          );
          const choice = await reviewTiming(owner, groups[0]._id);
          await applyTimingChoice(
            owner,
            groups[0]._id,
            choice.rowId,
            choice.token,
            null,
            true,
          );
          const file = join(dir, "excluded-older-standard.json");
          await writeFile(
            file,
            JSON.stringify([
              {
                endTime: "2026-02-02 12:00",
                msPlayed: excluded.listenedMs,
                trackName: excluded.title,
                artistName: excluded.artist,
              },
            ]),
          );
          const job = await prepareImport(owner, "privacy", [file], "UTC");
          await runImporter(String(job._id), owner);
          const receipt = await ImporterStateModel.findById(job._id);
          assert.equal(receipt.status, "success");
          assert.equal(receipt.summary.excluded, 1);
          assert.equal(
            await InfosModel.countDocuments({ owner: owner._id }),
            1,
          );
        },
      );
      await t.test(
        "minute exports hold nearby delayed API timestamps instead of inserting duplicates",
        async () => {
          for (const [index, offset] of [
            -210000, 60427, 72933, 158939, 242000, 628000, -712000,
          ].entries()) {
            const entry = row({
              key: `delayed-api-${index}`,
              source: "privacy",
              provider: "spotify",
              isrc: undefined,
              at: new Date(Date.UTC(2024, 11, index + 1, 12)),
              listenedMs: 156686,
              precisionMs: 60000,
            });
            const api = await InfosModel.create({
              owner: user._id,
              id: targetId,
              played_at: new Date(+entry.at + offset),
              durationMs: 180000,
              albumId: "correct-album",
              primaryArtistId: "artist",
              artistIds: ["artist"],
              ...(index % 2
                ? { provider: "spotify", sourceKeys: [`api:delay-${index}`] }
                : {}),
            });
            const before = await InfosModel.countDocuments();
            const result = await reconcileImport(
              user,
              entry,
              track,
              "delayed",
              index,
            );
            assert.equal(result.outcome, "ambiguous");
            assert.equal(await InfosModel.countDocuments(), before);
            assert.deepEqual(
              await InfosModel.findById(api._id).lean(),
              api.toObject(),
            );
            if (offset === 628000) {
              const exact = await InfosModel.create({
                owner: user._id,
                id: targetId,
                played_at: new Date(+entry.at + 20000),
                durationMs: 180000,
                albumId: "correct-album",
                primaryArtistId: "artist",
                artistIds: ["artist"],
                provider: "spotify",
                sourceKeys: ["api:exact-before-distant"],
              });
              assert.equal(
                (await reconcileImport(user, entry, track, "exact", index))
                  .outcome,
                "updated",
              );
              assert.equal(
                (await InfosModel.findById(exact._id)).listenedMs,
                entry.listenedMs,
              );
              assert.deepEqual(
                await InfosModel.findById(api._id).lean(),
                api.toObject(),
              );
            }
            const separate = {
              ...entry,
              key: `separate-${index}`,
              at: new Date(+entry.at + 3600000),
            };
            assert.equal(
              (await reconcileImport(user, separate, track, "separate", index))
                .outcome,
              "added",
            );
          }
        },
      );
      await t.test(
        "groups prioritize listen count and sum reported time without repeated evidence",
        async () => {
          const owner = await UserModel.create({
            username: "Summary",
            spotifyId: "summary",
            settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
          });
          const entries = [
            row({ key: "summary-z-1", isrc: "Z", title: "Zulu" }),
            row({
              key: "summary-z-2",
              isrc: "Z",
              title: "Zulu",
              listenedMs: 60000,
            }),
            row({
              key: "summary-z-3",
              isrc: "Z",
              title: "Zulu",
              listenedMs: null,
            }),
            row({ key: "summary-b", isrc: "B", title: "Beta" }),
            row({ key: "summary-a", isrc: "A", title: "Alpha" }),
          ];
          entries.push(entries[4], entries[4]);
          for (let repeat = 0; repeat < 2; repeat++) {
            const store = new ReviewStore();
            await store.initialize(owner, entries);
            for (const entry of entries)
              await store.save(
                owner,
                entry,
                "recording",
                "Unmatched",
                "summary",
              );
          }
          const { groups } = await listReviewGroups(owner, "recording");
          assert.deepEqual(
            groups.map((g) => g.title),
            ["Zulu", "Alpha", "Beta"],
          );
          assert.equal(groups[0].count, 3);
          assert.equal(groups[0].timedCount, 2);
          assert.equal(groups[0].listenedMs, 105000);
          assert.equal(groups[1].count, 1);
          assert.equal(groups[1].sourceRows, 3);
          assert.equal(groups[1].listenedMs, 45000);
        },
      );
      await t.test(
        "direct selection uses current history, preserves account scope and cannot double count",
        async () => {
          const entries = [
            row({
              key: "direct-1",
              isrc: "DIRECT",
              at: new Date("2025-01-01T12:00:00Z"),
            }),
            row({
              key: "direct-2",
              isrc: "DIRECT",
              at: new Date("2025-01-02T12:00:00Z"),
            }),
          ];
          for (const entry of entries) await save(entry);
          const group = recordingKey(entries[0]);
          await assert.rejects(
            applyReview(other, group, targetId),
            /no pending/,
          );
          claimImportWork(String(user._id));
          try {
            await assert.rejects(
              applyReview(user, group, targetId),
              /already running/,
            );
          } finally {
            releaseImportWork(String(user._id));
          }
          // A play arrived after the queue was displayed, before selection.
          const existing = await InfosModel.create({
            owner: user._id,
            id: targetId,
            played_at: entries[0].at,
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
          });
          const before = await InfosModel.countDocuments();
          const result = await applyReview(user, group, targetId);
          assert.equal(result.summary.updated, 1);
          assert.equal(result.summary.added, 1);
          assert.equal(await InfosModel.countDocuments(), before + 1);
          assert.equal(
            (await InfosModel.findById(existing._id)).listenedMs,
            45000,
          );
          assert.equal(
            (await getReviewRows(user, "recording", group)).total,
            0,
          );
          assert.equal(
            await ImportMappingModel.countDocuments({
              owner: user._id,
              recordingKey: group,
            }),
            1,
          );
          await assert.rejects(
            applyReview(user, group, targetId),
            /no pending/,
          );
          assert.equal(await InfosModel.countDocuments(), before + 1);
        },
      );
      await t.test(
        "no-match choices persist across exports, retain evidence and can be reopened",
        async () => {
          const { ImportResolver } = require("../src/tools/importers/resolve");
          const old = ImportResolver.prototype.resolve;
          const XLSX = require("xlsx");
          const file = join(dir, "no-match.xlsx");
          const write = (count) => {
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(
              book,
              XLSX.utils.json_to_sheet(
                Array.from({ length: count }, (_, i) => ({
                  "Song Title":
                    i === 2 ? "New spelling" : "Unavailable Recording",
                  Artist: "Artist",
                  ISRC: "NO-SPOTIFY",
                  Date: new Date(Date.UTC(2025, 2, i + 1, 12)).toISOString(),
                  "Listening Time": 45,
                })),
              ),
              "10_listeningHistory",
            );
            XLSX.writeFile(book, file);
          };
          const group = recordingKey(row({ isrc: "NO-SPOTIFY" }));
          const before = await InfosModel.find().sort({ _id: 1 }).lean();
          try {
            ImportResolver.prototype.resolve = async () => null;
            write(2);
            const initial = await prepareImport(user, "deezer", [file], "UTC");
            await runImporter(String(initial._id), user);
            await assert.rejects(chooseNoMatch(other, group), /no pending/);
            claimImportWork(String(user._id));
            try {
              await assert.rejects(
                chooseNoMatch(user, group),
                /already running/,
              );
            } finally {
              releaseImportWork(String(user._id));
            }

            // An interrupted queue update must leave a retriable saved decision.
            const update = ImportReviewModel.updateMany;
            ImportReviewModel.updateMany = () => {
              throw new Error("Injected no-match checkpoint failure");
            };
            try {
              await assert.rejects(
                chooseNoMatch(user, group),
                /checkpoint failure/,
              );
            } finally {
              ImportReviewModel.updateMany = update;
            }
            await assert.rejects(
              applyReview(user, group, targetId),
              /different recording choice/,
            );
            await chooseNoMatch(user, group);
            await chooseNoMatch(user, group);
            assert.equal(
              (await getReviewRows(user, "recording", group)).total,
              0,
            );
            assert.equal(
              (await getReviewRows(user, "no-match", group)).total,
              2,
            );
            assert.equal(
              (await listReviewGroups(other, "no-match")).groups.length,
              0,
            );

            ImportResolver.prototype.resolve = async () => {
              throw new Error("No-match rows must not call Spotify resolution");
            };
            for (let repeat = 0; repeat < 2; repeat++) {
              write(3);
              const job = await prepareImport(user, "deezer", [file], "UTC");
              await runImporter(String(job._id), user);
              const receipt = await ImporterStateModel.findById(job._id);
              assert.equal(receipt.status, "success");
              assert.equal(receipt.summary.noMatch, 3);
              assert.equal(receipt.summary.added, 0);
              assert.equal(receipt.summary.unresolved, 0);
              assert.equal(receipt.issueCounts.recording, 0);
              const saved = (
                await listReviewGroups(user, "no-match")
              ).groups.find((g) => g._id === group);
              assert.equal(saved.count, 3);
              assert.equal(saved.listenedMs, 135000);
              assert.equal(saved.noMatch, true);
            }
            assert.deepEqual(
              await InfosModel.find().sort({ _id: 1 }).lean(),
              before,
            );
            await chooseNoMatch(other, group, true);
            assert.equal(
              (await getReviewRows(user, "no-match", group)).total,
              3,
            );
            const {
              up,
            } = require("../src/migrations/1790592000004-add_no_match_review");
            await up();
            await up();
            assert.equal(
              (await getReviewRows(user, "no-match", group)).total,
              3,
            );

            ImportReviewModel.updateMany = () => {
              throw new Error("Injected reopen checkpoint failure");
            };
            try {
              await assert.rejects(
                chooseNoMatch(user, group, true),
                /checkpoint failure/,
              );
            } finally {
              ImportReviewModel.updateMany = update;
            }
            await chooseNoMatch(user, group, true);
            await chooseNoMatch(user, group, true);
            assert.equal(
              (await getReviewRows(user, "no-match", group)).total,
              0,
            );
            assert.equal(
              (await getReviewRows(user, "recording", group)).total,
              3,
            );
            assert.equal(
              await ImportMappingModel.countDocuments({
                owner: user._id,
                recordingKey: group,
              }),
              0,
            );
            const selected = await applyReview(user, group, targetId);
            assert.equal(selected.summary.added, 3);
            await assert.rejects(chooseNoMatch(user, group), /already saved/);
          } finally {
            ImportResolver.prototype.resolve = old;
          }
        },
      );
      await t.test(
        "no-match never discards existing plays or hides source timing conflicts",
        async () => {
          const entry = row({
            key: "no-match-conflict",
            isrc: "CONFLICT-NO-MATCH",
            at: new Date("2025-05-01T12:00:00Z"),
          });
          const existing = await InfosModel.create({
            owner: user._id,
            id: targetId,
            played_at: entry.at,
            durationMs: 180000,
            albumId: "correct-album",
            primaryArtistId: "artist",
            artistIds: ["artist"],
          });
          const before = await InfosModel.findById(existing._id).lean();
          await save(entry, "legacy");
          const group = recordingKey(entry);
          await chooseNoMatch(user, group);
          assert.deepEqual(
            await InfosModel.findById(existing._id).lean(),
            before,
          );
          const mapping = await ImportMappingModel.findOne({
            owner: user._id,
            recordingKey: group,
          });
          const store = new ReviewStore();
          const changed = { ...entry, listenedMs: 55000 };
          await store.initialize(user, [changed]);
          assert.equal(
            await store.noMatch(
              user,
              changed,
              "conflicting-export",
              String(mapping._id),
            ),
            "timestamp",
          );
          assert.equal((await getReviewRows(user, "no-match", group)).total, 0);
          const conflict = await ImportReviewModel.find({
            owner: user._id,
            recordingKey: group,
          });
          assert.equal(conflict.length, 2);
          assert.ok(
            conflict.every(
              (r) => r.category === "timestamp" && r.status === "pending",
            ),
          );
          await chooseNoMatch(user, group, true);
          assert.deepEqual(
            await InfosModel.findById(existing._id).lean(),
            before,
          );
          assert.equal(
            await ImportReviewModel.countDocuments({
              owner: user._id,
              recordingKey: group,
              category: "timestamp",
              status: "pending",
            }),
            2,
          );
        },
      );
      for (const exclude of [false, true])
        for (const competitor of [
          "pending",
          "resolved",
          "excluded",
          "saved",
          "none",
          "other-owner",
        ])
          await t.test(
            `${exclude ? "excluding" : "accepting"} a precise event checks ${competitor} competing evidence before resolving a minute row`,
            async () => {
              const {
                reviewTiming,
                applyTimingChoice,
              } = require("../src/tools/importers/review");
              const {
                SpotifyReviewLinks,
              } = require("../src/database/queries/privacyRules");
              const owner = await UserModel.create({
                username: "Precise uniqueness",
                spotifyId: `unique-${exclude}-${competitor}`,
                settings: { dateFormat: "default" },
              });
              const standard = row({
                source: "privacy",
                provider: "spotify",
                isrc: undefined,
                key: "minute",
                at: new Date("2027-03-01T12:00:00Z"),
                precisionMs: 60000,
                listenedMs: 31000,
              });
              const a = {
                ...standard,
                source: "full-privacy",
                spotifyId: targetId,
                precisionMs: 1000,
                key: "precise-a",
                at: new Date(+standard.at + 20000),
              };
              const b = {
                ...a,
                key: "precise-b",
                at: new Date(+standard.at + 51000),
              };
              const store = new ReviewStore();
              await store.initialize(owner, [standard, a, b]);
              for (const entry of [standard, a])
                await store.save(
                  owner,
                  entry,
                  "legacy",
                  "Timing question",
                  "import",
                );
              if (competitor === "saved") {
                await reconcileImport(owner, b, track, "previous", 0);
              } else if (competitor !== "none") {
                const account = competitor === "other-owner" ? other : owner;
                await store.save(
                  account,
                  b,
                  "legacy",
                  "Timing question",
                  "earlier-import",
                );
                if (["resolved", "excluded"].includes(competitor))
                  await ImportReviewModel.updateOne(
                    { owner: owner._id, "record.key": b.key },
                    {
                      status: "resolved",
                      outcome: competitor === "excluded" ? "excluded" : "added",
                      excluded: competitor === "excluded",
                    },
                  );
              }
              const group = recordingKey(a);
              const comparison = await reviewTiming(owner, group);
              const result = await applyTimingChoice(
                owner,
                group,
                comparison.rowId,
                comparison.token,
                null,
                exclude,
              );
              assert.equal(result.outcome, exclude ? "excluded" : "added");
              const unique = ["none", "other-owner"].includes(competitor);
              const saved = await ImportReviewModel.findOne({
                owner: owner._id,
                "record.key": standard.key,
              }).lean();
              assert.equal(saved.status, unique ? "resolved" : "pending");
              assert.equal(Boolean(saved.excluded), unique && exclude);
              if (unique) {
                assert.equal(saved.resolvedBy, a.key);
                assert.equal(
                  saved.outcome,
                  exclude ? "excluded" : "extended-export",
                );
              } else {
                assert.equal(saved.resolvedBy, undefined);
              }
              // The reverse import direction must obey the same uniqueness rule.
              const links = new SpotifyReviewLinks();
              await links.initialize(owner, [standard]);
              assert.equal(links.isExcluded(standard), unique && exclude);
              const before = await InfosModel.find({ owner: owner._id }).lean();
              await applyTimingChoice(
                owner,
                group,
                comparison.rowId,
                comparison.token,
                null,
                exclude,
              );
              assert.deepEqual(
                await InfosModel.find({ owner: owner._id }).lean(),
                before,
              );
            },
          );
      for (const newer of [20, 30, 0])
        await t.test(
          `timing recovery exposes the linked listen ${newer ? `behind ${newer} newer candidates` : "outside the time window"}`,
          async () => {
            const {
              reviewTiming,
              applyTimingChoice,
            } = require("../src/tools/importers/review");
            const owner = await UserModel.create({
              username: "Interrupted review",
              spotifyId: `interrupted-${newer}`,
              settings: { dateFormat: "default" },
            });
            const entry = row({
              source: "full-privacy",
              provider: "spotify",
              spotifyId: track.id,
              isrc: undefined,
              key: `interrupted-${newer}`,
              at: new Date("2027-03-01T12:00:00Z"),
            });
            await reconcileImport(owner, entry, track, "interrupted", 0);
            const linked = await InfosModel.findOne({ owner: owner._id });
            if (!newer) {
              linked.played_at = new Date(+entry.at - 86400000);
              await linked.save();
            }
            const store = new ReviewStore();
            await store.initialize(owner, [entry]);
            await store.save(owner, entry, "legacy", "Timing question", "job");
            await InfosModel.insertMany(
              Array.from({ length: newer }, (_, index) => ({
                owner: owner._id,
                id: track.id,
                albumId: track.album,
                primaryArtistId: track.artists[0],
                durationMs: track.duration_ms,
                provider: "spotify",
                played_at: new Date(+entry.at + (index + 1) * 1000),
              })),
            );
            const group = recordingKey(entry);
            const comparison = await reviewTiming(owner, group);
            assert.equal(comparison.canAdd, false);
            const usable = comparison.candidates.filter((play) => play.canUse);
            assert.deepEqual(
              usable.map((play) => play.id),
              [String(linked._id)],
            );
            await applyTimingChoice(
              owner,
              group,
              comparison.rowId,
              comparison.token,
              String(linked._id),
            );
            assert.equal(
              await InfosModel.countDocuments({ owner: owner._id }),
              newer + 1,
            );
            assert.equal(
              (await ImportReviewModel.findById(comparison.rowId)).status,
              "resolved",
            );
          },
        );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
