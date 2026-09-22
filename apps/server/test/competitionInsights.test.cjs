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
  artistDiversity,
} = require("../src/database/queries/competitionInsights");

test("effective artists reflect balance, scale invariance, warm-up and expiring listening", () => {
  const equal = Array.from({ length: 10 }, (_, i) => ({
    artist: String(i),
    bucket: 0,
    durationMs: 3600000,
  }));
  assert.deepEqual(artistDiversity(2, equal), [10, 10, 10]);
  assert.deepEqual(
    artistDiversity(
      2,
      equal.map((row) => ({ ...row, durationMs: row.durationMs * 100 })),
    ),
    [10, 10, 10],
  );
  assert.deepEqual(
    artistDiversity(2, [
      { artist: "only", bucket: 1, durationMs: 80 * 3600000 },
    ]),
    [0, 1, 1],
  );
  const changing = artistDiversity(3, [
    ...equal,
    { artist: "0", bucket: 1, durationMs: 90 * 3600000 },
  ]);
  assert.ok(Math.abs(changing[1] - 10000 / 8290) < 1e-12);
  assert.equal(changing[1], changing[3]);
  assert.deepEqual(
    artistDiversity(2, [
      ...equal,
      ...equal.map((row) => ({
        ...row,
        bucket: 1,
        durationMs: -row.durationMs,
      })),
    ]),
    [10, 0, 0],
  );
  assert.deepEqual(artistDiversity(2, []), [0, 0, 0]);
  const split = equal.flatMap((row) => [
    { ...row, durationMs: row.durationMs * 0.25 },
    { ...row, durationMs: row.durationMs * 0.75 },
  ]);
  assert.deepEqual(artistDiversity(2, split.reverse()), [10, 10, 10]);
  const tiny = artistDiversity(1, [
    { artist: "big", bucket: 0, durationMs: 1e12 },
    { artist: "tiny", bucket: 0, durationMs: 1 },
    { artist: "big", bucket: 1, durationMs: -1e12 },
  ]);
  assert.equal(tiny[1], 1);
});

test(
  "competition insights respect timezones, ranges, durations, defaults and enforced opt-outs",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const express = require("express");
    const cookieParser = require("cookie-parser");
    const { sign } = require("jsonwebtoken");
    const {
      UserModel,
      InfosModel,
      PrivateDataModel,
      GlobalPreferencesModel,
    } = require("../src/database/Models");
    const {
      getCompetitionInsights,
    } = require("../src/database/queries/competitionInsights");
    const {
      getCompetitionArtists,
      getCompetitionTimeline,
    } = require("../src/database/queries/raceTimeline");
    const {
      listCompetitionParticipants,
    } = require("../src/database/queries/competitionParticipants");
    const {
      getCollaborativeTimePer,
    } = require("../src/database/queries/collaborative");
    const {
      up,
    } = require("../src/migrations/1790035200001-add_competition_preference");
    const { router } = require("../src/routes/index");
    const { router: spotify } = require("../src/routes/spotify");
    const { ErrorTypeToHTTPCode } = require("../src/tools/errors/error");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `competition_insights_${Date.now()}_${process.pid}`,
    });
    let server;
    try {
      const [a, b, c] = Array.from(
        { length: 3 },
        () => new mongoose.Types.ObjectId(),
      );
      await UserModel.collection.insertMany([
        {
          _id: a,
          username: "A",
          spotifyId: "a",
          settings: { timezone: "Europe/Stockholm", dateFormat: "default" },
        },
        {
          _id: b,
          username: "B",
          spotifyId: "b",
          settings: {
            timezone: "America/New_York",
            allowCompetitions: true,
            dateFormat: "default",
          },
        },
        {
          _id: c,
          username: "C",
          spotifyId: "c",
          settings: { allowCompetitions: false, dateFormat: "default" },
        },
      ]);
      const user = await UserModel.findById(a);
      const start = new Date("2025-03-29T23:00:00Z");
      const end = new Date("2025-03-31T00:00:00Z");
      const play = (owner, artist, hours, at, extra = {}) => ({
        owner,
        primaryArtistId: artist,
        id: artist,
        durationMs: hours * 3600000,
        played_at: new Date(at),
        ...extra,
      });
      await InfosModel.collection.insertMany([
        play(a, "one", 1, start),
        play(a, "two", 1, "2025-03-30T01:30:00Z"),
        play(b, "one", 9, start),
        play(b, "two", 1, "2025-03-30T01:30:00Z"),
        play(c, "private", 100, start),
        play(a, "excluded", 100, end),
        play(a, "old", 100, "2020-01-01"),
        play(a, "blocked", 100, start, { blacklistedBy: ["artist"] }),
        ...[NaN, Infinity, -1, 0].map((hours) =>
          play(a, "invalid", hours, start),
        ),
        play(a, "invalid", 1, start, { durationMs: "1234" }),
      ]);
      const ids = [String(a), String(b)];
      const result = await getCompetitionInsights(user, ids, start, end);
      assert.equal(result.series.length, 2);
      assert.equal(result.series[0].values.at(-1), 2);
      assert.ok(Math.abs(result.series[1].values.at(-1) - 100 / 82) < 1e-12);
      assert.equal(result.series[0].hours[0], 1);
      assert.equal(result.series[0].hours[3], 1);
      assert.equal(result.series[1].hours[19], 9);
      assert.equal(result.series[1].hours[21], 1);
      assert.equal(result.series[1].percentages[19], 90);
      assert.equal(
        result.series[0].percentages.reduce((sum, value) => sum + value, 0),
        100,
      );
      assert.deepEqual(
        await getCompetitionInsights(
          user,
          [String(a).toUpperCase(), ...ids],
          start,
          end,
        ),
        result,
      );
      assert.deepEqual(
        (await listCompetitionParticipants()).map((person) => person.id),
        ids,
      );
      await up();
      await up();
      assert.equal(
        (await UserModel.collection.findOne({ _id: a })).settings
          .allowCompetitions,
        true,
      );
      assert.equal(
        (await UserModel.collection.findOne({ _id: c })).settings
          .allowCompetitions,
        false,
      );
      assert.equal(
        new UserModel({
          username: "New",
          spotifyId: "new",
          settings: { dateFormat: "default" },
        }).settings.allowCompetitions,
        true,
      );
      const forbidden = [String(a), String(c)];
      for (const run of [
        () => getCompetitionInsights(user, forbidden, start, end),
        () => getCompetitionArtists(forbidden, start, end),
        () => getCompetitionTimeline(user, forbidden, start, end, "hours"),
        () => getCollaborativeTimePer(forbidden, start, end, "day"),
        () =>
          getCompetitionInsights(
            user,
            [String(new mongoose.Types.ObjectId())],
            start,
            end,
          ),
      ])
        await assert.rejects(run, (error) => error.type === "FORBIDDEN");
      await PrivateDataModel.create({ jwtPrivateKey: "competition-test-only" });
      await GlobalPreferencesModel.create({ allowAffinity: true });
      const token = sign({ userId: String(b) }, "competition-test-only");
      const app = express();
      app.use(express.json(), cookieParser());
      app.use(router);
      app.use("/spotify", spotify);
      app.use((error, req, res, _next) =>
        res.status(ErrorTypeToHTTPCode[error.type] ?? 500).end(),
      );
      server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      const headers = {
        Cookie: `token=${token}`,
        "Content-Type": "application/json",
      };
      const save = (value, auth = true) =>
        fetch(`${base}/settings`, {
          method: "POST",
          headers: auth ? headers : { "Content-Type": "application/json" },
          body: JSON.stringify({ allowCompetitions: value }),
        });
      assert.equal((await save(false, false)).status, 401);
      for (const invalid of ["false", null, 0, {}])
        assert.equal((await save(invalid)).status, 400);
      assert.equal((await save(false)).status, 200);
      assert.equal(
        (await UserModel.findById(b)).settings.allowCompetitions,
        false,
      );
      assert.equal(
        (await UserModel.findById(a)).settings.allowCompetitions,
        true,
      );
      const query = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
        timeSplit: "day",
      });
      ids.forEach((id) => query.append("userIds[]", id));
      for (const route of [
        "competition-insights",
        "competition-artists",
        "listening-timeline",
        "time_per",
      ]) {
        assert.equal(
          (
            await fetch(`${base}/spotify/collaborative/${route}?${query}`, {
              headers,
            })
          ).status,
          403,
        );
      }
      assert.equal(
        (await fetch(`${base}/spotify/collaborative/competition-participants`))
          .status,
        401,
      );
      assert.deepEqual(
        (
          await (
            await fetch(
              `${base}/spotify/collaborative/competition-participants`,
              { headers },
            )
          ).json()
        ).map((person) => person.id),
        [String(a)],
      );
      assert.equal((await save(true)).status, 200);
      assert.equal(
        (
          await fetch(
            `${base}/spotify/collaborative/competition-insights?${query}`,
            { headers },
          )
        ).status,
        200,
      );
      const invalid = new URLSearchParams(query);
      invalid.delete("userIds[]");
      invalid.append("userIds[]", "nope");
      assert.equal(
        (
          await fetch(
            `${base}/spotify/collaborative/competition-insights?${invalid}`,
            { headers },
          )
        ).status,
        400,
      );
      await GlobalPreferencesModel.updateMany(
        {},
        { $set: { allowAffinity: false } },
      );
      assert.equal(
        (
          await fetch(
            `${base}/spotify/collaborative/competition-insights?${query}`,
            { headers },
          )
        ).status,
        401,
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
