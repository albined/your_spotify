# Artist groups

Settings → Admin → Artist groups lets an administrator combine artist aliases
for everyone's statistics. Create a group, add 2–50 artists from the local
library, name it, choose a member's image, and save. The enabled switch applies
or removes the grouping. Names, members and images remain editable; deleting a
group restores its members' individual statistics.

Each group has a stable `group:<uuid>` ID. It is independent of the group's name,
image and membership. Each Spotify artist can belong to only one group, including
disabled groups. Groups cannot contain groups. Disabling/deleting does not change
the original artist URLs; they resolve to individual artists again. A disabled
or deleted group's own URL shows an unavailable state with a retry action.

## Statistics behavior

Enabled groups are applied before ranking, row selection, unique-artist counting,
era selection and crown-time calculations. Combined listening can therefore put
a group in a top list even when neither member previously qualified on its own.
Grouping affects all users' definitions, while their histories remain separate.

The same grouping is used by the home-page artist ranking, top-artist lists and
races, distribution, eras, artist activity, sessions, artist detail statistics,
calendars, listening milestones, song/album eras, artist affinity, competition
artist selection, artist-filtered races and rolling diversity. Artist credits
and navigation also use the group's name and image. A group member's artist
link opens the combined detail page while grouping is enabled.

Spotify track and album IDs remain separate. One play remains one play, and
multiple credited aliases collapse to one credit while preserving primary-artist
order. Primary-artist attribution follows the existing statistics rules.
The artist page's menu lists the group's members with their original Spotify
links. Grouping never changes Spotify playlists or writes synthetic IDs to Spotify.

Blacklists remain per user and per original artist. Existing exclusions continue
to apply before aggregation. Blacklisting/unblacklisting a group acts on its
current members. Editing global membership does not rewrite personal blacklists.
Detail pages retain explicitly viewed blacklisted plays as before.

## Implementation

`ArtistGroupModel` stores configuration in `artistgroups`. The unique multikey
index on `memberIds` enforces non-overlap even for concurrent writes. Updates and
deletes also check a revision to reject stale admin edits. The CRUD API uses the
existing login/admin middleware, Zod validation and application error handling.
Raw artist search for the editor is admin-only; statistics search returns groups.

`StatisticsInfosModel` is used for statistics reads against the existing `infos`
collection. Its aggregation middleware expands an initial group/alias filter
to original member IDs, retaining the indexed owner/date/artist match. It then
maps primary artists and deduplicates artist credits before further aggregation.
Track/album lookup credits use the same mapping, and artist lookups supplement
original metadata with the group's virtual metadata. Shared metadata helpers
handle queries that fetch artist documents separately from the aggregation.

Group configuration and member metadata are cached for five seconds, with
immediate invalidation after an admin write in the same server process. Search
result metadata is fetched in batches. With no enabled groups, the statistics
aggregation pipeline is unchanged. Normal ingestion, historical import,
deduplication and metadata-repair paths retain `InfosModel`, `ArtistModel` and
raw Spotify IDs. No listening event or Spotify metadata document is rewritten
when groups are created, edited, disabled or deleted.

Migration `1790121600000-add_artist_groups` creates the group indexes without
modifying listening history. It is registered in `migrations.ts`.

## Validation

`test/artistGroups.test.cjs` uses a disposable database to exercise group totals
before top-list limits, alias detail routes, eras, rankings, session artwork,
affinity, competition minima, rolling diversity, deduplicated credits, future
ingestion, raw metadata access, reversibility, nested/overlapping membership,
concurrent membership edits, stale revisions and admin authorization. It checks
that stored plays and original artist documents are unchanged by group edits.
The existing plot regressions also run with no groups configured.

Browser checks cover creating an Avicii/Tim Berg group, its combined artist page
and All stats, changing its image, disabling and deleting it, and dark/mobile
layout. The form stays open when crossing the mobile breakpoint. Temporary
browser-test groups are removed afterward. The checked full-history distribution
requests took 75–94 ms without grouping and 94–99 ms with one group in the local
preview; these are local observations, not a performance guarantee.
