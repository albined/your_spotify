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
  "competition artists rank by the least-listening participant, including missing listeners",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      ArtistModel,
      UserModel,
    } = require("../src/database/Models");
    const {
      getCompetitionArtists,
      getCompetitionTimeline,
    } = require("../src/database/queries/raceTimeline");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `competition_artists_test_${Date.now()}`,
    });
    try {
      const ids = Array.from(
        { length: 4 },
        () => new mongoose.Types.ObjectId(),
      );
      const [a, b, c, outsider] = ids;
      await UserModel.collection.insertMany(
        ids.map((_id, i) => ({
          _id,
          username: `Person ${i}`,
          spotifyId: `person-${i}`,
        })),
      );
      await ArtistModel.collection.insertMany(
        ["shared", "uneven", "solo", "three-way"].map((id) => ({
          id,
          name: id,
          images: [],
        })),
      );
      const start = new Date("2025-01-01T00:00:00Z");
      const day = 86400000;
      const end = new Date(start.getTime() + 10 * day);
      const play = (owner, artist, hours, extra = {}) => ({
        owner,
        primaryArtistId: artist,
        durationMs: hours * 3600000,
        played_at: start,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        play(a, "shared", 20),
        play(a, "shared", 20, { played_at: new Date(start.getTime() + day) }),
        play(b, "shared", 35),
        play(c, "shared", 1),
        play(a, "uneven", 200),
        play(b, "uneven", 2),
        play(c, "uneven", 50),
        play(a, "solo", 1000),
        ...[a, b, c].map((owner) => play(owner, "three-way", 15)),
        play(outsider, "outsider", 9999),
        play(a, "blocked", 9999, { blacklistedBy: ["artist"] }),
        play(a, "before", 9999, { played_at: new Date(start.getTime() - 1) }),
        play(b, "end", 9999, { played_at: end }),
        play(a, "negative", -1),
        play(a, "invalid", 0, { durationMs: "9999" }),
        play(a, "missing-duration", 0, { durationMs: null }),
      ]);
      const pair = [String(a), String(b)];
      const ranked = await getCompetitionArtists(pair, start, end);
      assert.deepEqual(
        ranked.map((artist) => [artist.id, artist.minimumHours]),
        [
          ["shared", 35],
          ["three-way", 15],
          ["uneven", 2],
          ["solo", 0],
        ],
      );
      assert.equal(ranked[0].totalHours, 75);
      assert.deepEqual(
        await getCompetitionArtists(
          [String(a).toUpperCase(), ...pair],
          start,
          end,
        ),
        ranked,
      );
      const trio = await getCompetitionArtists(
        [...pair, String(c)],
        start,
        end,
      );
      assert.deepEqual(
        trio.map((artist) => [artist.id, artist.minimumHours]),
        [
          ["three-way", 15],
          ["uneven", 2],
          ["shared", 1],
          ["solo", 0],
        ],
      );
      const single = await getCompetitionArtists([String(a)], start, end);
      assert.equal(single[0].id, "solo");
      assert.equal(single[0].minimumHours, 1000);
      assert.deepEqual(
        await getCompetitionArtists(
          pair,
          new Date(start.getTime() + 2 * day),
          end,
        ),
        [],
      );
      assert.deepEqual(await getCompetitionArtists([], start, end), []);
      const user = { _id: a, settings: { timezone: "Europe/Stockholm" } };
      const totals = async (artist) =>
        (
          await getCompetitionTimeline(user, pair, start, end, "hours", artist)
        ).series.map((series) => series.values.at(-1));
      assert.deepEqual(await totals(), [1255, 52]);
      assert.deepEqual(await totals("shared"), [40, 35]);
      assert.deepEqual(await totals("uneven"), [200, 2]);
      assert.deepEqual(await totals(), [1255, 52]);
      await InfosModel.collection.insertMany(
        Array.from({ length: 205 }, (_, i) =>
          play(a, `extra-${String(i).padStart(3, "0")}`, 1),
        ),
      );
      const capped = await getCompetitionArtists(pair, start, end);
      assert.equal(capped.length, 200);
      assert.deepEqual(
        capped.slice(0, 4).map((artist) => artist.id),
        ["shared", "three-way", "uneven", "solo"],
      );
      assert.equal(capped[4].id, "extra-000");
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
