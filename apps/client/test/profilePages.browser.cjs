const fs = require("node:fs");
const nodePath = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const web = process.env.PROFILE_WEB_URL || "http://127.0.0.1:3002";
const api = process.env.PROFILE_API_URL || "http://127.0.0.1:8082";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    if (process.env.PROFILE_BUILD_DIR)
      await context.grantPermissions(["local-network-access"], { origin: web });
    const login = await context.newPage();
    await login.goto(`${api}/oauth/spotify`);
    await login.waitForURL(`${web}/**`);
    await login.close();
    const reports = [];
    for (const path of (process.env.PROFILE_PATHS || "/all,/").split(",")) {
      for (let run = 0; run < Number(process.env.PROFILE_RUNS || 2); run++) {
        const page = await context.newPage();
        if (process.env.PROFILE_BUILD_DIR) {
          const root = nodePath.resolve(process.env.PROFILE_BUILD_DIR);
          await page.route(`${web}/**`, async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            const candidate = nodePath.resolve(root, `.${pathname}`);
            const file =
              candidate.startsWith(root + "/") &&
              fs.existsSync(candidate) &&
              fs.statSync(candidate).isFile()
                ? candidate
                : route.request().isNavigationRequest()
                  ? nodePath.join(root, "index.html")
                  : null;
            if (!file) {
              await route.continue();
              return;
            }
            const type =
              {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".ico": "image/x-icon",
              }[nodePath.extname(file)] || "application/octet-stream";
            await route.fulfill({
              body: fs.readFileSync(file),
              contentType: type,
            });
          });
        }
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable");
        if (process.env.PROFILE_CPU)
          await cdp.send("Emulation.setCPUThrottlingRate", {
            rate: Number(process.env.PROFILE_CPU),
          });
        await page.addInitScript(() => {
          window.__longTasks = [];
          new PerformanceObserver((list) =>
            window.__longTasks.push(
              ...list
                .getEntries()
                .map((e) => ({ start: e.startTime, duration: e.duration })),
            ),
          ).observe({ type: "longtask", buffered: true });
        });
        const requests = [];
        const active = new Set();
        const errors = [];
        const failedRequests = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (r.url().startsWith(api)) active.add(r);
        });
        page.on("requestfinished", async (r) => {
          if (!active.has(r)) return;
          active.delete(r);
          const response = await r.response();
          requests.push({
            path: new URL(r.url()).pathname,
            status: response.status(),
            ...r.timing(),
          });
        });
        page.on("requestfailed", (r) => {
          if (active.has(r))
            failedRequests.push({
              path: new URL(r.url()).pathname,
              error: r.failure()?.errorText,
            });
          active.delete(r);
        });
        const start = Date.now();
        await page.goto(`${web}${path}?gname=All`, {
          waitUntil: "domcontentloaded",
        });
        let idle = 0;
        while (Date.now() - start < 40000) {
          await delay(250);
          idle = active.size ? 0 : idle + 1;
          if (idle >= 6) break;
        }
        const dom = await page.evaluate(() => ({
          longTasks: window.__longTasks,
          domNodes: document.querySelectorAll("*").length,
          heatmapCells: document.querySelectorAll("[data-cell]").length,
          tooltips: document.querySelectorAll(
            "[data-mui-internal-clone-element]",
          ).length,
          spinners: document.querySelectorAll('[role="progressbar"]').length,
          paints: performance
            .getEntriesByType("paint")
            .map((e) => ({ name: e.name, start: e.startTime })),
          resources: performance
            .getEntriesByType("resource")
            .filter((e) => ["script", "link"].includes(e.initiatorType))
            .map((e) => ({
              name: new URL(e.name).pathname,
              bytes: e.encodedBodySize,
              duration: e.duration,
            })),
        }));
        const metrics = (await cdp.send("Performance.getMetrics")).metrics;
        const report = {
          path,
          run,
          failedRequests,
          settledMs: Date.now() - start,
          requests: requests.sort((a, b) => b.responseEnd - a.responseEnd),
          pending: [...active].map((r) => new URL(r.url()).pathname),
          ...dom,
          metrics: Object.fromEntries(
            metrics
              .filter((m) =>
                [
                  "ScriptDuration",
                  "TaskDuration",
                  "LayoutDuration",
                  "RecalcStyleDuration",
                  "JSHeapUsedSize",
                ].includes(m.name),
              )
              .map((m) => [m.name, m.value]),
          ),
          errors,
        };
        reports.push(report);
        console.log(
          JSON.stringify({
            ...report,
            longTasks: {
              count: dom.longTasks.length,
              totalMs: Math.round(
                dom.longTasks.reduce((s, x) => s + x.duration, 0),
              ),
              maxMs: Math.round(
                Math.max(0, ...dom.longTasks.map((x) => x.duration)),
              ),
            },
            requests: report.requests.map((r) => ({
              path: r.path,
              status: r.status,
              ms: Math.round(r.responseEnd),
              wait: Math.round(r.responseStart - r.requestStart),
            })),
            resources: report.resources.filter((r) => r.bytes > 50000),
          }),
        );
        await page.close();
      }
    }
    fs.writeFileSync(
      process.env.PROFILE_OUTPUT || "/tmp/spotify-performance.json",
      JSON.stringify(reports, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
