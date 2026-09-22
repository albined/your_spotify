# Plot V1 working notes

Reversible global artist grouping is documented in [Artist groups](artist-groups.md).

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

Artist pages also have Album eras and Song eras, covering the artist's lifetime.
Albums need at least 2% of the artist's recorded listening time and are capped at
ten. Song selection keeps the five highest lifetime listening-time totals, then
fills up to five rows with local favorites from less-represented periods. Local
periods are calendar months for histories of at least 180 days, Monday weeks
otherwise, in the statistics timezone. The minimum period activity is 10% of
median active-period listening, bounded between ten and thirty minutes; a huge
burst cannot raise that threshold indefinitely. Local top-three songs need three
plays.
Each period has equal influence. Greedy selection adds the song that most improves
coverage beyond the strongest already-selected song in each period, using local
listening time relative to that period's leader. Ties and any unfilled rows use
lifetime listening time, then ID. This preserves older phases even when a later
burst dominates total hours, without filling every era row from one phase.

Both artist matrices use the album matrix component: aligned 21px rounded cells,
up to 64 columns, hover/touch details and keyboard navigation. Rows sort by peak
date, and colors blend 80% row-relative and 20% global square-root intensity.
Selection considers every recorded song before querying 256 display bins for
the selected rows. Artist attribution, blacklisting and lifetime behavior match
the other detail charts. No settings or explanation text are added; empty eras
are omitted. `test/artistItemEras.test.cjs` covers phase coverage, the album share
threshold and caps, fallbacks, timezone/DST boundaries, owner/item isolation and
exact duration totals. Existing album matrices retain track order and global
color scaling.

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

Longest sessions now shows five horizontal bars on a shared elapsed-time scale.
Each artist has one combined block, ordered by credited listening time, with
consistent colors across sessions. Overlapping play tails are clipped at the
next play; pauses are collected in a neutral remainder. Artwork appears only
in blocks at least 34px wide, capped at ten circles per session. Dates use the
statistics timezone; headers show duration and song count and expand the song
list. Session ranking now includes the final song's duration and includes plays
at the selected start boundary. Artist names and artwork come from the session
query, without additional Spotify requests.

Competition includes Artist diversity and Time of day cards, placed side by
side when there is room. Diversity uses duration-weighted inverse Simpson,
`1 / sum(p_i²)`, shown as effective artists. Ten equally weighted artists score
ten; adding more listening in identical proportions does not change the score.
Each point uses the preceding 30 × 24 hours, including listening before the
selected range starts. The window is `[timestamp - 30 days, timestamp)`, so the
same timestamp has the same score regardless of the selected range. An empty
window scores zero; future range ends are clamped to the current time. All primary
artists are considered, with no top-artist cap. Exact play timestamps determine
entry and expiry changes at up to 201 display samples; long ranges do not widen
the window. The metric definition follows
the [vegan diversity reference](https://vegandevs.github.io/vegan/reference/diversity.html).
The grouped hourly bars show each person's percentage of their selected-period
listening hours, using that person's local timezone and matching the race colors.
Queries exclude blacklisted, invalid-duration and future plays and limit database
concurrency to four participants at once.

Settings → Account → Competition has an Include me in competitions switch,
enabled by default. Opted-out users are omitted from the competition picker, and
every competition data query rejects unavailable participants with HTTP 403,
including the older `time_per` endpoint. The picker refreshes on window focus;
direct requests and stale selections cannot bypass the setting. The existing
global affinity permission remains required. Migration `1790035200001` initializes
missing `settings.allowCompetitions` fields to true without overwriting opt-outs;
missing values also work before migration. Tests in `competitionInsights.test.cjs`
and `sessionBars.test.cjs` cover the metric, timezone/DST behavior, grouped bars,
artwork cap, session ranking, authenticated settings, migration and API enforcement.
`rollingDiversity.test.cjs` compares every sample with an independent calculation
of its exact trailing window across short, long and overlapping date ranges. It
also covers warm-up history, expiry boundaries, empty windows, future dates and
keeping the warm-up history out of the selected-period hourly histogram.

Home and All stats share zero-based listening-volume lines with gentle
interpolation through the actual totals and a faint fill. There are no gridlines
or chart controls. One `/spotify/listening-overview` request supplies both hours
and play counts on All stats. Daily/hourly/monthly/yearly buckets use the
statistics timezone; missing buckets remain zero, and hollow points identify
partial periods. Long histories use monthly points up to 200 calendar months;
larger ranges fall back to annual totals without truncating the selected range.
Date ticks use local calendar boundaries: weekdays on short views, round day
numbers on month views, and regular months or years on longer views. Narrow
cards use wider intervals; the chart never picks arbitrary dates to fit labels.

Today compares local hours with their mean over the preceding 365 complete local
days, drawn as a faint second line. Week/month/last-7/last-30 views use daily
points and an `avg` notch on the Y-axis, with the exact daily average from the
365 days before the selection available on hover or keyboard focus. The notch
avoids overlapping tick labels and replaces the horizontal line and header key.
Quiet days count in that denominator; the selected period never contributes to
its own baseline. The reference is omitted when that full year predates recorded
history or the saved All start.
Partial periods' tooltips compare the same fraction of the average. This year
uses monthly points with a faint unfilled line for the corresponding months last
year, ending at the same local date/time for the incomplete current month
(Feb 29 is clamped to Feb 28). Last 365 days uses 53 elapsed-week buckets,
the last partial,
compared with a faint line for matching elapsed positions in the immediately
preceding period.
Unavailable reference buckets stay absent rather than becoming false zeros.
All history and long custom ranges have no comparison overlay; short custom
ranges use the same average defaults.

Artist diversity replaces the old distinct-artist time chart on All stats. It
uses the same duration-weighted trailing 30-day calculation as competition,
including warm-up history and global artist groups, with up to 201 samples.
Empty windows are gaps on the personal chart; the raw artist count remains on
Home. The personal endpoint is authenticated through the usual guest/user rules
and does not depend on competition participation. No new persisted fields or
migrations are needed. `listeningOverview.test.cjs` covers comparisons, DST,
leap years, missing history, partial buckets, invalid durations, blacklists,
account isolation, artist groups and route validation. Existing competition and
rolling-diversity tests also cover the shared calculation.

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
  server sh -lc 'cd /app/apps/server && node --test test/artistGroups.test.cjs test/artistDistribution.test.cjs test/artistEras.test.cjs test/artistItemEras.test.cjs test/releaseDistribution.test.cjs test/listeningPatterns.test.cjs test/competitionArtists.test.cjs test/competitionInsights.test.cjs test/rollingDiversity.test.cjs test/listeningOverview.test.cjs test/sessionBars.test.cjs test/raceTimeline.test.cjs test/raceLeaders.test.cjs test/allTimeStart.test.cjs test/detailListening.test.cjs test/listeningTimeline.test.cjs'
docker stop your-spotify-patterns-test-mongo
```

Tests create and remove uniquely named databases only in that disposable instance.
Do not point the test URI at either preview database.
