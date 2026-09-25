const assert = require("node:assert/strict");
const { test } = require("node:test");
require("ts-node").register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: {
    module: "Node16",
    moduleResolution: "Node16",
    target: "ES2022",
  },
});
const {
  diversityWindowDays,
} = require("../src/database/queries/diversityWindow");
test("automatic windows respect inclusive calendar boundaries and leap years", () => {
  const start = new Date("2024-01-01T00:00:00Z");
  for (const [end, expected] of [
    ["2024-06-30T23:59:59.999Z", 7],
    ["2024-07-01T00:00:00Z", 14],
    ["2025-01-01T00:00:00Z", 14],
    ["2025-01-01T00:00:00.001Z", 30],
    ["2027-01-01T00:00:00Z", 30],
    ["2027-01-01T00:00:00.001Z", 90],
    ["2034-01-01T00:00:00Z", 90],
    ["2034-01-01T00:00:00.001Z", 180],
  ])
    assert.equal(diversityWindowDays(start, new Date(end)), expected, end);
  assert.equal(
    diversityWindowDays(new Date("2024-02-29"), new Date("2025-02-28")),
    14,
  );
  assert.equal(
    diversityWindowDays(new Date("2024-08-31"), new Date("2025-02-28")),
    14,
  );
});
