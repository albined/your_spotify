# Plot V1 working notes

This checkout contains the focused plot pass on `feat/plots-v1`:

1. Artist distribution replaces the cumulative artist timeline on `/all`. It is
   a centered, duration-weighted Gaussian KDE with automatic bandwidth of the
   selected range divided by 73. The API returns the top 30 artists by listening
   time, with no Other group. Dynamic input bins are capped at 256 and the
   Canvas draws 256 samples. Names, artwork, and density appear on hover, tap,
   or arrow-key navigation. There are no knobs, totals, info, or table buttons.
2. Release dates contains a yearly hours histogram and a decade-only time matrix.
   The matrix keeps rows at or above one percent of the selected plays, merges
   source bins into a bounded grid, and uses dark-mode-aware colors with rounded
   cells. It has no controls, legend, info, or data table.
   Matrix color intensity blends 80% row-relative and 20% overall square-root
   scaling, so individual decade phases remain visible.
3. Artist eras has a separate request that considers the full artist library.
   The 10/20 selector reserves half the rows for the overall hours ranking, then
   selects recurring local top-three artists and fills any gaps from totals.
   Local periods are calendar months for ranges of at least 180 days, Monday
   weeks otherwise, in the user's statistics timezone. A qualifying period has
   at least 30 minutes and 10% of the median active-period listening time. Era
   candidates need two top-three appearances; ties use hours during those
   appearances, overall hours, then ID. Both selections share one bounded
   response, so toggling artist count does not refetch data. Display bins merge
   into up to 64 columns based on available width, independently of artist count.
   The 21px squares retain 3px gaps. Rows sort by peak date; color intensity
   blends 80% row-relative and 20% overall square-root scaling. Calendar and
   daily-rhythm colors keep their existing global scale.
4. Listening calendar and daily rhythms share one request. The calendar uses
   local calendar dates, switches from daily cells to ISO weeks and then months
   for longer ranges, and groups years for very long histories. Rhythms shows
   total hours by local weekday and hour. Both have rounded, theme-aware cells,
   hover/touch details, keyboard navigation, and no settings or extra buttons.
5. Artist activity shows the top 100 artists by selected-period hours. X is
   active local calendar days, Y is the highest seven-calendar-day total divided
   by seven, with square-root positioning and actual h/day tick labels. Bubble
   area represents total hours with a small minimum visible radius. The chart is
   hidden below seven elapsed days. Only selected-period plays enter the peak.

The average album release date and average feats charts are removed from `/all`.
No barcode is included. Discovery & listening habits is also removed from `/all`.

The home page's Best artist and Best song cards each request the top three using
the existing ranking endpoint and selected page range. The winner remains above
two compact runner-ups, with linked images/names and shortened song/play and
minute counts. Both cards retain their 300px height and share the same layout.

Competition now has a fixed overall listening-time race and a separate artist
race below it. Its searchable dropdown contains up to 200 artists, ranked by
the minimum recorded hours across all selected participants in the selected
period. Missing listeners count as zero; ties use combined hours, then artist
ID. Changing people or dates selects the new highest-ranked artist. Changing
the artist only refreshes the artist race. Both API routes require login and
the existing affinity permission.

Top songs, artists and albums races keep the five highest listening-time totals
in the selected range, then fill up to ten lines with entries that spent longest
in first place, followed by the remaining highest totals. Selection scans all
contenders at actual play timestamps, independently of the 200 display buckets.
The race starts from zero for each selected range; tied leaders each receive the
full tied interval, and repeated reigns add together. No crown time is credited
before the first play or into the future. Crown-duration ties use final listening
time, then ID. The compact legend sits on the right on desktop and below the
chart in two columns on narrow screens. Detailed totals remain in the existing
table and chart tooltip.

Settings → Statistics now offers an optional All-time start date. It changes
the shared All preset (including comparisons) without changing stored plays or
the import-maintained first-listen timestamp. Clearing it restores full history;
other presets and custom ranges stay unchanged. The date is saved per user as
`settings.allTimeStartDate` (YYYY-MM-DD or null), and the profile exposes its
derived UTC `allTimeStartAt` using the statistics timezone. Future/invalid dates
are rejected. Migration `1790035200000` initializes missing preferences to null
without overwriting existing choices; the optional field also works before the
migration runs. `test/allTimeStart.test.cjs` covers range selection, timezone/DST
boundaries, authenticated persistence, reset, migration, and historical imports.

Release decades, listening calendar and daily rhythms share 21px squares with
3px gaps and a 58px row-label gutter, aligned at the left of their cards. Artist
eras uses the same squares and left alignment with a wider gutter for names.
Calendar and rhythm grids scroll within their cards when necessary; hourly
labels are centered over every rhythm cell, from 00 through 23.

Song, album and artist detail pages now have listening calendars using the same
adaptive grid, rounded cells, timezone handling and keyboard/touch details as
`/all`. They always cover the item's first valid listen through today, independent
of the All-time start preference. The shared `/spotify/detail-listening` endpoint
uses recorded event durations and primary-artist attribution. Explicitly viewed
items retain blacklisted listens, matching the existing detail statistics.

Albums also have a Songs over time matrix in disc/track order, including known
unplayed tracks. It uses global hours color scaling and the same 21px squares,
with up to 64 columns and roughly 4,096 cells. Long track lists scroll inside
the card with sticky column headings and song labels. No settings, info buttons,
data tables or explanatory text are added.

The main artist history chart is now a lifetime listening-rate curve in h/day.
It uses a duration-weighted Gaussian KDE with automatic bandwidth of about five
days per year of history, capped at 28 days. Short histories use a smaller
bandwidth. Input is bounded to 1,024 bins and output to 512 samples; boundary
normalization preserves the total recorded hours. The vertical scale stays
linear, so smoothing does not additionally clip or compress large peaks.
Obsession periods and Rediscoveries, including their backend calculations, are
removed. Listening milestones retain dates and hours without a description;
Favourites over time retains its album/song switch and compact side legend.

Artist Time of day compares green artist bars with a dashed overall line.
Each is independently normalized to a percentage of its lifetime listening
hours, in the user's statistics timezone. The overall baseline spans the entire
recorded library and excludes blacklisted plays as global statistics do.
`test/detailListening.test.cjs` covers duration preservation, smoothing, sparse
bin merging, hourly normalization, item/owner isolation, DST, album ordering,
invalid durations and lifetime behavior despite an All-time start preference.

The isolated preview uses the copied Mongo volume and loopback-only ports:

- original stack: `http://127.0.0.1:3000`, API `8080`
- plot preview: `http://127.0.0.1:3002`, API `8082`, Mongo `27029`

Start the preview from this directory with:

```sh
docker compose -f docker-compose.plots.yml up -d
```

Stop it with `docker compose -f docker-compose.plots.yml stop`. The copied
database volume is `your-spotify-plots_plots-db`; do not use `down -v` unless
you intentionally want to discard that copy.

The focused tests use a disposable Mongo container without data volumes:

```sh
docker run --rm -d --name your-spotify-patterns-test-mongo \
  --network your-spotify-plots_snapshot mongo:6
docker compose -f docker-compose.plots.yml exec -T \
  -e TIMELINE_TEST_MONGO_URI=mongodb://your-spotify-patterns-test-mongo:27017 \
  server sh -lc 'cd /app/apps/server && node --test test/artistDistribution.test.cjs test/artistEras.test.cjs test/releaseDistribution.test.cjs test/listeningPatterns.test.cjs test/competitionArtists.test.cjs test/raceTimeline.test.cjs test/raceLeaders.test.cjs test/allTimeStart.test.cjs test/detailListening.test.cjs test/listeningTimeline.test.cjs'
docker stop your-spotify-patterns-test-mongo
```

Tests create and remove uniquely named databases only in that disposable instance.
Do not point the test URI at either preview database.
