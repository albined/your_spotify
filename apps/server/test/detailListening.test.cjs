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
  activityBandwidth,
  listeningRate,
  hourlyComparison,
  mergeListeningBins,
} = require("../../client/src/services/detailListening");
const { calendarGrid } = require("../../client/src/services/listeningPatterns");
const DAY = 86400000;
const HOUR = 3600000;

test("smoothed lifetime activity preserves hours at boundaries and scales peaks linearly", () => {
  for (const days of [1 / 24, 1, 7, 365, 365 * 8, 365 * 20]) {
    const input = {
      start: 0,
      end: days * DAY,
      width: (days * DAY) / 1024,
      activity: [
        [0, 1],
        [400, 3],
        [1023, 2],
      ],
    };
    const points = listeningRate(input);
    assert.equal(points.length, 512);
    assert.equal(points[0].timestamp, 0);
    assert.ok(Math.abs(points.at(-1).timestamp - input.end) < 0.01);
    const stepDays = days / (points.length - 1);
    const area = points.reduce(
      (sum, point, i) =>
        sum +
        point.series0 *
          stepDays *
          (i === 0 || i === points.length - 1 ? 0.5 : 1),
      0,
    );
    assert.ok(Math.abs(area - 6) < 1e-8);
    assert.ok(
      points.every(
        (point) => Number.isFinite(point.series0) && point.series0 >= 0,
      ),
    );
    const doubled = listeningRate({
      ...input,
      activity: input.activity.map(([bin, hours]) => [bin, 2 * hours]),
    });
    assert.ok(
      points.every(
        (point, i) => Math.abs(doubled[i].series0 - 2 * point.series0) < 1e-8,
      ),
    );
  }
  assert.equal(activityBandwidth(365 * DAY), 5 * DAY);
  assert.equal(activityBandwidth(365 * 20 * DAY), 28 * DAY);
  const quiet = listeningRate({
    start: 0,
    end: 365 * 8 * DAY,
    width: (365 * 8 * DAY) / 1024,
    activity: [
      [0, 1],
      [1023, 1],
    ],
  });
  assert.equal(quiet[256].series0, 0);
  assert.ok(
    quiet.some((point, i) => i > 0 && point.series0 < quiet[i - 1].series0),
  );
  assert.deepEqual(
    listeningRate({ start: 1, end: 1, width: 0, activity: [] }),
    [],
  );
});

test("album matrix merging keeps all hours and hourly comparison normalizes each population", () => {
  for (const columns of [1, 3, 17, 41, 64]) {
    const bins = [
      [0, 1],
      [1, 2],
      [500, 3],
      [1023, 4],
    ];
    const values = mergeListeningBins(bins, 1024, columns);
    assert.equal(
      values.reduce((sum, value) => sum + value, 0),
      10,
    );
    assert.equal(values.length, columns);
    assert.ok(values.every((value) => value >= 0));
  }
  const artist = Array(24).fill(0);
  artist[0] = 1;
  artist[12] = 3;
  const overall = Array(24).fill(0);
  overall[0] = 500;
  overall[12] = 500;
  const comparison = hourlyComparison({ artist, overall });
  assert.deepEqual(comparison[0], { hour: "00", artist: 25, overall: 50 });
  assert.deepEqual(comparison[12], { hour: "12", artist: 75, overall: 50 });
  assert.equal(
    comparison.reduce((sum, row) => sum + row.artist, 0),
    100,
  );
  assert.equal(
    comparison.reduce((sum, row) => sum + row.overall, 0),
    100,
  );
  assert.ok(
    hourlyComparison({ artist: [], overall: [] }).every(
      (row) => row.artist === 0 && row.overall === 0,
    ),
  );
});

test(
  "detail queries isolate item and owner, retain lifetime and exact durations, and use local dates",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel, TrackModel } = require("../src/database/Models");
    const {
      getDetailListening,
    } = require("../src/database/queries/detailListening");
    const {
      getArtistTimeline,
    } = require("../src/database/queries/listeningTimeline");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `detail_listening_test_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      const user = {
        _id: owner,
        settings: {
          timezone: "Europe/Stockholm",
          allTimeStartDate: "2026-01-01",
        },
      };
      const play = (id, hours, date, extra = {}) => ({
        owner,
        id,
        primaryArtistId: "artist-a",
        albumId: "album-a",
        durationMs: hours * HOUR,
        played_at: new Date(date),
        ...extra,
      });
      await InfosModel.collection.insertMany([
        play("song-a", 1, "2025-03-29T23:30:00Z"),
        play("song-a", 2, "2025-03-30T01:30:00Z"),
        play("song-b", 3, "2025-03-30T02:30:00Z"),
        play("song-b", 1, "2025-03-30T02:45:00Z", {
          blacklistedBy: ["artist"],
        }),
        play("song-c", 4, "2025-03-31T10:00:00Z", { albumId: "album-b" }),
        play("missing-metadata", 1, "2025-03-31T10:30:00Z"),
        play("different", 2, "2025-03-30T04:00:00Z", {
          albumId: "other",
          primaryArtistId: "other",
          artistIds: ["other", "artist-a"],
        }),
        play("older-overall", 6, "2024-01-01T00:00:00Z", {
          albumId: "other",
          primaryArtistId: "other",
        }),
        play("song-a", 999, "2025-01-01T00:00:00Z", { owner: other }),
        play("song-a", 999, "2099-01-01T00:00:00Z"),
        ...[-1, 0, NaN, Infinity].map((hours) =>
          play("song-a", hours, "2010-01-01"),
        ),
        play("song-a", 0, "2010-01-01", { durationMs: "123" }),
      ]);
      await TrackModel.collection.insertMany([
        {
          id: "song-b",
          name: "Second",
          album: "album-a",
          disc_number: 1,
          track_number: 2,
          duration_ms: 99 * HOUR,
        },
        {
          id: "song-a",
          name: "First",
          album: "album-a",
          disc_number: 1,
          track_number: 1,
          duration_ms: 99 * HOUR,
        },
        {
          id: "unplayed",
          name: "Bonus",
          album: "album-a",
          disc_number: 2,
          track_number: 1,
          duration_ms: HOUR,
        },
      ]);
      for (const [kind, id, expected] of [
        ["song", "song-a", 3],
        ["album", "album-a", 8],
        ["artist", "artist-a", 12],
      ]) {
        const data = await getDetailListening(user, kind, id);
        assert.equal(
          new Date(data.start).toISOString(),
          "2025-03-29T23:00:00.000Z",
        );
        assert.equal(data.timezone, "Europe/Stockholm");
        assert.equal(data.count, 1024);
        assert.equal(
          data.days.reduce((sum, day) => sum + day.hours, 0),
          expected,
        );
        assert.equal(data.days[0].date, "2025-03-30");
        const grid = calendarGrid(data);
        assert.equal(
          grid.rows
            .flatMap((row) => row.cells)
            .reduce((sum, cell) => sum + (cell?.value ?? 0), 0),
          expected,
        );
        if (kind === "artist") {
          assert.equal(
            data.activity.reduce((sum, [, hours]) => sum + hours, 0),
            12,
          );
          assert.equal(data.timeOfDay.artist[0], 1);
          assert.equal(data.timeOfDay.artist[3], 2);
          assert.equal(data.timeOfDay.artist[4], 4);
          assert.equal(data.timeOfDay.artist[12], 5);
          assert.equal(
            data.timeOfDay.overall.reduce((sum, value) => sum + value, 0),
            19,
          );
          assert.deepEqual(data.tracks, []);
          assert.equal(data.eras.start, data.start);
          assert.equal(data.eras.end, data.end);
          assert.deepEqual(
            new Set(data.eras.songs.map((song) => song.id)),
            new Set(["song-a", "song-b", "song-c", "missing-metadata"]),
          );
          assert.equal(data.eras.albums.length, 2);
        } else {
          assert.equal(data.timeOfDay, null);
          assert.equal(data.eras, null);
        }
        if (kind === "album") {
          assert.deepEqual(
            data.tracks.map((track) => track.id),
            ["song-a", "song-b", "unplayed", "missing-metadata"],
          );
          assert.equal(data.tracks[2].bins.length, 0);
          assert.equal(
            data.tracks
              .flatMap((track) => track.bins)
              .reduce((sum, [, h]) => sum + h, 0),
            8,
          );
        }
      }
      const history = await getArtistTimeline(user, "artist-a");
      assert.equal(history.total.at(-1), 12);
      assert.equal(history.milestones[0].hours, 10);
      assert.equal(
        history.milestones[0].date.toISOString(),
        "2025-03-31T10:00:00.000Z",
      );
      assert.equal(
        await getDetailListening(user, "song", "never-played"),
        null,
      );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
