// Run against the offline development preview with PLAYWRIGHT_MODULE,
// PLAYWRIGHT_CHROMIUM_PATH, PROFILE_WEB_URL and PROFILE_API_URL as needed.
// All listening fixtures are browser-only; the database is not changed.
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
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-02T12:00:00Z") });
    for (const [path, field, current, previous] of [
      ["songs_per", "count", 125, 100],
      ["time_per", "count", 75 * 60000, 100 * 60000],
      ["different_artists_per", "differents", 100, 100],
    ]) {
      await page.route(`${api}/spotify/${path}?*`, (route) => {
        const start = new URL(route.request().url()).searchParams.get("start");
        const isToday = Date.parse(start) >= Date.parse("2026-10-02T00:00:00Z");
        return route.fulfill({
          json: [
            {
              _id: null,
              differents: 10,
              [field]: isToday ? current : previous,
            },
          ],
        });
      });
    }
    await page.goto(api + "/oauth/spotify");
    await page.waitForURL(web + "/**");
    const periods = page.getByRole("radiogroup", { name: "Listening period" });
    const today = periods.getByRole("radio", { name: "Today", exact: true });
    const week = periods.getByRole("radio", { name: "This week", exact: true });
    const calendar = page.getByRole("button", {
      name: "Custom date range",
      exact: true,
    });
    await today.check();

    for (const [title, visible, spoken] of [
      ["Songs listened", "25% vs last day", "25% more than last day"],
      ["Time listened", "25% vs last day", "25% less than last day"],
      ["Artists listened", "0% vs last day", "No change from last day"],
    ]) {
      const card = page
        .getByRole("heading", { name: title, exact: true })
        .first()
        .locator("xpath=../../../..");
      await card.getByText(visible).waitFor();
      const readingText = await card.ariaSnapshot();
      assert(readingText.includes(spoken), `${title}: ${readingText}`);
      assert(
        !readingText.includes("vs last"),
        "Do not announce the visual text twice",
      );
      assert(
        !/[↑↓→]/.test(readingText),
        "Decorative arrows should stay hidden",
      );
    }
    console.log(
      "Positive, negative and zero deltas expose distinct reading text.",
    );

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, forcedColors: "active" });
      await page.waitForFunction(
        () => matchMedia("(forced-colors: active)").matches,
      );
      await today.check();
      await today.focus();
      await page.keyboard.press("ArrowRight");
      assert(
        await week.isChecked(),
        "Native arrow keys select the next period",
      );
      await calendar.focus();
      assert.equal(await periods.locator(":focus").count(), 0);
      const borders = await periods.getByRole("radio").evaluateAll((inputs) =>
        inputs.map((input) => {
          const style = getComputedStyle(input.nextElementSibling);
          return {
            checked: input.checked,
            width: parseFloat(style.borderTopWidth),
            style: style.borderTopStyle,
            color: style.borderTopColor,
            background: style.backgroundColor,
          };
        }),
      );
      const checked = borders.find((border) => border.checked);
      assert(checked.width >= 2 && checked.style === "solid");
      assert.notEqual(checked.color, checked.background);
      assert(
        borders
          .filter((border) => !border.checked)
          .every((border) => border.width === 0),
      );
      await periods.screenshot({
        path: `/tmp/period-forced-colors-${colorScheme}.png`,
      });

      await calendar.click();
      await page
        .getByRole("button", { name: "Last 7 days", exact: true })
        .click();
      await page.getByRole("button", { name: "Apply", exact: true }).click();
      await page
        .getByRole("button", { name: /Search/ })
        .first()
        .focus();
      assert.equal(await calendar.getAttribute("aria-pressed"), "true");
      assert.equal(await periods.locator(":checked").count(), 0);
      assert.equal(
        await calendar.evaluate((node) => node === document.activeElement),
        false,
      );
      const custom = await calendar.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          width: parseFloat(style.outlineWidth),
          style: style.outlineStyle,
        };
      });
      assert(custom.width >= 2 && custom.style === "solid");
      console.log(
        `${colorScheme} forced colors: preset and custom selection survive losing focus.`,
      );
    }
    await page.emulateMedia({ forcedColors: "none" });
    await today.check();
    assert.equal(
      await today.evaluate(
        (node) => getComputedStyle(node.nextElementSibling).borderTopWidth,
      ),
      "0px",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
