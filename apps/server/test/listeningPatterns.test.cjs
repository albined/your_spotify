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
  summarizeArtistDays,
} = require("../src/database/queries/listeningPatterns");
const { calendarGrid } = require("../../client/src/services/listeningPatterns");
const DAY = 86400000;
const makeData = (start, end, days = [], timezone = "UTC") => ({
  start: Date.parse(start),
  end: Date.parse(end),
  days,
  timezone,
  rhythms: [],
});
const sumGrid = (grid) =>
  grid.rows
    .flatMap((row) => row.cells)
    .reduce((sum, cell) => sum + (cell?.value ?? 0), 0);

test("peak intensity uses seven local calendar days, including silent days", () => {
  assert.deepEqual(summarizeArtistDays([]), {
    activeDays: 0,
    peakHoursPerDay: 0,
  });
  const result = summarizeArtistDays([
    { date: "2024-04-06", hours: 10 },
    { date: "2024-03-30", hours: 2 },
    { date: "2024-03-31", hours: 4 },
    { date: "2024-04-05", hours: 5 },
  ]);
  assert.equal(result.activeDays, 4);
  assert.equal(result.peakHoursPerDay, 19 / 7);
  assert.equal(
    summarizeArtistDays([
      { date: "2024-01-01", hours: 7 },
      { date: "2024-01-08", hours: 14 },
    ]).peakHoursPerDay,
    2,
  );
});

test("daily calendar respects local date boundaries and the exclusive end", () => {
  const grid = calendarGrid(
    makeData(
      "2024-03-30T23:00:00Z",
      "2024-03-31T22:00:00Z",
      [{ date: "2024-03-31", hours: 4 }],
      "Europe/Stockholm",
    ),
  );
  assert.equal(grid.rows.length, 7);
  assert.equal(grid.rows.flatMap((row) => row.cells).filter(Boolean).length, 1);
  assert.equal(grid.rows[6].cells[0].value, 4);
  assert.equal(sumGrid(grid), 4);
});

test("weekly calendar puts ISO week 53 in its proper year and preserves hours", () => {
  const grid = calendarGrid(
    makeData("2019-12-01", "2022-01-01", [
      { date: "2021-01-01", hours: 3 },
      { date: "2021-01-04", hours: 7 },
    ]),
  );
  assert.equal(grid.columns.length, 53);
  assert.equal(grid.rows.find((row) => row.id === "2020").cells[52].value, 3);
  assert.equal(grid.rows.find((row) => row.id === "2021").cells[0].value, 7);
  assert.equal(sumGrid(grid), 10);
});

test("long calendar ranges stay bounded, including leap days and empty years", () => {
  const grid = calendarGrid(
    makeData("1950-01-01", "2025-01-01", [
      { date: "2024-02-29", hours: 11 },
      { date: "1950-01-01", hours: 4 },
    ]),
  );
  assert.equal(grid.columns.length, 12);
  assert.ok(grid.rows.length <= 20);
  assert.equal(sumGrid(grid), 15);
  assert.ok(
    grid.rows.some((row) => row.cells.some((cell) => cell?.value === 0)),
  );
});

test(
  "queries isolate users and ranges, handle DST, and cap artist activity",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel } = require("../src/database/Models");
    const {
      getListeningHeatmaps,
      getArtistActivity,
    } = require("../src/database/queries/listeningPatterns");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `listening_patterns_test_${Date.now()}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const user = { _id: owner, settings: { timezone: "Europe/Stockholm" } };
      const start = new Date("2024-03-29T00:00:00Z");
      const end = new Date("2024-04-08T00:00:00Z");
      const event = (at, hours, extra = {}) => ({
        owner,
        primaryArtistId: "a",
        played_at: new Date(at),
        durationMs: hours * 3600000,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        event("2024-03-30T22:00:00Z", 2),
        event("2024-03-30T23:30:00Z", 3),
        event("2024-03-31T01:30:00Z", 1),
        event("2024-04-05T12:00:00Z", 5),
        event("2024-04-06T12:00:00Z", 10),
        event(start.getTime() - 1, 100),
        event(end, 100),
        event(start, 100, { owner: new mongoose.Types.ObjectId() }),
        event(start, 100, { blacklistedBy: ["artist"] }),
        event(start, -1),
        event(start, 1, { durationMs: null }),
      ]);
      const heatmaps = await getListeningHeatmaps(user, start, end);
      assert.deepEqual(heatmaps.days, [
        { date: "2024-03-30", hours: 2 },
        { date: "2024-03-31", hours: 4 },
        { date: "2024-04-05", hours: 5 },
        { date: "2024-04-06", hours: 10 },
      ]);
      assert.equal(
        heatmaps.rhythms.reduce((sum, cell) => sum + cell.hours, 0),
        21,
      );
      assert.equal(
        heatmaps.rhythms.find((cell) => cell.weekday === 7 && cell.hour === 0)
          .hours,
        3,
      );
      assert.equal(
        heatmaps.rhythms.find((cell) => cell.weekday === 7 && cell.hour === 3)
          .hours,
        1,
      );
      const activity = await getArtistActivity(user, start, end);
      assert.equal(activity.artists.length, 1);
      assert.equal(activity.artists[0].hours, 21);
      assert.equal(activity.artists[0].activeDays, 4);
      assert.equal(activity.artists[0].peakHoursPerDay, 19 / 7);
      assert.equal(
        (
          await getArtistActivity(
            user,
            start,
            new Date(start.getTime() + 6 * DAY),
          )
        ).artists.length,
        0,
      );
      await InfosModel.collection.insertMany(
        Array.from({ length: 105 }, (_, i) =>
          event(start, (i + 1) / 100, { primaryArtistId: `extra-${i}` }),
        ),
      );
      const capped = await getArtistActivity(user, start, end);
      assert.equal(capped.artists.length, 100);
      assert.equal(capped.artists[0].id, "a");
      assert.ok(!capped.artists.some((artist) => artist.id === "extra-0"));
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
