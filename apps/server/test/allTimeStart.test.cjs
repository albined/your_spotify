const assert = require("node:assert/strict");
const { test } = require("node:test");
global.window = { devicePixelRatio: 1, API_ENDPOINT: "http://127.0.0.1" };
const { connectTestDb, dropTestDb, serveRoutes } = require("./helpers.cjs");
const {
  startOfCalendarDate,
  allTimeStartAt,
} = require("../src/tools/allTimeStart");
const {
  getRawIntervalDetail,
  userBasedIntervals,
  presetIntervals,
} = require("../../client/src/services/intervals");

test("start date uses statistics timezone, including DST and fractional offsets", () => {
  for (const [date, zone, expected] of [
    ["2018-01-01", "Europe/Stockholm", "2017-12-31T23:00:00.000Z"],
    ["2018-07-01", "Europe/Stockholm", "2018-06-30T22:00:00.000Z"],
    ["2018-01-01", "America/New_York", "2018-01-01T05:00:00.000Z"],
    ["2018-01-01", "Asia/Kolkata", "2017-12-31T18:30:00.000Z"],
    ["2018-01-01", "Pacific/Kiritimati", "2017-12-31T10:00:00.000Z"],
    ["2018-11-04", "America/Sao_Paulo", "2018-11-04T03:00:00.000Z"],
  ])
    assert.equal(startOfCalendarDate(date, zone).toISOString(), expected);
  const dayHours = (start, end) =>
    (startOfCalendarDate(end, "Europe/Stockholm") -
      startOfCalendarDate(start, "Europe/Stockholm")) /
    3_600_000;
  assert.equal(dayHours("2018-03-25", "2018-03-26"), 23);
  assert.equal(dayHours("2018-10-28", "2018-10-29"), 25);
  assert.equal(allTimeStartAt({ settings: {} }), null);
});

test("All uses the saved instant without padding; reset and other presets keep their original ranges", () => {
  const original = { firstListenedAt: "2016-01-01T12:00:00Z" };
  const changed = { ...original, allTimeStartAt: "2017-12-31T23:00:00Z" };
  const all = userBasedIntervals[0];
  assert.equal(
    getRawIntervalDetail(all, changed).interval.start.toISOString(),
    changed.allTimeStartAt.replace("Z", ".000Z"),
  );
  const full = getRawIntervalDetail(all, original).interval;
  for (const startOverride of [
    null,
    undefined,
    "invalid",
    "2099-01-01T00:00:00Z",
  ]) {
    assert.deepEqual(
      getRawIntervalDetail(all, { ...original, allTimeStartAt: startOverride })
        .interval,
      full,
    );
  }
  assert.deepEqual(
    getRawIntervalDetail(all, changed),
    getRawIntervalDetail(all, changed),
  );
  for (const preset of presetIntervals) {
    assert.deepEqual(
      getRawIntervalDetail(preset, changed),
      getRawIntervalDetail(preset, original),
    );
  }
  const custom = { type: "custom", name: "custom", interval: full };
  assert.deepEqual(getRawIntervalDetail(custom, changed).interval, full);
});

test(
  "preference persists per account, validates requests, resets, and survives migration/imports",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { UserModel, InfosModel } = require("../src/database/Models");
    const {
      storeFirstListenedAtIfLess,
    } = require("../src/database/queries/user");
    const {
      up,
    } = require("../src/migrations/1790035200000-add_all_time_start_date");
    const { router } = require("../src/routes/index");
    await connectTestDb("all_start_test");
    let server;
    try {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      await UserModel.collection.insertMany(
        [owner, other].map((_id) => ({
          _id,
          username: String(_id),
          spotifyId: String(_id),
          firstListenedAt: new Date("2016-01-01T12:00:00Z"),
          settings: { timezone: "Europe/Stockholm", dateFormat: "default" },
        })),
      );
      await InfosModel.collection.insertOne({
        owner,
        played_at: new Date("2016-01-01"),
        id: "old-song",
      });
      server = await serveRoutes((app) => app.use(router));
      const { base } = server;
      const cookie = server.cookie(owner);
      const save = (payload, auth = true) =>
        fetch(`${base}/settings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(auth ? { Cookie: cookie } : {}),
          },
          body: JSON.stringify(payload),
        });
      const me = async () =>
        (
          await (
            await fetch(`${base}/me`, { headers: { Cookie: cookie } })
          ).json()
        ).user;
      assert.equal(
        (await save({ allTimeStartDate: "2018-01-01" }, false)).status,
        401,
      );
      assert.equal(
        (await save({ allTimeStartDate: "2018-01-01" })).status,
        200,
      );
      let saved = await me();
      assert.equal(saved.settings.allTimeStartDate, "2018-01-01");
      assert.equal(saved.allTimeStartAt, "2017-12-31T23:00:00.000Z");
      assert.equal(saved.statisticsTimezone, "Europe/Stockholm");
      for (const allTimeStartDate of [
        "2018-02-30",
        "2018-1-1",
        "2099-01-01",
        "",
        2018,
        "1800-01-01",
      ]) {
        assert.equal((await save({ allTimeStartDate })).status, 400);
        assert.equal((await me()).settings.allTimeStartDate, "2018-01-01");
      }
      await up();
      await up();
      assert.equal(
        (await UserModel.findById(owner)).settings.allTimeStartDate,
        "2018-01-01",
      );
      assert.equal(
        (await UserModel.collection.findOne({ _id: other })).settings
          .allTimeStartDate,
        null,
      );
      await storeFirstListenedAtIfLess(String(owner), new Date("2015-01-01"));
      assert.equal((await me()).settings.allTimeStartDate, "2018-01-01");
      assert.equal((await save({ timezone: "America/New_York" })).status, 200);
      assert.equal((await me()).allTimeStartAt, "2018-01-01T05:00:00.000Z");
      assert.equal((await save({ allTimeStartDate: null })).status, 200);
      saved = await me();
      assert.equal(saved.settings.allTimeStartDate, null);
      assert.equal(saved.allTimeStartAt, null);
      assert.equal(saved.firstListenedAt, "2015-01-01T00:00:00.000Z");
      assert.equal(await InfosModel.countDocuments({ owner }), 1);
    } finally {
      if (server) await server.close();
      await dropTestDb();
    }
  },
);
