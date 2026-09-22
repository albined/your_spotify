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
  selectEraAlbums,
  selectEraSongs,
} = require("../src/database/queries/artistItemErasSelection");
const HOUR = 3600000;

function phases() {
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: `recent-${String(i).padStart(2, "0")}`,
    period: 60,
    duration: (20 - i / 2) * HOUR,
    plays: 30,
  }));
  for (let phase = 0; phase < 5; phase++) {
    for (let rank = 0; rank < 3; rank++) {
      rows.push({
        id: `phase-${phase}-${rank}`,
        period: phase * 12,
        duration: (2 - rank / 5) * HOUR,
        plays: 6,
      });
    }
  }
  rows.push({ id: "incidental", period: 62, duration: HOUR, plays: 1 });
  rows.push({ id: "quiet", period: 63, duration: 9 * 60000, plays: 3 });
  return rows;
}

test("song eras preserve five overall favorites and cover distinct smaller phases", () => {
  const rows = phases();
  const ids = selectEraSongs(rows);
  assert.deepEqual(ids.slice(0, 5), [
    "recent-00",
    "recent-01",
    "recent-02",
    "recent-03",
    "recent-04",
  ]);
  assert.deepEqual(ids.slice(5), [
    "phase-0-0",
    "phase-1-0",
    "phase-2-0",
    "phase-3-0",
    "phase-4-0",
  ]);
  assert.deepEqual(selectEraSongs(rows.toReversed()), ids);
  // Multiplying the already dominant burst does not crowd out the old phases.
  assert.deepEqual(
    selectEraSongs(
      rows.map((row) => ({
        ...row,
        duration: row.duration * (row.period === 60 ? 100 : 1),
      })),
    ),
    ids,
  );
});

test("song selection falls back to totals for short, quiet or already represented histories", () => {
  assert.deepEqual(selectEraSongs([]), []);
  assert.deepEqual(
    selectEraSongs([
      { id: "b", period: 0, duration: 1000, plays: 1 },
      { id: "a", period: 0, duration: 1000, plays: 1 },
    ]),
    ["a", "b"],
  );
  const oneBurst = phases().filter((row) => row.period === 60);
  assert.deepEqual(
    selectEraSongs(oneBurst),
    oneBurst.slice(0, 10).map((row) => row.id),
  );
});

test("a huge recent burst cannot disqualify an older half-hour phase", () => {
  const rows = phases().filter((row) => row.period === 60);
  rows.push({ id: "old-phase", period: 0, duration: HOUR / 2, plays: 5 });
  assert.equal(selectEraSongs(rows)[5], "old-phase");
});

test("album rows use the artist's full duration, include the two-percent boundary and cap at ten", () => {
  assert.deepEqual(
    selectEraAlbums(
      [
        { id: "large", duration: 50 },
        { id: "boundary", duration: 2 },
        { id: "small", duration: 1.99 },
      ],
      100,
    ),
    ["large", "boundary"],
  );
  const albums = Array.from({ length: 12 }, (_, i) => ({
    id: String(i).padStart(2, "0"),
    duration: 3,
  }));
  assert.deepEqual(
    selectEraAlbums(albums.toReversed(), 100),
    albums.slice(0, 10).map((row) => row.id),
  );
  assert.deepEqual(selectEraAlbums([], 0), []);
  assert.deepEqual(selectEraAlbums([{ id: "tiny", duration: 1 }], 100), []);
});

test(
  "artist eras isolate lifetime detail listening, select across all songs and preserve recorded durations",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      InfosModel,
      TrackModel,
      AlbumModel,
    } = require("../src/database/Models");
    const {
      getArtistItemEras,
    } = require("../src/database/queries/artistItemEras");
    await mongoose.connect(process.env.TIMELINE_TEST_MONGO_URI, {
      dbName: `artist_item_eras_${Date.now()}_${process.pid}`,
    });
    try {
      const owner = new mongoose.Types.ObjectId();
      const user = {
        _id: owner,
        settings: {
          timezone: "Europe/Stockholm",
          allTimeStartDate: "2026-01-01",
        },
      };
      const start = new Date("2018-01-01");
      const end = new Date("2025-01-01");
      const rows = phases();
      const albumOf = (row) =>
        row.period === 60 ? "recent-album" : `album-${row.period}`;
      const play = (row, i = 0) => ({
        owner,
        id: row.id,
        albumId: albumOf(row),
        primaryArtistId: "artist",
        played_at: new Date(Date.UTC(2018, row.period, 15, 12, i)),
        durationMs: row.duration / row.plays,
        ...(row.id === "phase-0-0" ? { blacklistedBy: ["artist"] } : {}),
      });
      await InfosModel.collection.insertMany([
        ...rows.flatMap((row) =>
          Array.from({ length: row.plays }, (_, i) => play(row, i)),
        ),
        ...[
          { owner: new mongoose.Types.ObjectId() },
          { primaryArtistId: "other", artistIds: ["other", "artist"] },
          { played_at: new Date(start.getTime() - 1) },
          { played_at: end },
        ].map((extra) => ({
          ...play(rows[0]),
          durationMs: 10000 * HOUR,
          ...extra,
        })),
        ...[0, -1, NaN, Infinity, "1234"].map((durationMs) => ({
          ...play(rows[0]),
          durationMs,
        })),
      ]);
      await TrackModel.collection.insertMany(
        rows
          .filter((row) => row.id !== "phase-2-0")
          .map((row) => ({
            id: row.id,
            name: `Song ${row.id}`,
            duration_ms: 99 * HOUR,
          })),
      );
      const albums = [...new Set(rows.map(albumOf))];
      await AlbumModel.collection.insertMany(
        albums.map((id) => ({ id, name: `Album ${id}` })),
      );
      const result = await getArtistItemEras(user, "artist", start, end);
      assert.equal(result.count, 256);
      assert.equal(result.start, start.getTime());
      assert.equal(result.end, end.getTime());
      assert.equal(result.timezone, "Europe/Stockholm");
      assert.deepEqual(
        result.songs.map((song) => song.id),
        selectEraSongs(rows),
      );
      const total = rows.reduce((sum, row) => sum + row.duration, 0);
      const albumTotals = albums.map((id) => ({
        id,
        duration: rows
          .filter((row) => albumOf(row) === id)
          .reduce((sum, row) => sum + row.duration, 0),
      }));
      assert.deepEqual(
        result.albums.map((album) => album.id),
        selectEraAlbums(albumTotals, total),
      );
      for (const song of result.songs) {
        const expected = rows.find((row) => row.id === song.id).duration / HOUR;
        assert(
          Math.abs(
            song.bins.reduce((sum, [, hours]) => sum + hours, 0) - expected,
          ) < 1e-8,
        );
        assert(song.bins.every(([bin]) => bin >= 0 && bin < result.count));
        assert.equal(
          song.name,
          song.id === "phase-2-0" ? "Unknown song" : `Song ${song.id}`,
        );
      }
      for (const album of result.albums) {
        assert(
          Math.abs(
            album.bins.reduce((sum, [, hours]) => sum + hours, 0) -
              albumTotals.find((row) => row.id === album.id).duration / HOUR,
          ) < 1e-8,
        );
      }
      const absent = await getArtistItemEras(user, "absent", start, end);
      assert.deepEqual(absent.albums, []);
      assert.deepEqual(absent.songs, []);

      // The Sunday-night UTC plays below are local Mondays, including DST.
      const weeklyOwner = new mongoose.Types.ObjectId();
      const weeklyRows = [
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `global-${i}`,
          period: 0,
          duration: (20 - i / 2) * HOUR,
          plays: 3,
        })),
        { id: "monday-phase", period: 1, duration: 6 * HOUR, plays: 3 },
        { id: "dst-phase", period: 2, duration: 6 * HOUR, plays: 3 },
      ];
      const dates = [
        "2025-03-23T22:30Z",
        "2025-03-23T23:30Z",
        "2025-03-30T22:30Z",
      ];
      await InfosModel.collection.insertMany(
        weeklyRows.flatMap((row) =>
          Array.from({ length: row.plays }, (_, i) => ({
            owner: weeklyOwner,
            primaryArtistId: "weekly",
            albumId: "weekly-album",
            id: row.id,
            durationMs: row.duration / row.plays,
            played_at: new Date(Date.parse(dates[row.period]) + i * 60000),
          })),
        ),
      );
      const weekly = await getArtistItemEras(
        { ...user, _id: weeklyOwner },
        "weekly",
        new Date("2025-03-17T00:00Z"),
        new Date("2025-04-07T00:00Z"),
      );
      assert.deepEqual(
        weekly.songs.map((song) => song.id),
        selectEraSongs(weeklyRows),
      );
      assert(weekly.songs.some((song) => song.id === "monday-phase"));
      assert(weekly.songs.some((song) => song.id === "dst-phase"));
    } finally {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
