const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb } = require("./helpers.cjs");

test(
  "competition artists rank by the participant they matter least to, including missing listeners",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      ArtistModel,
      UserModel,
    } = require("../src/database/Models");
    const {
      getCompetitionTimeline,
    } = require("../src/database/queries/raceTimeline");
    const { getTasteOverlap } = require("../src/database/queries/tasteOverlap");
    await connectTestDb("competition_artists_test");
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
      const user = { _id: a, settings: { timezone: "Europe/Stockholm" } };
      const artists = async (people, from = start) =>
        (await getTasteOverlap(user, people, from, end)).items;
      // Shares of 1255 h and 52 h: "uneven" is 16% and 4%, "shared" 3% and 67%.
      const ranked = await artists(pair);
      assert.deepEqual(
        ranked.map((artist) => artist.id),
        ["uneven", "shared", "three-way", "solo"],
      );
      assert.equal(ranked[0].name, "uneven");
      assert.deepEqual(
        await artists([String(a).toUpperCase(), ...pair]),
        ranked,
      );
      // The third person plays "shared" for 2% of 66 h and "uneven" for 76%.
      assert.deepEqual(
        (await artists([...pair, String(c)])).map((artist) => artist.id),
        ["uneven", "shared", "three-way", "solo"],
      );
      assert.deepEqual(
        (await artists([String(a)])).map((artist) => artist.id),
        ["solo", "uneven", "shared", "three-way"],
      );
      assert.deepEqual(
        await artists(pair, new Date(start.getTime() + 2 * day)),
        [],
      );
      assert.deepEqual(await artists([]), []);
      const totals = async (artist) =>
        (
          await getCompetitionTimeline(
            user,
            pair,
            start,
            end,
            "hours",
            artist && { kind: "artists", id: artist },
          )
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
      // Whatever only one of them plays follows by its size, then by ID.
      const capped = await artists(pair);
      assert.equal(capped.length, 200);
      assert.deepEqual(
        capped.slice(0, 5).map((artist) => artist.id),
        ["uneven", "shared", "three-way", "solo", "extra-000"],
      );
    } finally {
      await dropTestDb();
    }
  },
);
