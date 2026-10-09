const assert = require("node:assert/strict");
const { test } = require("node:test");
require("./helpers.cjs");
const {
  movementReference,
  rankMovement,
} = require("../src/database/queries/rankMovement");

const DAY = 86_400_000;
const row = (_id, value, before, playedBefore = before > 0 ? 1 : 0) => ({
  _id,
  value,
  before,
  playedBefore,
});

test("looks back a quarter of the range, capped at one year", () => {
  const now = Date.UTC(2026, 9, 6);
  const reference = (days) =>
    movementReference(new Date(now - days * DAY), new Date(now), now);
  assert.equal(reference(13), null);
  assert.equal(reference(14).getTime(), now - 3.5 * DAY);
  assert.equal(reference(28).getTime(), now - 7 * DAY);
  assert.equal(reference(365).getTime(), now - 91.25 * DAY);
  assert.equal(reference(3000).getTime(), now - 365 * DAY);
});

test("measures from now when the selected range ends in the future", () => {
  const now = Date.UTC(2026, 9, 6);
  const start = new Date(now - 40 * DAY);
  assert.equal(
    movementReference(start, new Date(now + 20 * DAY), now).getTime(),
    now - 10 * DAY,
  );
  assert.equal(
    movementReference(new Date(now - 5 * DAY), new Date(now + 60 * DAY), now),
    null,
  );
});

test("reports places gained and lost against the earlier standings", () => {
  assert.deepEqual(
    rankMovement([
      row("steady", 100, 90),
      row("climber", 80, 10),
      row("faller", 60, 50),
      row("fresh", 70, 0),
    ]),
    [
      { id: "steady", change: 0 },
      { id: "climber", change: 1 },
      { id: "fresh", change: null },
      { id: "faller", change: -2 },
    ],
  );
});

test("breaks ties by binary ID order in both standings", () => {
  assert.deepEqual(
    rankMovement([row("b", 5, 2), row("B", 5, 2), row("a", 5, 2)]),
    [
      { id: "B", change: 0 },
      { id: "a", change: 0 },
      { id: "b", change: 0 },
    ],
  );
});

test("treats earlier zero-length plays as history, not as a new entry", () => {
  assert.deepEqual(rankMovement([row("silent", 10, 0, 3), row("old", 5, 4)]), [
    { id: "silent", change: 1 },
    { id: "old", change: -1 },
  ]);
});

test("limits the response without changing the ranks behind it", () => {
  const rows = Array.from({ length: 150 }, (_, index) =>
    row(`item-${String(index).padStart(3, "0")}`, 1000 - index, index + 1),
  );
  const movement = rankMovement(rows);
  assert.equal(movement.length, 100);
  assert.deepEqual(movement[0], { id: "item-000", change: 149 });
  assert.deepEqual(movement[99], { id: "item-099", change: -49 });
});
