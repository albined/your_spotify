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
  buildArtistStream,
  distributionBandwidth,
  artistColor,
  MAX_ARTISTS,
} = require("../../client/src/services/artistDistribution");
const DAY = 86400000;
const makeData = (series, days = 365) => ({
  start: 0,
  end: days * DAY,
  width: (days * DAY) / 256,
  count: 256,
  timezone: "Europe/Stockholm",
  series,
});

test("KDE preserves each artist's hours, including both range boundaries", () => {
  for (const days of [1 / 24, 1, 365, 730, 2555]) {
    const data = makeData(
      [
        {
          id: "a",
          name: "A",
          bins: [
            [0, 3],
            [255, 7],
          ],
        },
        {
          id: "b",
          name: "B",
          bins: [
            [20, 4],
            [175, 6],
          ],
        },
      ],
      days,
    );
    const stream = buildArtistStream(data);
    for (const band of stream.bands) {
      const stepDays = days / (stream.samples - 1);
      const integral = band.values.reduce(
        (sum, value, i) =>
          sum +
          value * stepDays * (i === 0 || i === stream.samples - 1 ? 0.5 : 1),
        0,
      );
      assert.ok(Math.abs(integral - 10) < 1e-8);
      assert.ok(
        band.values.every((value) => Number.isFinite(value) && value >= 0),
      );
    }
    for (let i = 0; i < stream.samples; i++) {
      assert.ok(
        Math.abs(stream.bands[0].lower[i] + stream.bands.at(-1).upper[i]) <
          1e-8,
      );
      for (let b = 1; b < stream.bands.length; b++) {
        assert.equal(stream.bands[b].lower[i], stream.bands[b - 1].upper[i]);
      }
    }
  }
});

test("bandwidth scales with the range and colors stay attached to IDs", () => {
  assert.equal(distributionBandwidth(365 * DAY), 5 * DAY);
  assert.equal(distributionBandwidth(730 * DAY), 10 * DAY);
  assert.equal(artistColor("a"), artistColor("a"));
  const artists = Array.from({ length: 1500 }, (_, i) => ({
    id: String(i),
    name: String(i),
    bins: [[i % 256, 1]],
  }));
  const streams = buildArtistStream(makeData(artists));
  assert.equal(streams.bands.length, MAX_ARTISTS);
  assert.ok(streams.bands.every((band) => band.artist.id !== "other"));
});

test("silence stays empty, with no smoothing across a long empty period", () => {
  assert.equal(buildArtistStream(makeData([])).bands.length, 0);
  const { bands } = buildArtistStream(
    makeData([
      {
        id: "a",
        name: "A",
        bins: [
          [0, 2],
          [255, 2],
        ],
      },
    ]),
  );
  assert.equal(bands[0].values[128], 0);
});

test(
  "database bins keep the top artists and isolate account, blacklist and range",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    process.env.CLIENT_ENDPOINT = "http://127.0.0.1:3002";
    process.env.API_ENDPOINT = "http://127.0.0.1:8082";
    process.env.SPOTIFY_PUBLIC = "test";
    process.env.SPOTIFY_SECRET = "test";
    const {
      ARTIST_DISTRIBUTION_MAX_ARTISTS,
    } = require("../src/database/queries/artistDistribution");
    const mongoose = require("mongoose");
    const { InfosModel } = require("../src/database/Models");
    const {
      getArtistDistribution,
    } = require("../src/database/queries/artistDistribution");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `artist_distribution_test_${Date.now()}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      const event = (artist, at, extra = {}) => ({
        owner,
        primaryArtistId: artist,
        played_at: new Date(at),
        durationMs: 3600000,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        ...Array.from({ length: 35 }, (_, i) =>
          event(`artist${i}`, DAY, { durationMs: (i + 1) * 3600000 }),
        ),
        event("start", 0),
        event("excluded-end", 2 * DAY),
        event("before", -1),
        event("blocked", DAY, { blacklistedBy: [owner] }),
        event("other-account", DAY, { owner: other }),
        event(null, DAY),
        event("negative", DAY, { durationMs: -1 }),
      ]);
      const result = await getArtistDistribution(
        { _id: owner, settings: { timezone: "Europe/Stockholm" } },
        new Date(0),
        new Date(2 * DAY),
      );
      assert.equal(result.series.length, ARTIST_DISTRIBUTION_MAX_ARTISTS);
      assert.equal(
        result.series
          .flatMap((s) => s.bins)
          .reduce((sum, [, hours]) => sum + hours, 0),
        615,
      );
      assert.equal(result.timezone, "Europe/Stockholm");
      assert.ok(result.series.some((s) => s.id === "artist34"));
      assert.ok(!result.series.some((s) => s.id === "artist0"));
      assert.ok(
        result.series.every((s) =>
          s.bins.every(([index]) => index >= 0 && index < result.count),
        ),
      );
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
