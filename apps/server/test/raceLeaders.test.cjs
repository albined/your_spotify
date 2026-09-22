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
const { RaceLeaders } = require("../src/database/queries/raceLeaders");

test("keeps five totals, recovers an old leader outside the top ten, and fills from totals", () => {
  const race = new RaceLeaders();
  race.add("early", 10, 1);
  race.add("winner", 110, 100);
  for (let i = 1; i <= 11; i++) race.add(`other-${i}`, 120, i + 1);
  const selected = race.select(200);
  assert.deepEqual(
    selected.map((row) => row._id),
    [
      "winner",
      "other-11",
      "other-10",
      "other-9",
      "other-8",
      "early",
      "other-7",
      "other-6",
      "other-5",
      "other-4",
    ],
  );
  assert.equal(selected.find((row) => row._id === "early").crownMs, 100);
  assert.equal(selected[0].crownMs, 90);
  assert.equal(new Set(selected.map((row) => row._id)).size, 10);
});

test("ranks crown holders by elapsed time, including returns to first place", () => {
  const race = new RaceLeaders();
  race.add("long", 0, 1);
  race.add("short", 30, 2);
  race.add("long", 35, 2);
  race.add("medium", 45, 4);
  for (let i = 1; i <= 7; i++) race.add(`top-${i}`, 65, i + 10);
  const rows = race.select(100);
  assert.deepEqual(
    rows.slice(0, 5).map((row) => row._id),
    ["top-7", "top-6", "top-5", "top-4", "top-3"],
  );
  assert.deepEqual(
    rows.slice(5).map((row) => row._id),
    ["long", "medium", "short", "top-2", "top-1"],
  );
  assert.deepEqual(
    rows.slice(5, 8).map((row) => row.crownMs),
    [40, 20, 5],
  );
});

test("ties share time in first; simultaneous plays do not create artificial reigns", () => {
  for (const order of [
    ["a", "b"],
    ["b", "a"],
  ]) {
    const race = new RaceLeaders();
    for (const id of order) race.add(id, 10, 5);
    race.add("c", 20, 6);
    race.add("a", 20, 2);
    const rows = new Map(race.select(30).map((row) => [row._id, row]));
    assert.equal(rows.get("a").crownMs, 20);
    assert.equal(rows.get("b").crownMs, 10);
    assert.equal(rows.get("c").crownMs, 0);
  }
});

test("empty and short races stay small; time before the first play is unclaimed", () => {
  assert.deepEqual(new RaceLeaders().select(100), []);
  const race = new RaceLeaders();
  race.add("a", 50, 10);
  assert.deepEqual(race.select(100), [{ _id: "a", duration: 10, crownMs: 50 }]);
});
