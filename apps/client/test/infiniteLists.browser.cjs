const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const web = process.env.INFINITE_LIST_WEB_URL || "http://127.0.0.1:3002";
const api = process.env.INFINITE_LIST_API_URL || "http://127.0.0.1:8082";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await pause(100);
  }
  assert.fail(description);
}

function fixture(kind, index) {
  const artist = {
    id: `fixture-artist-${index}`,
    name: `Fixture artist ${index}`,
    genres: [],
    images: [],
  };
  const album = {
    id: `fixture-album-${index}`,
    name: `Fixture album ${index}`,
    artists: [artist.id],
    images: [],
  };
  const track = {
    id: `fixture-song-${index}`,
    name: `Fixture song ${index}`,
    album: album.id,
    artists: [artist.id],
    duration_ms: 180000,
  };
  if (kind === "history") {
    return {
      _id: `fixture-play-${index}`,
      id: track.id,
      played_at: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
      durationMs: track.duration_ms,
      track: { ...track, full_album: album, full_artists: [artist] },
    };
  }
  return {
    artist,
    album,
    track,
    count: 100 - index,
    total_count: 5000,
    duration_ms: 18000000,
    total_duration_ms: 900000000,
    differents: 1,
  };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 4500 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // The offline preview signs in locally. List data below is synthetic.
    await page.goto(`${api}/oauth/spotify`);
    await page.waitForURL(`${web}/**`);

    for (const kind of ["songs", "history", "artists", "albums"]) {
      const path = kind === "history" ? "/" : `/top/${kind}`;
      const endpoint =
        kind === "history" ? "/spotify/gethistory" : `/spotify/top/${kind}`;
      const rows = Array.from({ length: 80 }, (_, index) =>
        fixture(kind, index),
      );
      const requests = [];
      let total = 45;
      let mode = "normal";
      let release;
      let inFlight = 0;
      let maximumInFlight = 0;
      const routePattern = `${api}${endpoint}?**`;
      await page.route(routePattern, async (route) => {
        const query = new URL(route.request().url()).searchParams;
        if (
          route.request().method() !== "GET" ||
          Number(query.get("nb") || query.get("number")) !== 20
        ) {
          await route.continue();
          return;
        }
        const offset = Number(query.get("offset"));
        const requestedMode = mode;
        requests.push(offset);
        inFlight++;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        try {
          if (offset === 20 && requestedMode === "hold") {
            await new Promise((resolve) => {
              release = resolve;
            });
          }
          if (
            (offset === 20 && requestedMode === "fail-next") ||
            requestedMode === "fail-first"
          ) {
            await route.fulfill({ status: 500, json: {} });
          } else {
            const data =
              requestedMode === "new-range"
                ? rows.slice(70, 73)
                : rows.slice(offset, Math.min(total, offset + 20));
            await route.fulfill({ json: data });
          }
        } finally {
          inFlight--;
        }
      });
      const list = page.locator("div[aria-busy]");
      const noun =
        kind === "artists" ? "artist" : kind === "albums" ? "album" : "song";
      const links = list.getByRole("link", {
        name: new RegExp(`^Fixture ${noun} \\d+$`),
      });
      const settled = async (count) => {
        await until(
          async () =>
            (await links.count()) === count &&
            (await list.getAttribute("aria-busy")) === "false",
          `${kind}: expected ${count} settled rows`,
        );
      };
      const open = async (height) => {
        await page.setViewportSize({ width: 1600, height });
        requests.length = 0;
        await page.goto(`${web}${path}?gname=All`);
        await list.waitFor();
      };
      const bottom = () =>
        page.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight),
        );

      // No scroll event: the first 20 and the next 20 both fit on screen.
      await open(4500);
      await settled(45);
      await pause(200);
      assert.deepEqual(requests, [0, 20, 40]);
      assert.equal(await list.getByRole("progressbar").count(), 0);
      assert.equal(new Set(await links.allTextContents()).size, 45);

      // Off-screen footers wait; resizing into view resumes automatically.
      await open(900);
      await settled(20);
      await pause(200);
      assert.deepEqual(requests, [0]);
      assert.equal(await list.getByRole("progressbar").count(), 0);
      await page.setViewportSize({ width: 1600, height: 4500 });
      await settled(45);
      assert.deepEqual(requests, [0, 20, 40]);

      // Normal scrolling and repeated intersections while a page is pending.
      await open(900);
      await settled(20);
      mode = "hold";
      await bottom();
      await until(() => Boolean(release), "second page should be pending");
      assert.equal(await links.count(), 20);
      assert.equal(await list.getAttribute("aria-busy"), "true");
      assert.equal(await list.getByRole("progressbar").count(), 1);
      await page.setViewportSize({ width: 1600, height: 4500 });
      await bottom();
      await pause(150);
      assert.deepEqual(requests, [0, 20]);
      mode = "normal";
      release();
      release = undefined;
      await settled(45);
      assert.deepEqual(requests, [0, 20, 40]);
      assert.equal(maximumInFlight, 1);

      // Errors stop automatic requests. Retrying keeps the offset and rows.
      mode = "fail-next";
      await open(4500);
      await list.getByRole("alert").waitFor();
      await settled(20);
      await pause(200);
      assert.deepEqual(requests, [0, 20]);
      assert.equal(await list.getByRole("progressbar").count(), 0);
      mode = "normal";
      await list.getByRole("button", { name: "Retry" }).click();
      await settled(45);
      assert.deepEqual(requests, [0, 20, 20, 40]);
      assert.equal(new Set(await links.allTextContents()).size, 45);

      if (kind === "songs") {
        mode = "fail-first";
        await open(4500);
        await list.getByRole("alert").waitFor();
        assert.equal(await links.count(), 0);
        mode = "normal";
        await list.getByRole("button", { name: "Retry" }).click();
        await settled(45);
        assert.deepEqual(requests, [0, 0, 20, 40]);
        for (const size of [0, 20]) {
          total = size;
          await open(4500);
          await settled(size);
          await pause(200);
          assert.deepEqual(requests, size ? [0, 20] : [0]);
          assert.equal(await list.getByRole("progressbar").count(), 0);
        }
        total = 45;
        await open(900);
        await settled(20);
        mode = "hold";
        await bottom();
        await until(() => Boolean(release), "old range should be pending");
        mode = "new-range";
        await page.getByRole("radio", { name: "Today", exact: true }).check();
        await settled(3);
        release();
        release = undefined;
        await pause(200);
        await settled(3);
        assert.deepEqual(await links.allTextContents(), [
          "Fixture song 70",
          "Fixture song 71",
          "Fixture song 72",
        ]);
        mode = "normal";

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${web}${path}?gname=All`);
        await settled(20);
        await bottom();
        await settled(40);
        await bottom();
        await settled(45);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      }
      console.log(
        `${kind}: tall viewport, resize, scrolling, pending request, retry and end-of-list passed.`,
      );
      await page.unroute(routePattern);
    }
    assert.deepEqual(errors, []);
    console.log("All infinite-list browser regressions passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
