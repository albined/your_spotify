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
const {
  overviewPlan,
} = require("../src/database/queries/listeningOverviewBuckets");
const DAY = 86400000;
const HOUR = 3600000;
const plan = (start, end, period = "custom", zone = "Europe/Stockholm") =>
  overviewPlan(new Date(start), new Date(end), period, zone);

test("calendar buckets preserve zero days, local DST boundaries and partial periods", () => {
  const spring = plan("2025-03-28T23:00Z", "2025-03-31T10:00Z", "Last 7 days");
  assert.deepEqual(
    spring.buckets.map((b) => (b.fullEnd - b.fullStart) / HOUR),
    [24, 23, 24],
  );
  assert.equal(spring.buckets.at(-1).fraction, 0.5);
  const fall = plan("2025-10-24T22:00Z", "2025-10-27T11:00Z", "Last 7 days");
  assert.deepEqual(
    fall.buckets.map((b) => (b.fullEnd - b.fullStart) / HOUR),
    [24, 25, 24],
  );
  const hours = plan("2025-10-25T22:00Z", "2025-10-26T23:00Z", "custom");
  assert.equal(hours.buckets.length, 25);
  assert.ok(hours.buckets.every((b) => b.end - b.start === HOUR));
  const today = plan(
    "2025-01-01T00:00Z",
    "2025-01-01T04:00Z",
    "Today",
    "Asia/Kolkata",
  );
  assert.equal(today.start, Date.parse("2024-12-31T18:30Z"));
  assert.equal(today.buckets.length, 10);
  assert.equal(today.buckets.at(-1).fraction, 0.5);
});

test("year comparisons stop at the same local time, including leap years", () => {
  const year = plan("2024-01-01", "2024-02-29T11:00Z", "This year");
  assert.equal(year.unit, "month");
  assert.equal(year.buckets.length, 2);
  assert.equal(year.buckets[0].referenceStart, Date.parse("2022-12-31T23:00Z"));
  assert.equal(year.buckets[1].referenceEnd, Date.parse("2023-02-28T11:00Z"));
  const summer = plan("2025-01-01", "2025-04-15T10:30Z", "This year");
  assert.equal(
    summer.buckets.at(-1).referenceEnd,
    Date.parse("2024-04-15T10:30Z"),
  );
  for (let i = 1; i < summer.buckets.length; i++)
    assert.equal(
      summer.buckets[i - 1].referenceEnd,
      summer.buckets[i].referenceStart,
    );
  const lateDstDay = overviewPlan(
    new Date("2026-01-01"),
    new Date("2026-03-30T21:30Z"),
    "This year",
    "Europe/Stockholm",
    Date.parse("2027-01-01"),
  );
  assert.equal(
    lateDstDay.buckets.at(-1).referenceEnd,
    Date.parse("2025-03-30T21:30Z"),
  );
  const missingHour = overviewPlan(
    new Date("2026-01-01"),
    new Date("2026-03-30T00:30Z"),
    "This year",
    "Europe/Stockholm",
    Date.parse("2027-01-01"),
  );
  assert.equal(
    missingHour.buckets.at(-1).referenceEnd,
    Date.parse("2025-03-30T01:30Z"),
  );
});

test("rolling-year comparisons use equal elapsed spans; long histories stay bounded", () => {
  const start = Date.parse("2024-05-10T13:00Z");
  const end = start + 365 * DAY;
  const result = plan(start, end, "Last 365 days");
  assert.equal(result.buckets.length, 53);
  assert.equal(result.buckets.at(-1).end - result.buckets.at(-1).start, DAY);
  assert.equal(result.buckets[0].referenceStart, start - 365 * DAY);
  assert.equal(result.buckets.at(-1).referenceEnd, start);
  for (const b of result.buckets)
    assert.equal(b.end - b.start, b.referenceEnd - b.referenceStart);
  const all = plan("1900-01-01", "2025-07-01", "All");
  assert.equal(all.unit, "year");
  assert.ok(all.buckets.length <= 127);
  assert.equal(all.comparison, null);
  const future = plan("2200-01-01", "2200-02-01");
  assert.equal(future.buckets.length, 0);
  assert.equal(
    overviewPlan(
      new Date("2025-01-01T12:30Z"),
      new Date("2025-01-02"),
      "custom",
      "UTC",
      Date.parse("2025-01-01T12:15Z"),
    ).buckets.length,
    0,
  );
});

test(
  "volume references, access control and personal diversity use real listening correctly",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const express = require("express");
    const cookieParser = require("cookie-parser");
    const { sign } = require("jsonwebtoken");
    const {
      InfosModel,
      UserModel,
      ArtistModel,
      ArtistGroupModel,
      PrivateDataModel,
    } = require("../src/database/Models");
    const {
      getListeningOverview,
    } = require("../src/database/queries/listeningOverview");
    const {
      getPersonalArtistDiversity,
    } = require("../src/database/queries/artistDiversity");
    const {
      invalidateArtistGroups,
    } = require("../src/database/queries/artistGroups");
    const {
      getCompetitionInsights,
    } = require("../src/database/queries/competitionInsights");
    const { router } = require("../src/routes/spotify");
    const { ErrorTypeToHTTPCode } = require("../src/tools/errors/error");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `listening_overview_${Date.now()}_${process.pid}`,
    });
    let server;
    try {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      await UserModel.collection.insertOne({
        _id: owner,
        username: "Overview",
        spotifyId: "overview",
        settings: {
          timezone: "UTC",
          dateFormat: "default",
          allowCompetitions: false,
        },
      });
      const user = await UserModel.findById(owner);
      const play = (date, artist, hours, extra = {}) => ({
        owner,
        id: artist,
        primaryArtistId: artist,
        played_at: new Date(date),
        durationMs: hours * HOUR,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        play("2023-01-01", "a", 1),
        // Only two active days in the baseline: the other 363 days still count.
        play("2024-01-02T08:00Z", "a", 182.5),
        play("2024-12-01T09:00Z", "b", 182.5),
        play("2025-01-01T08:00Z", "a", 2),
        play("2025-01-03T08:00Z", "b", 2),
        play("2025-01-03T10:00Z", "a", 0, { durationMs: "invalid" }),
        play("2025-01-03T11:00Z", "a", 0, { durationMs: Infinity }),
        play("2025-01-03T11:00Z", "a", 0, { durationMs: NaN }),
        play("2025-01-03T12:00Z", "outside", 100),
        play("2025-01-02T08:00Z", "blocked", 100, {
          blacklistedBy: ["artist"],
        }),
        play("2025-01-02T08:00Z", "someone-else", 100, { owner: other }),
      ]);
      const start = new Date("2025-01-01");
      const end = new Date("2025-01-03T12:00Z");
      const result = await getListeningOverview(user, start, end, "This month");
      assert.equal(result.comparison, "average");
      assert.deepEqual(
        result.buckets.map((b) => b.hours),
        [2, 0, 2],
      );
      assert.deepEqual(
        result.buckets.map((b) => b.songs),
        [1, 0, 4],
      );
      assert.deepEqual(
        result.buckets.map((b) => b.reference.hours),
        [1, 1, 0.5],
      );
      assert.equal(result.average.hours, 1);
      assert.equal(result.average.songs, 2 / 365);
      const empty = await getListeningOverview(
        user,
        new Date("2026-01-01"),
        new Date("2026-01-03"),
        "custom",
      );
      assert.ok(empty.buckets.every((b) => b.hours === 0 && b.songs === 0));
      assert.equal(
        (
          await getListeningOverview(
            user,
            new Date("2023-04-01"),
            new Date("2023-04-10"),
            "custom",
          )
        ).comparison,
        null,
      );
      const preference = user.toObject();
      preference.settings.allTimeStartDate = "2024-06-01";
      assert.equal(
        (await getListeningOverview(preference, start, end, "This month"))
          .comparison,
        null,
      );
      const year = await getListeningOverview(user, start, end, "This year");
      assert.equal(year.buckets[0].reference.hours, 182.5);
      assert.equal(
        year.buckets[0].referenceEnd,
        Date.parse("2024-01-03T12:00Z"),
      );
      const today = await getListeningOverview(
        user,
        start,
        new Date("2025-01-01T08:30Z"),
        "Today",
      );
      assert.equal(today.buckets.at(-1).reference.hours, 0.25);

      const personal = await getPersonalArtistDiversity(user, start, end);
      assert.equal(personal.values.at(-1), 2);
      assert.equal(personal.values[0], null);
      assert.ok(personal.values.length <= 201);
      await assert.rejects(() =>
        getCompetitionInsights(user, [String(owner)], start, end),
      );
      // Enabling competition gives identical samples; personal access doesn't need it.
      await UserModel.updateOne(
        { _id: owner },
        { $set: { "settings.allowCompetitions": true } },
      );
      const competition = await getCompetitionInsights(
        user,
        [String(owner)],
        start,
        end,
      );
      assert.deepEqual(
        personal.values.map((v) => v ?? 0),
        competition.series[0].values,
      );
      await ArtistModel.collection.insertMany([
        { id: "a", name: "A", images: [] },
        { id: "b", name: "B", images: [] },
      ]);
      await ArtistGroupModel.create({
        id: "group:overview",
        name: "Together",
        memberIds: ["a", "b"],
        imageArtistId: "a",
        enabled: true,
      });
      invalidateArtistGroups();
      assert.equal(
        (await getPersonalArtistDiversity(user, start, end)).values.at(-1),
        1,
      );
      assert.deepEqual(
        await getListeningOverview(user, start, end, "This month"),
        result,
      );

      await PrivateDataModel.create({ jwtPrivateKey: "overview-test-only" });
      const app = express();
      app.use(cookieParser());
      app.use("/spotify", router);
      app.use((error, req, res, _next) =>
        res.status(ErrorTypeToHTTPCode[error.type] ?? 500).end(),
      );
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}/spotify`;
      const headers = {
        Cookie: `token=${sign({ userId: String(owner) }, "overview-test-only")}`,
      };
      for (const endpoint of ["listening-overview", "artist-diversity"]) {
        const query = new URLSearchParams({
          start: start.toISOString(),
          end: end.toISOString(),
          period: "This month",
        });
        assert.equal((await fetch(`${base}/${endpoint}?${query}`)).status, 401);
        assert.equal(
          (await fetch(`${base}/${endpoint}?${query}`, { headers })).status,
          200,
        );
        query.set("period", "bogus");
        assert.equal(
          (await fetch(`${base}/${endpoint}?${query}`, { headers })).status,
          400,
        );
        query.set("period", "custom");
        query.set("end", "2024-01-01");
        assert.equal(
          (await fetch(`${base}/${endpoint}?${query}`, { headers })).status,
          400,
        );
      }
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
