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

test(
  "hourly artists preserve totals, rank globally, and use local DST hours; adaptive diversity has exact warm-up windows",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const { InfosModel } = require("../src/database/Models");
    const { getArtistHours } = require("../src/database/queries/artistHours");
    const {
      getPersonalArtistDiversity,
    } = require("../src/database/queries/artistDiversity");
    const DAY = 86400000;
    const HOUR = 3600000;
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `refinements_test_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const user = { _id: owner, settings: { timezone: "Europe/Stockholm" } };
      const start = new Date("2025-03-30T00:00:00Z");
      const end = new Date("2025-03-31T00:00:00Z");
      const play = (primaryArtistId, played_at, durationMs, extra = {}) => ({
        owner,
        primaryArtistId,
        played_at: new Date(played_at),
        durationMs,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        play("a", start, HOUR),
        play("a", start.getTime() + HOUR, HOUR),
        play("b", start.getTime() + HOUR, HOUR),
        ...Array.from({ length: 22 }, (_, i) =>
          play(`tail-${i}`, start, 1000 + i),
        ),
        play("warm", start.getTime() - 20 * DAY, HOUR),
        play("expired", start.getTime() - 40 * DAY, HOUR),
        play("blocked", start, 999 * HOUR, { blacklistedBy: ["artist"] }),
        play("outsider", start, 999 * HOUR, {
          owner: new mongoose.Types.ObjectId(),
        }),
        play("at-end", end, 999 * HOUR),
        play("negative", start, -HOUR),
        play("invalid", start, NaN),
      ]);
      const hourly = await getArtistHours(user, start, end);
      assert.equal(hourly.series.length, 20);
      assert.deepEqual(
        hourly.series.slice(0, 2).map((s) => s.id),
        ["a", "b"],
      );
      assert.equal(hourly.series[0].hours[1], 1);
      assert.equal(hourly.series[0].hours[2], 0); // Skipped local hour at DST.
      assert.equal(hourly.series[0].hours[3], 1);
      assert.equal(
        hourly.series[0].hours.reduce((a, b) => a + b, 0),
        2,
      );
      assert.ok(
        !hourly.series.some((s) =>
          [
            "warm",
            "expired",
            "blocked",
            "outsider",
            "at-end",
            "invalid",
            "negative",
          ].includes(s.id),
        ),
      );
      assert.deepEqual(
        (
          await getArtistHours(
            user,
            new Date("2030-01-01"),
            new Date("2030-01-02"),
          )
        ).series,
        [],
      );

      for (const [span, expected] of [
        [30, 7],
        [365, 30],
        [730, 90],
        [1825, 180],
        [3650, 365],
      ]) {
        const data = await getPersonalArtistDiversity(
          user,
          new Date(start.getTime() - span * DAY),
          start,
        );
        assert.equal(data.windowDays, expected);
      }
      const automatic = await getPersonalArtistDiversity(user, start, end);
      assert.equal(automatic.windowDays, 7);
      assert.equal(automatic.values[0], null);
      const manual = await getPersonalArtistDiversity(
        user,
        start,
        end,
        "custom",
        30,
      );
      assert.equal(manual.windowDays, 30);
      assert.equal(manual.values[0], 1); // Warm history included, expired history excluded.
      const longer = await getPersonalArtistDiversity(
        user,
        start,
        end,
        "custom",
        90,
      );
      assert.equal(longer.values[0], 2);
      assert.ok(manual.values.at(-1) > 1);
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
