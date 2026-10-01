const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtemp, rm } = require("node:fs/promises");
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
test(
  "Deezer longest-duration and estimated-time policy",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async (t) => {
    const mongoose = require("mongoose");
    const XLSX = require("xlsx");
    const {
      InfosModel,
      TrackModel,
      UserModel,
      ImporterStateModel,
      ImportReviewModel,
      ImportMappingModel,
    } = require("../src/database/Models");
    const {
      prepareImport,
      runImporter,
    } = require("../src/tools/importers/importer");
    const { readImportRecords } = require("../src/tools/importers/records");
    const {
      ReviewStore,
      listReviewGroups,
    } = require("../src/database/queries/importReview");
    const { recordingKey } = require("../src/tools/importers/reviewIdentity");
    const {
      applyReview,
      chooseNoMatch,
      reviewTiming,
      applyTimingChoice,
    } = require("../src/tools/importers/review");
    const { ImportResolver } = require("../src/tools/importers/resolve");
    const { statisticsFor } = require("../src/database/listeningDuration");
    const { SpotifyAPI } = require("../src/tools/apis/spotifyApi");
    const dir = await mkdtemp(join(tmpdir(), "deezer-rules-"));
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: "deezer_rules_test_" + Date.now(),
    });
    let sequence = 0;
    const at = "2024-01-01T12:00:00Z";
    const source = (name, seconds, extra = {}) => ({
      "Song Title": name,
      Artist: "Artist",
      ISRC: name.toUpperCase(),
      "Listening Time": seconds,
      Date: at,
      ...extra,
    });
    const write = (records) => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(records),
        "10_listeningHistory",
      );
      const file = join(dir, "export-" + sequence++ + ".xlsx");
      XLSX.writeFile(book, file);
      return file;
    };
    const account = () =>
      UserModel.create({
        username: "Rules",
        spotifyId: "rules-" + sequence++,
        settings: { timezone: "UTC", dateFormat: "yyyy-MM-dd" },
      });
    const run = async (user, records, old = false) => {
      const file = write(records);
      const job = await prepareImport(user, "deezer", [file], "UTC", true);
      if (old)
        await ImporterStateModel.updateOne(
          { _id: job._id },
          { $unset: { deezerPolicyVersion: 1 } },
        );
      await runImporter(String(job._id), user);
      const receipt = await ImporterStateModel.findById(job._id).lean();
      assert.equal(receipt.status, "success", receipt.error);
      assert.equal(
        Object.entries(receipt.summary)
          .filter(([key]) => key !== "deltaMs")
          .reduce((sum, [, value]) => sum + value, 0),
        records.length,
      );
      return receipt;
    };
    const plays = (user) =>
      InfosModel.find({ owner: user._id }).sort({ id: 1 }).lean();
    const legacy = (user, track, extra = {}) =>
      InfosModel.create({
        owner: user._id,
        id: track.id,
        played_at: new Date(at),
        durationMs: track.duration_ms,
        albumId: track.album,
        artistIds: track.artists,
        primaryArtistId: track.artists[0],
        ...extra,
      });
    const oldRaw = SpotifyAPI.prototype.raw;
    const oldGet = SpotifyAPI.prototype.getTracks;
    SpotifyAPI.prototype.raw = async () => {
      throw new Error("Unexpected catalog call");
    };
    SpotifyAPI.prototype.getTracks = async () => {
      throw new Error("Unexpected catalog call");
    };
    try {
      await Promise.all([
        InfosModel.init(),
        ImportReviewModel.init(),
        ImportMappingModel.init(),
      ]);
      const tracks = await TrackModel.create(
        ["Alpha", "Beta", "Gamma"].map((name, i) => ({
          id: String(i + 1).repeat(22),
          name,
          album: "album",
          artists: ["artist"],
          duration_ms: 180000 + i * 15000,
          external_ids: { isrc: name.toUpperCase() },
        })),
      );
      await t.test(
        "longest per recording, distinct recordings retained, raw evidence and repeat/reverse order stable",
        async () => {
          const user = await account();
          const records = [
            source("Alpha", 45),
            source("Alpha", 90),
            source("Alpha", 10),
            source("Alpha", 90, { "Song Title": "Alpha renamed" }),
            source("Beta", 50),
            source("Gamma", -1),
          ];
          const first = await run(user, records);
          assert.equal(first.summary.added, 3);
          assert.equal(first.summary.duplicates, 3);
          assert.equal(first.estimated, 1);
          const before = await plays(user);
          assert.deepEqual(
            before.map((p) => p.listenedMs),
            [90000, 50000, undefined],
          );
          assert.ok(
            before.every(
              (p) => p.timestampUncertain && p.listeningSource === "deezer",
            ),
          );
          const stats = await statisticsFor(user).aggregate([
            { $match: { owner: user._id } },
            { $group: { _id: null, ms: { $sum: "$durationMs" } } },
          ]);
          assert.equal(stats[0].ms, 350000);
          const evidence = await ImportReviewModel.find({
            owner: user._id,
          }).lean();
          assert.equal(evidence.length, 6);
          assert.ok(evidence.every((r) => r.status === "resolved"));
          assert.ok(
            evidence.some(
              (r) =>
                r.record.sourceListeningTime === "-1" &&
                r.record.listenedMs === null,
            ),
          );
          const repeat = await run(user, [...records].reverse());
          assert.equal(repeat.summary.added, 0);
          assert.equal(repeat.summary.updated, 0);
          assert.equal(repeat.summary.deltaMs, 0);
          assert.equal(repeat.summary.unchanged, 3);
          assert.deepEqual(await plays(user), before);
        },
      );
      await t.test(
        "later shorter/unknown exports cannot reduce measured time; longer ones correct the same event",
        async () => {
          const user = await account();
          await run(user, [source("Alpha", 120)]);
          const first = (await plays(user))[0];
          for (const rows of [
            [source("Alpha", 50), source("Alpha", -1)],
            [source("Alpha", -1)],
          ]) {
            const result = await run(user, rows);
            assert.equal(result.summary.updated, 0);
            assert.equal(result.estimated, 0);
            assert.equal((await plays(user))[0].listenedMs, 120000);
          }
          const longer = await run(user, [
            source("Alpha", 180, { "Song Title": "Renamed again" }),
          ]);
          assert.equal(longer.summary.updated, 1);
          assert.equal(longer.summary.deltaMs, 60000);
          const final = await plays(user);
          assert.equal(final.length, 1);
          assert.equal(String(final[0]._id), String(first._id));
          assert.equal(final[0].listenedMs, 180000);
        },
      );
      await t.test(
        "unknown duration uses a legacy play's full length and later measured time replaces it",
        async () => {
          const user = await account();
          const old = await legacy(user, tracks[0]);
          const estimated = await run(user, [source("Alpha", -1)]);
          assert.equal(estimated.estimated, 1);
          assert.equal(estimated.summary.added, 0);
          let saved = (await plays(user))[0];
          assert.equal(saved.listenedMs, undefined);
          assert.equal(saved.durationMs, 180000);
          assert.equal(String(saved._id), String(old._id));
          const corrected = await run(user, [source("Alpha", 45)]);
          assert.equal(corrected.summary.updated, 1);
          saved = (await plays(user))[0];
          assert.equal(saved.listenedMs, 45000);
          await run(user, [source("Alpha", -1)]);
          assert.equal((await plays(user))[0].listenedMs, 45000);
        },
      );
      await t.test(
        "several existing songs at a timestamp are matched individually",
        async () => {
          const user = await account();
          const oldA = await legacy(user, tracks[0]);
          const oldB = await legacy(user, tracks[1]);
          const result = await run(user, [
            source("Gamma", 60),
            source("Alpha", 45),
            source("Beta", 50),
          ]);
          assert.equal(result.summary.updated, 2);
          assert.equal(result.summary.added, 1);
          assert.equal(result.summary.ambiguous, 0);
          const saved = await plays(user);
          assert.equal(saved.length, 3);
          assert.equal(String(saved[0]._id), String(oldA._id));
          assert.equal(String(saved[1]._id), String(oldB._id));
        },
      );
      await t.test(
        "old conflict/invalid review queues resolve with originals retained; old prepared jobs keep old policy",
        async () => {
          const user = await account();
          const rows = [
            source("Alpha", 45),
            source("Alpha", 90),
            source("Beta", 50),
            source("Gamma", -1),
          ];
          const old = await run(user, rows, true);
          assert.equal(old.summary.ambiguous, 3);
          assert.equal(old.summary.invalid, 1);
          assert.equal((await plays(user)).length, 0);
          const resolved = await run(user, rows);
          assert.equal(resolved.summary.added, 3);
          assert.equal(resolved.summary.duplicates, 1);
          assert.equal(
            await ImportReviewModel.countDocuments({
              owner: user._id,
              status: "pending",
            }),
            0,
          );
          assert.equal(
            await ImportReviewModel.countDocuments({ owner: user._id }),
            4,
          );
        },
      );
      await t.test(
        "unknown durations and duplicate evidence can wait for a manual match without blocking each other",
        async () => {
          const user = await account();
          const resolve = ImportResolver.prototype.resolve;
          ImportResolver.prototype.resolve = async () => null;
          try {
            await run(user, [
              source("Unavailable", -1),
              source("Unavailable", -1),
              source("Unavailable", 50, { Date: "2024-01-02T12:00:00Z" }),
            ]);
          } finally {
            ImportResolver.prototype.resolve = resolve;
          }
          const group = (await listReviewGroups(user, "recording")).groups[0];
          assert.equal(group.count, 2);
          const result = await applyReview(user, group._id, tracks[0].id);
          assert.equal(result.summary.added, 2);
          const saved = await plays(user);
          assert.equal(
            saved.filter((p) => p.listenedMs === undefined).length,
            1,
          );
          assert.equal(
            await ImportReviewModel.countDocuments({
              owner: user._id,
              status: "pending",
            }),
            0,
          );
        },
      );
      await t.test(
        "saved no-match choices survive duplicate resolution and keep only one pending event when reopened",
        async () => {
          const user = await account();
          const rows = [source("Alpha", 45), source("Alpha", 90)];
          const file = write(rows);
          const raw = await readImportRecords("deezer", [file], "UTC");
          const store = new ReviewStore();
          await store.initialize(user, raw);
          // Start from an earlier unmatched recording, before a user chose no match.
          await store.save(
            user,
            { ...raw[0], ambiguous: false },
            "recording",
            "Unmatched",
            "old",
          );
          const group = recordingKey(raw[0]);
          await chooseNoMatch(user, group);
          const result = await run(user, rows);
          assert.equal(result.summary.noMatch, 1);
          assert.equal(result.summary.duplicates, 1);
          assert.equal((await plays(user)).length, 0);
          assert.equal(
            (await listReviewGroups(user, "no-match")).groups[0].count,
            1,
          );
          await chooseNoMatch(user, group, true);
          assert.equal(
            (await listReviewGroups(user, "recording")).groups[0].count,
            1,
          );
        },
      );
      await t.test(
        "checkpoint interruption retries the chosen event once",
        async () => {
          const user = await account();
          const file = write([
            source("Alpha", 45),
            source("Alpha", 90),
            source("Gamma", -1),
          ]);
          const job = await prepareImport(user, "deezer", [file], "UTC");
          const update = ImporterStateModel.updateOne;
          let fail = true;
          ImporterStateModel.updateOne = function (filter, change, ...rest) {
            if (fail && change.current === 1) {
              fail = false;
              throw new Error("Injected checkpoint failure");
            }
            return update.call(this, filter, change, ...rest);
          };
          try {
            await runImporter(String(job._id), user);
          } finally {
            ImporterStateModel.updateOne = update;
          }
          assert.equal(
            (await ImporterStateModel.findById(job._id)).status,
            "failure",
          );
          await runImporter(String(job._id), user);
          const result = await ImporterStateModel.findById(job._id);
          assert.equal(result.status, "success");
          assert.equal(result.summary.added, 2);
          assert.equal(result.summary.duplicates, 1);
          assert.equal((await plays(user)).length, 2);
        },
      );
      await t.test(
        "bad dates/identities remain invalid and reported short listens remain excluded",
        async () => {
          const user = await account();
          const result = await run(user, [
            source("Alpha", -1, { Date: "not a date" }),
            source("Alpha", -1, { Artist: "" }),
            source("Beta", 12),
            source("Gamma", 0),
          ]);
          assert.equal(result.summary.invalid, 2);
          assert.equal(result.summary.short, 2);
          assert.equal((await plays(user)).length, 0);
        },
      );
      await t.test(
        "timing comparison links a selected legacy listen, checks stale choices, and survives reimports",
        async () => {
          const user = await account();
          const other = await account();
          const old = await legacy(user, tracks[0], {
            played_at: new Date("2024-01-01T11:59:30Z"),
          });
          const foreign = await legacy(other, tracks[0]);
          const records = [source("Alpha", 90)];
          await run(user, records);
          const group = (await listReviewGroups(user, "recording")).groups[0]
            ._id;
          const selected = await applyReview(user, group, tracks[0].id);
          assert.equal(selected.summary.ambiguous, 1);
          const first = await reviewTiming(user, group);
          assert.equal(first.candidates.length, 1);
          assert.equal(first.candidates[0].id, String(old._id));
          assert.equal(first.candidates[0].canUse, true);
          assert.equal(first.export.listenedMs, 90000);
          await assert.rejects(reviewTiming(other, group), /no longer pending/);
          await assert.rejects(
            applyTimingChoice(
              user,
              group,
              first.rowId,
              first.token,
              String(foreign._id),
            ),
            /cannot be used/,
          );
          await InfosModel.updateOne({ _id: old._id }, { durationMs: 190000 });
          await assert.rejects(
            applyTimingChoice(
              user,
              group,
              first.rowId,
              first.token,
              String(old._id),
            ),
            /History changed/,
          );
          const fresh = await reviewTiming(user, group);
          const result = await applyTimingChoice(
            user,
            group,
            fresh.rowId,
            fresh.token,
            String(old._id),
          );
          assert.equal(result.outcome, "updated");
          assert.equal(result.deltaMs, -100000);
          const after = await plays(user);
          assert.equal(after.length, 1);
          assert.equal(
            after[0].played_at.toISOString(),
            "2024-01-01T11:59:30.000Z",
          );
          assert.equal(after[0].listenedMs, 90000);
          await applyTimingChoice(
            user,
            group,
            fresh.rowId,
            fresh.token,
            String(old._id),
          );
          const repeated = await run(user, records);
          assert.equal(repeated.summary.added, 0);
          assert.equal(repeated.summary.updated, 0);
          assert.deepEqual(await plays(user), after);
          assert.equal(
            (await listReviewGroups(user, "recording")).groupCounts.recording,
            0,
          );
        },
      );
      await t.test(
        "a timing choice can repair a legacy version without stealing another exported recording",
        async () => {
          const variant = await TrackModel.create({
            id: "4".repeat(22),
            name: "Alpha",
            album: "album",
            artists: ["artist"],
            duration_ms: 150000,
            external_ids: { isrc: "ALPHA-OTHER" },
          });
          const user = await account();
          const old = await legacy(user, variant);
          const records = [
            source("Alpha", 240),
            source("Alpha", 1, { ISRC: "ALPHA-OTHER" }),
          ];
          await run(user, records);
          const group = (await listReviewGroups(user, "recording")).groups[0]
            ._id;
          await applyReview(user, group, tracks[0].id);
          const comparison = await reviewTiming(user, group);
          await applyTimingChoice(
            user,
            group,
            comparison.rowId,
            comparison.token,
            String(old._id),
          );
          const [corrected] = await plays(user);
          assert.equal(corrected.id, tracks[0].id);
          assert.equal(corrected.recordingRepair.id, variant.id);
          assert.equal(corrected.listenedMs, 240000);
          assert.equal((await run(user, records)).summary.added, 0);
          assert.equal((await plays(user)).length, 1);

          const separateUser = await account();
          const separateRows = [
            source("Alpha", 208, { ISRC: "ALPHA-OTHER" }),
            source("Alpha", 206),
          ];
          await run(separateUser, separateRows);
          const separateGroup = (
            await listReviewGroups(separateUser, "recording")
          ).groups[0]._id;
          await applyReview(separateUser, separateGroup, tracks[0].id);
          const separate = await reviewTiming(separateUser, separateGroup);
          const protectedPlay = separate.candidates.find(
            (play) => play.track.id === variant.id,
          );
          assert.equal(protectedPlay.canUse, false);
          await assert.rejects(
            applyTimingChoice(
              separateUser,
              separateGroup,
              separate.rowId,
              separate.token,
              protectedPlay.id,
            ),
            /cannot be used/,
          );
          const result = await applyTimingChoice(
            separateUser,
            separateGroup,
            separate.rowId,
            separate.token,
            null,
          );
          assert.equal(result.outcome, "added");
          const beforeRepeat = await plays(separateUser);
          assert.equal(beforeRepeat.length, 2);
          await applyTimingChoice(
            separateUser,
            separateGroup,
            separate.rowId,
            separate.token,
            null,
          );
          const repeat = await run(separateUser, separateRows);
          assert.equal(repeat.summary.added, 0);
          assert.equal(repeat.summary.updated, 0);
          assert.deepEqual(await plays(separateUser), beforeRepeat);
        },
      );
      await t.test(
        "declining one listen preserves history and survives changed/repeated exports without excluding other listens",
        async () => {
          const user = await account();
          const other = await account();
          const old = await legacy(user, tracks[0], {
            played_at: new Date("2024-01-01T11:59:30Z"),
          });
          await run(user, [source("Alpha", 90)]);
          const group = (await listReviewGroups(user, "recording")).groups[0]
            ._id;
          await applyReview(user, group, tracks[0].id);
          const stale = await reviewTiming(user, group);
          await assert.rejects(
            applyTimingChoice(
              other,
              group,
              stale.rowId,
              stale.token,
              null,
              true,
            ),
            /no longer pending/,
          );
          await InfosModel.updateOne({ _id: old._id }, { durationMs: 190000 });
          await assert.rejects(
            applyTimingChoice(
              user,
              group,
              stale.rowId,
              stale.token,
              null,
              true,
            ),
            /History changed/,
          );
          const choice = await reviewTiming(user, group);
          const before = await plays(user);
          const declined = await applyTimingChoice(
            user,
            group,
            choice.rowId,
            choice.token,
            null,
            true,
          );
          assert.equal(declined.outcome, "excluded");
          assert.equal(declined.deltaMs, 0);
          assert.deepEqual(await plays(user), before);
          assert.equal(
            (await listReviewGroups(user, "recording")).groupCounts.recording,
            0,
          );
          assert.equal(
            (
              await applyTimingChoice(
                user,
                group,
                choice.rowId,
                choice.token,
                null,
                true,
              )
            ).outcome,
            "excluded",
          );
          for (const records of [
            [source("Alpha", 90)],
            [
              source("Alpha renamed", 180, { ISRC: "ALPHA" }),
              source("Alpha", 45),
            ],
            [source("Alpha", 240)],
          ]) {
            const receipt = await run(user, records);
            assert.equal(receipt.summary.excluded, 1);
            assert.equal(receipt.summary.added, 0);
            assert.equal(receipt.summary.updated, 0);
            assert.equal(receipt.summary.ambiguous, 0);
            assert.equal(receipt.summary.deltaMs, 0);
            assert.deepEqual(await plays(user), before);
            assert.equal(
              (await listReviewGroups(user, "recording")).groupCounts.recording,
              0,
            );
          }
          const evidence = await ImportReviewModel.findById(
            choice.rowId,
          ).lean();
          assert.equal(evidence.excluded, true);
          assert.equal(evidence.record.listenedMs, 90000);
          assert.equal(
            (
              await ImportMappingModel.findOne({
                owner: user._id,
                recordingKey: group,
              })
            ).trackId,
            tracks[0].id,
          );
          assert.equal(
            (
              await run(user, [
                source("Alpha", 90, { Date: "2024-01-02T12:00:00Z" }),
              ])
            ).summary.added,
            1,
          );
          assert.equal(
            (await run(other, [source("Alpha", 90)])).summary.added,
            1,
          );
          const {
            up,
          } = require("../src/migrations/1790592000006-add_excluded_import_listens");
          await up();
          await up();
          assert.equal(
            (await ImportReviewModel.findById(choice.rowId)).excluded,
            true,
          );
        },
      );
      await t.test(
        "decline cannot hide a listen already written before a failed review checkpoint",
        async () => {
          const user = await account();
          await legacy(user, tracks[0], {
            played_at: new Date("2024-01-01T11:59:30Z"),
          });
          await run(user, [source("Alpha", 90)]);
          const group = (await listReviewGroups(user, "recording")).groups[0]
            ._id;
          await applyReview(user, group, tracks[0].id);
          const choice = await reviewTiming(user, group);
          const update = ImportReviewModel.updateOne;
          ImportReviewModel.updateOne = () => {
            throw new Error("Injected queue checkpoint failure");
          };
          try {
            await assert.rejects(
              applyTimingChoice(user, group, choice.rowId, choice.token, null),
              /checkpoint failure/,
            );
          } finally {
            ImportReviewModel.updateOne = update;
          }
          const fresh = await reviewTiming(user, group);
          assert.equal(fresh.canAdd, false);
          const before = await plays(user);
          await assert.rejects(
            applyTimingChoice(
              user,
              group,
              fresh.rowId,
              fresh.token,
              null,
              true,
            ),
            /already linked/,
          );
          assert.deepEqual(await plays(user), before);
          assert.equal(
            (await ImportReviewModel.findById(fresh.rowId)).excluded,
            undefined,
          );
          await applyTimingChoice(
            user,
            group,
            fresh.rowId,
            fresh.token,
            fresh.candidates.find((p) => p.canUse).id,
          );
          assert.equal(
            (await listReviewGroups(user, "recording")).groupCounts.recording,
            0,
          );
        },
      );
      await t.test(
        "dropdown totals count groups across every view, including no-match and shared legacy groups",
        async () => {
          const user = await account();
          const file = write([
            source("Alpha", 45),
            source("Alpha", 60, { Date: "2024-01-02T12:00:00Z" }),
            source("Beta", 60),
          ]);
          const rows = await readImportRecords("deezer", [file], "UTC");
          const store = new ReviewStore();
          await store.initialize(user, rows);
          await store.save(user, rows[0], "recording", "test", "test");
          await store.save(user, rows[1], "legacy", "test", "test");
          await store.save(user, rows[2], "recording", "test", "test");
          await chooseNoMatch(user, recordingKey(rows[2]));
          for (const view of [
            "recording",
            "timestamp",
            "invalid",
            "no-match",
          ]) {
            const queue = await listReviewGroups(user, view);
            assert.deepEqual(queue.groupCounts, {
              recording: 1,
              timestamp: 0,
              invalid: 0,
              "no-match": 1,
            });
            assert.equal(queue.groupCounts[view], queue.groups.length);
            assert.equal(
              queue.counts.find((count) => count._id === "legacy").count,
              1,
            );
          }
          await chooseNoMatch(user, recordingKey(rows[2]), true);
          assert.equal(
            (await listReviewGroups(user, "recording")).groupCounts.recording,
            2,
          );
        },
      );
      await t.test(
        "policy migration is repeatable without changing stored plays",
        async () => {
          const {
            up,
          } = require("../src/migrations/1790592000005-add_deezer_import_rules");
          const before = await InfosModel.find().sort({ _id: 1 }).lean();
          await up();
          await up();
          assert.deepEqual(
            await InfosModel.find().sort({ _id: 1 }).lean(),
            before,
          );
        },
      );
    } finally {
      SpotifyAPI.prototype.raw = oldRaw;
      SpotifyAPI.prototype.getTracks = oldGet;
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
