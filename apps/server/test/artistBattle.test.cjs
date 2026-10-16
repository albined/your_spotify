const assert = require("node:assert/strict");
const { test } = require("node:test");
const { connectTestDb, dropTestDb, serveRoutes } = require("./helpers.cjs");
const {
  DAY_MS,
  draft,
  drafts,
  fight,
  random,
  seedOf,
  squad,
} = require("../src/tools/battle");

const BATTLE = 20000;
const row = (person, artist, day, hours, songs = [`${artist}-song`]) => ({
  person,
  artist,
  day: BATTLE - day,
  duration: hours * 3600000,
  songs,
});
const recruit = (id, share, extra = {}) => ({
  id,
  share,
  loyaltyDays: 10,
  recentDays: 5,
  songs: 3,
  contested: false,
  ...extra,
});

test("recent listeners recruit, and the more loyal one wins a shared artist", () => {
  const [first, second] = draft(
    [
      // Both played it this month; the second person on more days this year.
      row(0, "shared", 1, 30),
      row(1, "shared", 2, 1),
      row(1, "shared", 100, 1),
      row(1, "shared", 200, 1),
      // A long loyalty without recent plays recruits nothing.
      row(0, "old", 40, 50),
      row(0, "old", 300, 50),
      row(1, "old", 3, 2),
      row(0, "mine", 5, 10),
      // The battle day's own listening and anything before the year is left out.
      row(1, "today", 0, 99),
      row(1, "ancient", 366, 99),
      row(1, "theirs", 10, 7),
    ],
    BATTLE,
  );
  assert.deepEqual(
    first.map((item) => item.id),
    ["mine"],
  );
  assert.deepEqual(
    second.map((item) => item.id),
    ["theirs", "old", "shared"],
  );
  const shared = second.find((item) => item.id === "shared");
  assert.equal(shared.contested, true);
  assert.equal(shared.loyaltyDays, 3);
  assert.equal(shared.recentDays, 1);
  assert(Math.abs(shared.share - 0.1) < 1e-9);
  assert.equal(second.find((item) => item.id === "old").contested, false);
  assert.deepEqual(draft([row(0, "alone", 1, 5)], BATTLE), [[], []]);
  // Plays without listening time recruit nobody.
  assert.deepEqual(
    draft([row(0, "mine", 1, 5), row(1, "silent", 1, 0)], BATTLE),
    [[], []],
  );
  assert.deepEqual(
    draft(
      [row(0, "mine", 1, 5), row(1, "theirs", 1, 2), row(1, "silent", 2, 0)],
      BATTLE,
    )[1].map((item) => item.id),
    ["theirs"],
  );
});

test("each class goes to the artist that fits it, with fair team power", () => {
  const fighters = squad([
    recruit("top", 0.5, { loyaltyDays: 20 }),
    recruit("loyal", 0.1, { loyaltyDays: 300 }),
    recruit("broad", 0.08, { songs: 40 }),
    recruit("new", 0.05, { loyaltyDays: 4, recentDays: 4 }),
    recruit("spare", 0.04),
  ]);
  assert.deepEqual(
    fighters.map((fighter) => [fighter.id, fighter.class]),
    [
      ["top", "knight"],
      ["loyal", "cleric"],
      ["broad", "wizard"],
      ["new", "rogue"],
    ],
  );
  // Total hit points times total attack of four equally strong fighters.
  const full = (130 + 95 + 80 + 85) * (40 + 18 + 26 + 34);
  const power = (team) =>
    team.reduce((sum, fighter) => sum + fighter.hp, 0) *
    team.reduce((sum, fighter) => sum + fighter.attack, 0);
  const near = (actual, expected) =>
    assert(
      Math.abs(actual / expected - 1) < 0.02,
      `${actual} is not ${expected}`,
    );
  // How many fighters carry the team, from one of them to all.
  const carried = (team) => {
    const total = team.reduce((sum, fighter) => sum + fighter.scale, 0);
    return (
      (total * total) /
      team.reduce((sum, fighter) => sum + fighter.scale ** 2, 0) /
      team.length
    );
  };
  const spread = (team) => 0.64 + 0.36 * carried(team) ** 2;
  near(power(fighters), full * spread(fighters));
  assert(spread(fighters) < 1);
  const even = squad(["a", "b", "c", "d"].map((id) => recruit(id, 0.25)));
  near(power(even), full);
  assert(even.every((fighter) => fighter.scale === 1));
  assert(fighters[0].scale > fighters[1].scale);
  const solo = squad([recruit("solo", 1)]);
  assert.equal(solo.length, 1);
  near(power(solo), full * 0.6);
  const pair = squad([recruit("a", 0.3), recruit("b", 0.1)]);
  near(power(pair), full * 0.75 * spread(pair));
});

test("a team carried by one artist still wins about half of its fights", () => {
  const team = (shares) =>
    squad(
      shares.map((share, index) =>
        recruit(`${shares[0]}-${index}`, share, {
          loyaltyDays: 100 - index * 7,
          recentDays: 10 + (index % 3),
          songs: 20 - index * 2,
        }),
      ),
    );
  const boss = team([0.93, 0.02, 0.015, 0.01, 0.008, 0.007, 0.005, 0.005]);
  const usual = team([0.14, 0.09, 0.07, 0.06, 0.05, 0.045, 0.04, 0.035]);
  // The one who carries the team towers over the rest.
  assert(boss[0].scale > 2 && boss.slice(1).every((f) => f.scale < 0.35));
  let wins = 0;
  for (let index = 0; index < 600; index += 1) {
    const { winner } = fight(
      index % 2 ? [boss, usual] : [usual, boss],
      seedOf(`carried-${index}`),
    );
    if (winner === (index % 2 ? 0 : 1)) wins += 1;
  }
  assert(wins > 600 * 0.35 && wins < 600 * 0.65, `${wins} of 600`);
});

test("a smaller team still wins about half of its fights", () => {
  const roll = random(3);
  const team = (size) =>
    squad(
      Array.from({ length: size }, (_, index) =>
        recruit(`${size}-${index}`, (roll() + 0.05) / (size * 1.6), {
          loyaltyDays: 1 + Math.floor(roll() * 300),
          recentDays: 1 + Math.floor(roll() * 30),
          songs: 1 + Math.floor(roll() * 50),
        }),
      ).sort((a, b) => b.share - a.share),
    );
  for (const size of [1, 2, 3]) {
    let wins = 0;
    for (let index = 0; index < 600; index += 1) {
      const small = team(size);
      const { winner } = fight(
        index % 2 ? [small, team(4)] : [team(4), small],
        seedOf(`size-${index}`),
      );
      if (winner === (index % 2 ? 0 : 1)) wins += 1;
    }
    assert(wins > 600 * 0.35 && wins < 600 * 0.65, `${size}: ${wins} of 600`);
  }
});

test("the sliding draft matches a draft made from scratch for each day", () => {
  // The draft rules, applied to one day without any sliding window.
  const reference = (rows, day) => {
    const stats = new Map();
    const totals = [0, 0];
    for (const item of rows) {
      if (item.day < day - 365 || item.day >= day) continue;
      const key = `${item.person}:${item.artist}`;
      const entry = stats.get(key) ?? {
        recent: 0,
        recentDays: 0,
        loyaltyDays: 0,
        songs: new Set(),
      };
      stats.set(key, entry);
      entry.loyaltyDays += 1;
      if (item.day < day - 30) continue;
      entry.recent += item.duration;
      entry.recentDays += 1;
      totals[item.person] += item.duration;
      item.songs.forEach((song) => entry.songs.add(song));
    }
    const teams = [[], []];
    if (!totals[0] || !totals[1]) return teams;
    for (const artist of new Set(rows.map((item) => item.artist))) {
      const fans = [0, 1]
        .map((person) => ({ person, entry: stats.get(`${person}:${artist}`) }))
        .filter(({ entry }) => entry?.recent)
        .map((fan) => ({
          ...fan,
          share: fan.entry.recent / totals[fan.person],
        }))
        .sort(
          (a, b) =>
            b.entry.loyaltyDays - a.entry.loyaltyDays ||
            b.share - a.share ||
            a.person - b.person,
        );
      if (!fans.length) continue;
      const [owner] = fans;
      teams[owner.person].push({
        id: artist,
        share: owner.share,
        loyaltyDays: owner.entry.loyaltyDays,
        recentDays: owner.entry.recentDays,
        songs: owner.entry.songs.size,
        contested: fans.length > 1,
      });
    }
    teams.forEach((team) =>
      team.sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1)),
    );
    return teams;
  };
  const roll = random(9);
  const rows = [];
  for (let day = 0; day < 520; day += 1)
    for (const person of [0, 1])
      for (let artist = 0; artist < 12; artist += 1)
        if (roll() < (person ? 0.08 : 0.15) * (day > 300 && day < 330 ? 0 : 1))
          rows.push({
            person,
            artist: `artist-${artist}`,
            day,
            duration: roll() < 0.05 ? 0 : 1 + Math.floor(roll() * 4_000_000),
            songs: [`song-${artist}-${Math.floor(roll() * 6)}`],
          });
  const close = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((team, side) => {
      assert.deepEqual(
        team.map((item) => ({ ...item, share: 0 })),
        expected[side].map((item) => ({ ...item, share: 0 })),
      );
      team.forEach((item, index) =>
        assert(Math.abs(item.share - expected[side][index].share) < 1e-9),
      );
    });
  };
  let checked = 0;
  for (const [day, teams] of drafts(rows, 280, 520)) {
    close(teams, reference(rows, day));
    checked += teams[0].length + teams[1].length;
  }
  assert(checked > 1000);
});

test("a fight is the same for the same seed and keeps its own books", () => {
  const teams = [
    squad([
      recruit("a", 0.4),
      recruit("b", 0.2, { loyaltyDays: 200 }),
      recruit("c", 0.1, { songs: 30 }),
      recruit("d", 0.05, { loyaltyDays: 5 }),
    ]),
    squad([
      recruit("e", 0.9),
      recruit("f", 0.03, { loyaltyDays: 200 }),
      recruit("g", 0.02, { songs: 30 }),
      recruit("h", 0.01, { loyaltyDays: 5 }),
    ]),
  ];
  const seed = seedOf("2026-10-16:a:b");
  assert.deepEqual(fight(teams, seed), fight(teams, seed));
  assert.notDeepEqual(
    fight(teams, seed).events,
    fight(teams, seedOf("2026-10-17:a:b")).events,
  );
  for (let index = 0; index < 50; index += 1) {
    const { events, winner } = fight(teams, seedOf(`seed-${index}`));
    const hp = teams.map((team) => team.map((fighter) => fighter.hp));
    for (const event of events) {
      const [side, slot] = event.actor;
      assert(hp[side][slot] > 0, "a knocked out fighter acted");
      for (const hit of event.hits) {
        const [targetSide, targetSlot] = hit.target;
        const before = hp[targetSide][targetSlot];
        const after =
          event.action === "heal"
            ? before + hit.amount
            : Math.max(0, before - hit.amount);
        assert.equal(hit.hp, after);
        assert.equal(Boolean(hit.ko), after === 0 && before > 0);
        hp[targetSide][targetSlot] = after;
      }
    }
    const standing = hp.map((team) => team.filter((value) => value > 0));
    if (!standing[0].length) assert.equal(winner, 1);
    if (!standing[1].length) assert.equal(winner, 0);
  }
});

test(
  "a battle is the same for both people and leaves out the day's listening",
  { skip: !process.env.TIMELINE_TEST_MONGO_URI },
  async () => {
    const mongoose = require("mongoose");
    const {
      ArtistModel,
      GlobalPreferencesModel,
      InfosModel,
      UserModel,
    } = require("../src/database/Models");
    const { getArtistBattle } = require("../src/database/queries/artistBattle");
    const { router } = require("../src/routes/index");
    const { router: spotify } = require("../src/routes/spotify");
    await connectTestDb("artist_battle_test");
    let server;
    try {
      const [a, b, c] = ["b", "a", "c"].map(
        (letter) => new mongoose.Types.ObjectId(letter.repeat(24)),
      );
      await UserModel.collection.insertMany(
        [a, b, c].map((_id, index) => ({
          _id,
          username: `Person ${index}`,
          spotifyId: `person-${index}`,
          settings: { allowCompetitions: index !== 2 },
        })),
      );
      const artists = ["one", "two", "three", "four", "five", "six"];
      await ArtistModel.collection.insertMany(
        artists.map((id) => ({
          id,
          name: `Artist ${id}`,
          images: [
            { url: `${id}-640`, width: 640, height: 640 },
            { url: `${id}-160`, width: 160, height: 160 },
            { url: `${id}-64`, width: 64, height: 64 },
          ],
        })),
      );
      const now = new Date("2026-10-16T12:00:00Z");
      const day = (offset) =>
        new Date(Date.UTC(2026, 9, 16) - offset * DAY_MS + 3600000);
      const play = (owner, artist, offset, hours) => ({
        owner,
        id: `${artist}-song`,
        primaryArtistId: artist,
        durationMs: hours * 3600000,
        played_at: day(offset),
      });
      await InfosModel.collection.insertMany([
        ...artists
          .slice(0, 4)
          .map((artist, index) => play(a, artist, index + 1, 4 - index)),
        ...artists
          .slice(2)
          .map((artist, index) => play(b, artist, index + 2, index + 1)),
        play(b, "three", 200, 1),
        play(a, "one", 0, 99),
        play(c, "one", 1, 99),
      ]);
      const battle = await getArtistBattle(
        [String(a), String(b)],
        undefined,
        now,
      );
      assert.deepEqual(
        battle.people.map((person) => person.id),
        [String(b), String(a)],
      );
      assert.equal(battle.battle.day, "2026-10-16");
      // Until the night's last plays are in, the day before still shows.
      const early = await getArtistBattle(
        [String(a), String(b)],
        undefined,
        new Date("2026-10-16T00:05:00Z"),
      );
      assert.equal(early.battle.day, "2026-10-15");
      assert.deepEqual(
        await getArtistBattle([String(b), String(a)], undefined, now),
        battle,
      );
      // "three" was played by both, and on more days by b.
      const [first, second] = battle.battle.teams;
      assert(first.some((fighter) => fighter.id === "three"));
      assert(!second.some((fighter) => fighter.id === "three"));
      assert.equal(second[0].id, "one");
      assert.equal(second[0].class, "knight");
      assert.equal(second[0].name, "Artist one");
      assert.equal(second[0].image, "one-160");
      assert.deepEqual(battle.days.map((item) => item.day).slice(-2), [
        "2026-10-15",
        "2026-10-16",
      ]);
      // A play on the battle day changes nothing until the next one.
      await InfosModel.collection.insertOne(play(b, "six", 0, 500));
      assert.deepEqual(
        await getArtistBattle([String(a), String(b)], "2026-10-16", now),
        battle,
      );
      const future = await getArtistBattle(
        [String(a), String(b)],
        "2027-01-01",
        now,
      );
      assert.equal(future.battle.day, "2026-10-16");
      const earlier = await getArtistBattle(
        [String(a), String(b)],
        "2026-10-15",
        now,
      );
      assert.equal(earlier.battle.day, "2026-10-15");
      assert.deepEqual(earlier.days, battle.days);
      // A day without a battle shows the closest one of the month.
      const quiet = await getArtistBattle(
        [String(a), String(b)],
        "2026-10-01",
        now,
      );
      assert.equal(quiet.battle.day, battle.days[0].day);
      assert.notEqual(battle.days[0].day, "2026-10-01");
      const empty = await getArtistBattle(
        [String(a), String(b)],
        "2026-08-10",
        now,
      );
      assert.deepEqual(empty.days, []);
      assert.equal(empty.battle, null);
      await assert.rejects(
        getArtistBattle([String(a), String(c)], undefined, now),
        (error) => error.type === "FORBIDDEN",
      );

      await GlobalPreferencesModel.create({ allowAffinity: true });
      server = await serveRoutes((app) => {
        app.use(router);
        app.use("/spotify", spotify);
      });
      const headers = { Cookie: server.cookie(a) };
      const request = (ids, extra = {}) => {
        const query = new URLSearchParams(extra);
        ids.forEach((id) => query.append("userIds[]", String(id)));
        return fetch(`${server.base}/spotify/collaborative/battle?${query}`, {
          headers,
        });
      };
      assert.equal((await request([a, b])).status, 200);
      assert.equal((await request([a, c])).status, 403);
      for (const invalid of [
        [a],
        [a, a],
        [a, String(a).toUpperCase()],
        [a, b, c],
        ["nope", b],
      ])
        assert.equal((await request(invalid)).status, 400);
      for (const date of ["2026-13-45", "2026-02-30", "2026-04-31"])
        assert.equal((await request([a, b], { day: date })).status, 400);
      assert.equal((await request([a, b], { day: "2026-02-28" })).status, 200);
      assert.equal((await request([a, b], { day: "yesterday" })).status, 400);
      assert.equal(
        (
          await fetch(
            `${server.base}/spotify/collaborative/battle?userIds[]=${a}&userIds[]=${b}`,
          )
        ).status,
        401,
      );
    } finally {
      if (server) await server.close();
      await dropTestDb();
    }
  },
);
