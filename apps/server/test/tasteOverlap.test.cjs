const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb } = require("./helpers.cjs");
const {
  tasteOverlap,
  getTasteOverlap,
} = require("../src/database/queries/tasteOverlap");

const row = (person, artist, duration) => ({ person, artist, duration });
const close = (actual, expected) =>
  assert(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const region = (regions, ...members) =>
  regions.find((item) => item.members.join() === members.join());

test("two people share the smaller share of each artist", () => {
  const regions = tasteOverlap(2, [
    row(0, "both", 60),
    row(0, "mine", 40),
    row(1, "both", 10),
    row(1, "theirs", 30),
  ]);
  assert.deepEqual(
    regions.map((item) => item.members),
    [[0], [1], [0, 1]],
  );
  close(region(regions, 0, 1).share, 0.25);
  close(region(regions, 0).share, 0.75);
  close(region(regions, 1).share, 0.75);
  // The excess of a shared artist belongs to the person who plays it more.
  assert.deepEqual(
    region(regions, 0).artists.map((artist) => artist.id),
    ["mine", "both"],
  );
  close(region(regions, 0).artists[1].share, 0.35);
  assert.deepEqual(
    region(regions, 1).artists.map((artist) => artist.id),
    ["theirs"],
  );
});

test("every person's regions add up to all of their listening", () => {
  const rows = [
    row(0, "all", 50),
    row(1, "all", 30),
    row(2, "all", 10),
    row(0, "pair", 30),
    row(1, "pair", 20),
    row(0, "solo", 20),
    row(1, "other", 50),
    row(2, "third", 90),
  ];
  const regions = tasteOverlap(3, rows);
  assert.equal(regions.length, 7);
  for (const person of [0, 1, 2]) {
    close(
      regions
        .filter((item) => item.members.includes(person))
        .reduce((sum, item) => sum + item.share, 0),
      1,
    );
  }
  close(region(regions, 0, 1, 2).share, 0.1);
  // "all" is shared by 0 and 1 beyond what 2 plays; "pair" entirely.
  close(region(regions, 0, 1).share, 0.2 + 0.2);
  close(region(regions, 0, 2).share, 0);
  assert.deepEqual(region(regions, 1, 2).artists, []);
});

test("limits each region and hides the plot without listening", () => {
  const rows = Array.from({ length: 30 }, (_, index) =>
    row(0, `artist-${String(index).padStart(2, "0")}`, 30 - index),
  );
  const regions = tasteOverlap(2, [...rows, row(1, "else", 1)]);
  assert.equal(region(regions, 0).artists.length, 12);
  assert.equal(region(regions, 0).artists[0].id, "artist-00");
  close(region(regions, 0).share, 1);
  assert.equal(tasteOverlap(2, rows), null);
});

test(
  "MongoDB overlap respects the period, hidden artists and the opt-out",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      ArtistModel,
      UserModel,
    } = require("../src/database/Models");
    await connectTestDb("taste_overlap_test");
    try {
      const ids = Array.from(
        { length: 5 },
        () => new mongoose.Types.ObjectId(),
      );
      const [a, b, c, d, private_] = ids;
      await UserModel.collection.insertMany(
        ids.map((_id, i) => ({
          _id,
          username: `Person ${i}`,
          spotifyId: `person-${i}`,
          ...(_id === private_
            ? { settings: { allowCompetitions: false } }
            : {}),
        })),
      );
      await ArtistModel.collection.insertMany(
        ["both", "mine", "theirs"].map((id) => ({
          id,
          name: `Artist ${id}`,
          images: [{ url: `large-${id}` }, { url: `small-${id}` }],
        })),
      );
      const start = new Date("2025-01-01T00:00:00Z");
      const end = new Date("2025-02-01T00:00:00Z");
      const play = (owner, artist, hours, extra = {}) => ({
        owner,
        primaryArtistId: artist,
        durationMs: hours * 3600000,
        played_at: start,
        ...extra,
      });
      await InfosModel.collection.insertMany([
        play(a, "both", 6),
        play(a, "mine", 4),
        play(b, "both", 1),
        play(b, "theirs", 3),
        play(c, "theirs", 5),
        play(a, "hidden", 99, { blacklistedBy: ["artist"] }),
        play(a, "before", 99, { played_at: new Date(start.getTime() - 1) }),
        play(b, "after", 99, { played_at: end }),
        play(b, "invalid", -5),
        play(private_, "both", 1),
      ]);
      const user = { _id: a, settings: { timezone: "Europe/Stockholm" } };
      const pair = await getTasteOverlap(
        user,
        [String(a), String(b)],
        start,
        end,
      );
      assert.deepEqual(
        pair.people.map((person) => person.name),
        ["Person 0", "Person 1"],
      );
      close(region(pair.regions, 0, 1).share, 0.25);
      assert.deepEqual(region(pair.regions, 0, 1).artists, [
        { id: "both", share: 0.25, name: "Artist both", image: "small-both" },
      ]);
      assert.deepEqual(
        region(pair.regions, 0).artists.map((artist) => artist.id),
        ["mine", "both"],
      );
      const trio = await getTasteOverlap(
        user,
        [String(a), String(b), String(c)],
        start,
        end,
      );
      assert.equal(trio.regions.length, 7);
      close(region(trio.regions, 1, 2).share, 0.75);
      close(region(trio.regions, 0, 1, 2).share, 0);
      // One person, more than three, or someone without listening: no plot.
      for (const people of [[a], [a, b, c, d], [a, d]]) {
        assert.equal(
          await getTasteOverlap(user, people.map(String), start, end),
          null,
        );
      }
      await assert.rejects(
        getTasteOverlap(user, [String(a), String(private_)], start, end),
        /unavailable for competitions/,
      );
    } finally {
      await dropTestDb();
    }
  },
);
