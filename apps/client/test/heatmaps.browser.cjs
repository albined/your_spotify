const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:8082/oauth/spotify");
    await page.waitForURL("http://127.0.0.1:3002/**");
    for (const path of [
      "/all",
      ...(process.env.HEATMAP_ARTIST_ID
        ? ["/artist/" + process.env.HEATMAP_ARTIST_ID]
        : []),
    ]) {
      await page.goto(`http://127.0.0.1:3002${path}?gname=All`);
      await page.locator("[data-cell]").first().waitFor();
      await page.waitForTimeout(1400);
      const grids = page
        .locator('[role="group"]')
        .filter({ has: page.locator("button[data-cell]") });
      for (let g = 0; g < (await grids.count()); g++) {
        const grid = grids.nth(g),
          name = await grid.getAttribute("aria-label");
        const cells = grid.locator("button[data-cell]");
        const first = cells.first();
        await first.scrollIntoViewIfNeeded();
        await first.hover();
        const expected = await first.getAttribute("aria-label");
        const tooltip = page.getByRole("tooltip", {
          name: expected,
          exact: true,
        });
        await tooltip.waitFor();
        const tipbox = await tooltip.boundingBox(),
          cellbox = await first.boundingBox();
        assert(
          Math.abs(tipbox.y - cellbox.y) < 150,
          `${name} tooltip should be anchored to its cell`,
        );
        await page.keyboard.press("Escape");
        await tooltip.waitFor({ state: "hidden" });
        await page.mouse.move(0, 0);
        await page.keyboard.press("Tab");
        await first.focus();
        await page
          .getByRole("tooltip", { name: expected, exact: true })
          .waitFor();
        await page.keyboard.press("ArrowRight");
        const active = grid.locator("button[data-cell]:focus");
        assert.equal(await active.count(), 1);
        assert.notEqual(
          await active.getAttribute("data-cell"),
          await first.getAttribute("data-cell"),
        );
        await page
          .getByRole("tooltip", {
            name: await active.getAttribute("aria-label"),
            exact: true,
          })
          .waitFor();
        await page.keyboard.press("Escape");
        await page.mouse.move(0, 0);
        console.log(
          `${name}: hover, cell anchoring, keyboard navigation and Escape passed`,
        );
      }
    }
    await page.goto("http://127.0.0.1:3002/all?gname=All");
    const decades = page.getByRole("group", {
      name: "Release decades over listening time",
      exact: true,
    });
    const lastCell = decades.locator("[data-cell]").last();
    await lastCell.waitFor();
    await lastCell.scrollIntoViewIfNeeded();
    await lastCell.hover();
    const oldTooltip = page.getByRole("tooltip", {
      name: await lastCell.getAttribute("aria-label"),
      exact: true,
    });
    await oldTooltip.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await oldTooltip.waitFor({ state: "hidden" });
    await page.route("**/me", async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      if (json.user?.settings) json.user.settings.darkMode = "dark";
      await route.fulfill({ response, json });
    });
    await page.goto("http://127.0.0.1:3002/all?gname=All");
    const rhythm = page.getByRole("group", {
      name: "Daily rhythms",
      exact: true,
    });
    const tapcell = rhythm.locator("[data-cell]").first();
    await tapcell.waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll("[role=progressbar]").length === 0,
    );
    await page.waitForTimeout(300);
    await tapcell.scrollIntoViewIfNeeded();
    await tapcell.tap();
    await page
      .getByRole("tooltip", {
        name: await tapcell.getAttribute("aria-label"),
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log("Mobile touch and dark mode passed; no browser errors.");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
