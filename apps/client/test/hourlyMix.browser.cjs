const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const web = process.env.PROFILE_WEB_URL || "http://127.0.0.1:3002";
const api = process.env.PROFILE_API_URL || "http://127.0.0.1:8082";

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(api + "/oauth/spotify");
    await page.waitForURL(web + "/**");
    const chart = page.getByRole("img", { name: /^Hourly listening mix/ });
    await page.goto(web + "/all?gname=All");
    await chart.waitFor();
    await chart.scrollIntoViewIfNeeded();
    await chart
      .locator("..")
      .screenshot({ path: "/tmp/hourly-mix-preview.png" });

    let empty = false,
      fail = false;
    await page.route("**/spotify/top/hour-repartition/**", async (route) => {
      if (fail) {
        fail = false;
        await route.fulfill({ status: 500, json: { message: "Test failure" } });
        return;
      }
      const kind = new URL(route.request().url()).pathname.split("/").at(-1);
      const full_items = { a: { name: kind + " A" }, b: { name: kind + " B" } };
      await route.fulfill({
        json: empty
          ? []
          : [
              {
                hour: 0,
                total: 100,
                items: [
                  { itemId: "a", total: 30 },
                  { itemId: "b", total: 20 },
                ],
                full_items,
              },
              {
                hour: 1,
                total: 2,
                items: [{ itemId: "a", total: 2 }],
                full_items,
              },
              {
                hour: 23,
                total: 3,
                items: [{ itemId: "missing", total: 3 }],
                full_items,
              },
            ],
      });
    });
    let bounds = [
      "2020-01-17T00:00:00+01:00",
      "2026-09-22T00:00:00+02:00",
      "Europe/Stockholm",
    ];
    await page.route("**/spotify/artist-distribution?*", async (route) => {
      const start = Date.parse(bounds[0]),
        end = Date.parse(bounds[1]);
      await route.fulfill({
        json: {
          start,
          end,
          width: (end - start) / 256,
          count: 256,
          timezone: bounds[2],
          series: [
            {
              id: "a",
              name: "Artist A",
              bins: [
                [0, 1],
                [128, 4],
                [255, 2],
              ],
            },
          ],
        },
      });
    });
    await page.goto(web + "/all?gname=All");
    await chart.waitFor();
    await chart.scrollIntoViewIfNeeded();
    for (const hour of [0, 1, 23]) {
      const heights = await chart
        .locator('rect[data-hour="' + hour + '"][data-segment]')
        .evaluateAll((nodes) =>
          nodes.map((node) => Number(node.getAttribute("height"))),
        );
      assert(
        Math.abs(heights.reduce((sum, value) => sum + value, 0) - 176) <
          0.00001,
        "Every occupied hour must fill 100%",
      );
    }
    assert.equal(
      await chart.locator('rect[data-hour="2"][data-segment]').count(),
      0,
      "Empty hours stay empty",
    );
    const status = chart.locator("..").getByRole("status");
    await chart.locator('rect[data-hour="0"][data-segment="0"]').hover();
    await status.getByText("artists A", { exact: true }).waitFor();
    assert.match(await status.innerText(), /30% · 30 plays/);
    await chart.locator('rect[data-hour="0"][data-segment="2"]').hover();
    await status.getByText("Other", { exact: true }).waitFor();
    assert.match(await status.innerText(), /50% · 50 plays/);
    await chart.focus();
    await page.keyboard.press("ArrowRight");
    assert.match(await status.innerText(), /100% · 2 plays/);
    await page.keyboard.press("ArrowRight");
    await status.getByText("No plays", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await status.waitFor({ state: "hidden" });
    for (const kind of ["Albums", "Songs"]) {
      await page
        .getByRole("combobox", { name: "Hourly listening category" })
        .click();
      await page.getByRole("option", { name: kind, exact: true }).click();
      await page
        .getByRole("heading", { name: kind + " by hour", exact: true })
        .waitFor();
      await chart.locator('rect[data-hour="0"][data-segment="0"]').hover();
      await status
        .getByText((kind === "Songs" ? "songs" : "albums") + " A", {
          exact: true,
        })
        .waitFor();
    }
    console.log(
      "Hourly percentages, omitted share, empty hours, hover, keyboard and category switching passed.",
    );

    for (const [range, unit] of [
      [
        [
          "2020-01-17T00:00:00+01:00",
          "2026-09-22T00:00:00+02:00",
          "Europe/Stockholm",
        ],
        "year",
      ],
      [
        [
          "2025-01-17T00:00:00+01:00",
          "2026-01-17T00:00:00+01:00",
          "Europe/Stockholm",
        ],
        "month",
      ],
      [
        [
          "2026-03-04T08:31:00+01:00",
          "2026-04-04T10:00:00+02:00",
          "Europe/Stockholm",
        ],
        "day",
      ],
      [
        [
          "2026-03-27T08:31:00+01:00",
          "2026-04-03T08:31:00+02:00",
          "Europe/Stockholm",
        ],
        "weekday",
      ],
      [
        [
          "2026-09-22T01:31:00+05:45",
          "2026-09-22T20:31:00+05:45",
          "Asia/Kathmandu",
        ],
        "hour",
      ],
    ]) {
      bounds = range;
      await page.goto(web + "/all?gname=All");
      const ticks = page.locator("svg text[data-timestamp]");
      await ticks.first().waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(250);
        const labels = await ticks.evaluateAll((nodes) =>
          nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              time: Number(node.dataset.timestamp),
              text: node.textContent,
              left: rect.left,
              right: rect.right,
            };
          }),
        );
        assert(labels.length >= 1 && labels.length <= 12);
        const format = new Intl.DateTimeFormat("en-GB", {
          timeZone: range[2],
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        });
        for (const [index, tick] of labels.entries()) {
          const parts = Object.fromEntries(
            format
              .formatToParts(tick.time)
              .map((part) => [part.type, part.value]),
          );
          assert(
            tick.time >= Date.parse(range[0]) &&
              tick.time <= Date.parse(range[1]),
          );
          assert.equal(parts.minute, "00");
          if (unit !== "hour") assert.equal(parts.hour, "00");
          if (unit === "year" || unit === "month")
            assert.equal(parts.day, "01");
          if (unit === "year") {
            assert.equal(parts.month, "01");
            assert.match(tick.text, /^\d{4}$/);
          }
          assert(
            tick.left >= 0 && tick.right <= width + 1,
            "Labels stay in the viewport",
          );
          if (index > 0)
            assert(
              labels[index - 1].right + 2 <= tick.left,
              "Labels must not overlap",
            );
        }
      }
      console.log(
        "Calendar ticks: " +
          unit +
          ", desktop/mobile boundaries and spacing passed.",
      );
    }

    await page.route("**/me", async (route) => {
      const response = await route.fetch(),
        json = await response.json();
      if (json.user?.settings) json.user.settings.darkMode = "dark";
      await route.fulfill({ response, json });
    });
    await page.goto(web + "/all?gname=All");
    await chart.waitFor();
    await chart.scrollIntoViewIfNeeded();
    await chart.locator('rect[data-hour="0"][data-segment="2"]').tap();
    await status.getByText("Other", { exact: true }).waitFor();
    await chart
      .locator("..")
      .screenshot({ path: "/tmp/hourly-mix-mobile-dark.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    console.log("Mobile touch and dark layout passed.");

    empty = true;
    await page.goto(web + "/all?gname=All");
    const card = page
      .getByRole("heading", { name: "Artists by hour", exact: true })
      .locator("../../../..");
    await card
      .getByText("No listening history in this period.", { exact: true })
      .waitFor();
    assert.equal(await chart.count(), 0);
    empty = false;
    fail = true;
    await page.goto(web + "/all?gname=All");
    await card.getByRole("button", { name: "Retry", exact: true }).click();
    await chart.waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "Empty response, failed request/retry and browser error checks passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
