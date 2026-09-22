# Loading performance review — 22 September 2026

The starting checkpoint is `ec36ae0` on `feat/plots-v1`. The checkout was clean
before profiling. This pass changes client rendering; the statistics queries,
artist limits, heatmap resolution and stored data stay the same.

The main cost on `/all` is browser rendering. In the sampled all-time history,
its statistics requests completed in roughly 0.1–0.5 seconds, while the browser
spent about 2.32 seconds executing JavaScript. It mounted 1,246 heatmap squares,
each with its own tooltip, alongside older charts with many Recharts components.
The older hourly artist chart alone creates 89 artist series across 24 hours;
the older artist-share chart creates 40 series.

The implemented changes are:

- Share one tooltip per heatmap. Hover, keyboard navigation, touch, dark mode and
  the cell labels remain available. This also benefits song, album and artist
  detail heatmaps.
- Disable introductory animations on the two dense legacy stacked charts.
- Publish chart responses as React transitions so interruptible rendering can
  yield to input. Older request hooks also ignore responses after their request
  or selection has changed.

Measured browser scripting time, averaged over two runs of each page:

| Page | Before, development | After, development | After, optimized build |
| --- | ---: | ---: | ---: |
| `/all` | 2.32 s | 1.57 s | 0.67 s |
| Home | 0.64 s | 0.67 s | 0.27 s |
| Sample artist page | 0.92 s | 0.54 s | 0.31 s |

That is about 32% less scripting on `/all` and 42% less on the artist page in
the same development setup. Home did not show a meaningful improvement from
these changes. The heatmap cell counts remained 1,246 and 843 respectively.

There is still a substantial single pause on `/all`: approximately 0.73–0.75 s
in development after this pass, versus 0.65–0.73 s before. Total time in tasks
over 50 ms fell from about 1.89 s to 1.26 s, but the longest pause was not fixed.
The optimized build reduced that longest pause to about 0.23–0.25 s. The CPU
profile shows substantial React development instrumentation overhead, so the
3002 development preview exaggerates the cost compared with a production build.
The running preview remains in development mode for continued editing.

The next improvement identified here was the old hourly stacked chart; the
follow-up below implements that replacement. Mounting lower-page plots as they
approach the viewport is another candidate, but needs stable reserved space and
checks for fast scrolling and date changes. The application also ships all
routes in one JavaScript bundle; route splitting could help first visits to
other pages. Database caching is not the first priority based on these samples,
and would need invalidation for imports, blacklists, artist groups and settings.

Measurements used Chromium, a 1440 × 1000 viewport, no CPU throttling, the same
local snapshot, the All preset, and two runs per page. They are local samples,
not guarantees for every machine or history. The optimized client was served
only to the profiling browser from temporary build files. It used the same API;
neither running preview server was replaced. No baseline production build was
measured, so the optimized column is a mode comparison, not a before/after claim.
The profiler's `settledMs` includes an artificial quiet period and is not a page
load metric; the table uses Chrome's `ScriptDuration` instead.

Reproduce with `node apps/client/test/profilePages.browser.cjs`, with Playwright
available and the offline preview running. `PROFILE_PATHS` is a comma-separated
list of routes (default `/all,/`), `PROFILE_RUNS` defaults to 2, and
`PROFILE_OUTPUT` sets the JSON report path. `PROFILE_BUILD_DIR` optionally serves
an optimized build through browser routing. `PROFILE_WEB_URL` and
`PROFILE_API_URL` override the local addresses. `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_CHROMIUM_PATH` support an external Playwright installation.

Interaction regression checks are in `apps/client/test/heatmaps.browser.cjs`.
`HEATMAP_ARTIST_ID` optionally includes an artist detail page. The checks cover
hovered-cell anchoring, arrow keys, Escape, resizing, mobile touch and dark mode.

Validation passed: client typecheck, source lint, optimized build, heatmap
interactions, the existing four-list pagination regression, and a delayed-response
check confirming an old chart response cannot overwrite a new date selection.
All changed code passes formatting. The full source-format check still reports
141 pre-existing failures in unrelated files.

## Follow-up: hourly mix and distribution ticks

Baseline: `546442d`. The old hourly chart displayed the top 20 items per hour,
dividing by all plays in that hour but omitting everyone else. Its uneven tops
therefore represented omitted listening shares, rather than absolute volume.
The replacement draws the occupied sections directly in SVG instead of mounting
many independent Recharts series. Each occupied hour reaches 100%, including a
muted Other section. Empty hours stay empty. Item shares still use all plays as
the denominator, without truncation to tenths before drawing. Colors and stack
order remain consistent across hours; hover/tap and keyboard details show one
item at a time. The artists/albums/songs selector remains.

Artist distribution now uses the existing calendar-axis helper: local year and
month starts, calendar days and whole hours, with width-dependent label density.
Tick positions follow their actual timestamps. Labels show just the year when
appropriate. Tick computation is memoized independently of pointer movement;
the 30-artist limit, KDE and 256 rendering samples are unchanged.

Three development runs before and after this follow-up, with the same browser,
1440 × 1000 viewport, snapshot and All preset:

| Measurement on `/all` | Before | After |
| --- | ---: | ---: |
| Mean browser scripting time | 1.609 s | 1.054 s |
| Longest task in each run | 779 / 673 / 702 ms | 207 / 200 / 202 ms |
| Heatmap squares | 1,246 | 1,246 |
| DOM elements (approximately) | 4,808 | 3,746 |

This is about 35% less scripting and a 72% reduction in the mean of each run's
largest pause. These measure browser work, not total page-load time. An initial
after run overlapped lint; the final figures above were remeasured without build
or lint contention. All sampled requests succeeded, with no browser errors or
pending API requests. The larger viewport-mounting and route-splitting options
remain possible future work; this follow-up does not implement them.

Two additional optimized-build runs used temporary assets served only to the
profiling browser, with the existing API. Scripting took 0.474 / 0.487 seconds,
and the longest task was 108 / 110 ms. Both rendered all 1,246 heatmap squares
without request failures or browser errors. The running preview stays in
development mode.

Client typecheck, source lint, the optimized build and the hourly/calendar-axis
browser regression pass. Changed code passes formatting; the full source check
still reports 140 pre-existing failures in unrelated files. The literal package
lint command also traverses dependencies and build output in this container
layout, so source lint was checked separately. No backend or database changes
were needed.
