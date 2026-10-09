# Listening time, imports and recovery

Each play keeps `durationMs` (the catalog song length) and optionally
`listenedMs` (the duration reported by an export). Existing records remain
estimates until matched with an export. Importing never fabricates a reported
listening duration. The default statistics calculation uses `listenedMs` when
available, otherwise `durationMs`. Settings → Statistics → Listening time can
switch all time statistics to full song lengths without modifying stored data.
Competition comparisons apply the viewer's preference to all participants.
Legacy listening-session boundaries and spans retain the full-length calculation.

## Import flow

1. Choose Spotify extended history (preferred), Spotify account data, or a
   Deezer XLSX export. For Deezer, confirm the timezone of the dates: the file
   contains no offset, and the previous importer depended on the server timezone.
2. Check files. The preview shows the source, row count and earliest/latest dates.
   It does not change listening history or call Spotify. A range is not a claim
   that every day within it has complete history.
3. Start the import. A configured pre-import backup must succeed first.
4. Watch saved progress and added, corrected, unchanged, short, invalid,
   unmatched and uncertain counts. A receipt shows the listening-time delta,
   including new plays. Up to 100 problem examples can be expanded/downloaded.

All three sources retain listening duration. Deezer `Listening Time` is read as
seconds and converted to milliseconds; Spotify `msPlayed` / `ms_played` are
already milliseconds. New Deezer imports use song length when listening time is
missing or invalid (including -1), counting the event as an estimated listen.
The measured `listenedMs` stays absent, so later measured time can replace the
estimate. Other invalid identities/dates, unsupported tracks, and ambiguous DST
wall times remain excluded. Reported plays shorter than 30 seconds remain
excluded. Spotify invalid-duration handling is unchanged. Skip-rate statistics
are outside this change.

Extended Spotify exports can repeat short skips at the exact same timestamp
with different durations. These still fall below the listening threshold and
do not need conflict review. Reuploading resolves older conflict entries for
those short rows while retaining their evidence. Conflicting qualifying rows
remain held for review.
The same rule keeps a qualifying listen when its only conflicting rows are
short skips. Audio and music-video JSON files use the same import path and
event keys; overlapping files do not add another copy. Podcasts, audiobooks
and unavailable track identities are reported as unsupported, not timing conflicts.

Files remain available until success or dismissal. Configure `IMPORT_DIR` on a
persistent mount to support retries after container replacement. A process restart
marks running jobs failed, and retry resumes after the last durable row. Older
imports lack receipts and accuracy metadata; re-upload their exports to enrich
those plays. A successful import deletes its uploaded files, not its receipt.

## Matching and concurrency

Source identity includes provider/export type, track identity and source timestamp.
A unique per-user source-key index makes repeated exports idempotent. Precise
repeats with distinct source timestamps are separate plays. Standard Spotify
exports have minute precision and are inherently less certain.

For standard Spotify account exports, sub-30-second rows are excluded before
checking same-minute duration conflicts. A completed listen and a subsequent
short skip can share the same title, artist and minute. Multiple qualifying
durations in that minute remain unresolved. Reuploading also clears older review
items caused only by these short plays, retaining their original evidence.
Nearby API timestamps can lag the exported minute by more than 60 seconds;
the account importer checks a song-length window on either side and holds
unexplained offsets for review instead of adding another play. Before inserting
a new play with no nearby match, it also checks for unclaimed API plays within
15 minutes (longer for long recordings). This wider check can only request
review; it cannot create an automatic match or displace a confident nearby match.
Timing review can link an API-tracked listen while preserving its provenance.
Account-export timing decisions already in the review queue stay pending on
reupload. Later matched rows must not cause an earlier uncertain row to silently
become an additional listen on a second import; resolve it in the review instead.

Extended exports favor the precise export over uncertain API timing. Each unclaimed
API record is assigned to its nearest qualifying export event for the same Spotify
ID or confirmed ISRC, within 15 minutes (longer for long recordings). If several
saved records belong to that event, the closest timestamp wins; ties prefer the
earlier timestamp and then the saved record ID. Short skips do not compete with
qualifying listens. A distinct exported listen without an assigned saved record
is added automatically, including when it was previously held for timing review.

The complete uploaded timeline determines these assignments, including export
events already imported or excluded. A saved record cannot be reused for a second
export event when rows are reordered or an import resumes. This deliberately
accepts approximate timestamp associations to reduce manual work. It preserves
existing dates and never deletes surplus old API rows. Existing export claims,
manual exclusions, other accounts and other providers remain protected. Unknown
recording versions and saved timestamps outside the uploaded date range retain
the conservative matching rules and can still require review.
Provide all the relevant JSON files together for the strongest overlap checks.

When upgrading standard account data, an exact source identity, minute and
listening duration can prove which precise event an earlier row describes.
Extended Spotify IDs can then repair an automatic recording guess in place,
retaining the previous catalog fields in `recordingRepair`. Explicit recording
choices are held for review instead of being overwritten. Answered recording and
timestamp questions are resolved while retaining their original evidence;
`outcome: extended-export` links their `resolvedBy` field to the precise source
key. Reimporting the older file follows that link without recreating questions or
lowering the accuracy of the saved duration. Explicit excluded listens stay excluded.
Review and exclusion links check competing precise events in the upload, saved
review evidence (including resolved decisions), and imported history. Reviewing
one event cannot make an ambiguous minute row unique. If an earlier precise play
lacks its original export labels, another play with the same minute and duration
keeps the minute row unresolved until a fuller export establishes its identity.
For extended-history timing questions, a known Spotify ID opens the saved-listen
comparison directly; users do not need to select the already identified song again.

An import can match a legacy end timestamp or a Spotify API start/end timestamp.
Without a precise export timeline, multiple candidates or unexplained timing
differences are held aside without insertion. Reported durations from extended Spotify history
have priority over standard exports. Spotify and Deezer plays with known sources
are kept separate even if they reference the same Spotify catalog track.
Existing records have unknown provenance; their identity is inferred only when a
match is unambiguous. Matching uses ISRC recording IDs across Spotify releases and
preserves the existing play's catalog ID. Similar titles and artists without a
confirmed recording identity are held aside, including title capitalisation
variants. A unique exact Deezer timestamp takes precedence over nearby plays. By default,
a Deezer row that collides with an unidentified legacy play at the exact same
timestamp is held aside.

For previously imported Deezer history, the optional **Repair versions from an
earlier Deezer import** setting permits narrowly scoped catalog repairs. The
export ISRC must match the resolved recording, the old recording must have a
known different ISRC, and both must share a song title (allowing version labels)
and primary artist. Only a single exact-time event with no existing provenance
can be repaired. The event ID and timestamp stay intact; its catalog fields are
updated and `recordingRepair` saves the previous mapping and import ID. Same-ISRC
release aliases still preserve the existing catalog ID. The option is disabled
by default and saved on the import job so retries use the same policy. Retain original exports if uncertain records
need further work.

Provenance belongs to the listening event, not the shared catalog track. A Deezer
play can reference Spotify catalog metadata while retaining `provider: deezer`
and `listeningSource: deezer`. Each accepted event has stable `sourceKeys`; its
`durationImportId` links to the receipt that supplied the duration, whose
`fingerprint` is a SHA-256 hash of the normalized uploaded records. The fingerprint
checks file consistency, while source keys deduplicate overlaps between different
exports. An unchanged repeat keeps the original duration's import link. Legacy
Deezer imports did not retain any of this provenance, so their source is not
assigned solely from a date range or from the existence of an old import job.

Source-key lookups explicitly include the partial-index predicate needed by
MongoDB 6. Compact catalog identities and user play membership are cached for one
import, avoiding repeated history scans and writes to an unchanged account.
Source keys and their catalog tracks are prefetched in groups of 100 rows. Known
events bypass external track resolution; matching is still rechecked under the
write lock before changing history. Confirmed ISRC matches are cached by recording,
including across title/contributor spelling differences. Missing ISRCs are filled
in on existing catalog entries without replacing their titles, durations or album
links. Before reconciling legacy Deezer rows, the importer fetches missing ISRCs
for catalog IDs at those timestamps once per distinct track per run. It only
stores metadata returned for the requested ID and never treats a timestamp alone
as proof that recordings match. Search examines up to ten candidates while still
requiring exact ISRC agreement when the export supplies one.

New Deezer jobs record `deezerPolicyVersion: 1`. For the same recording and exact
export timestamp, they retain one event with the longest reported listening time
across available export evidence. A measured value takes precedence over an
unknown one. Different recordings at that timestamp remain separate events;
their exact timing is marked uncertain. Existing plays are matched by recording
within the timestamp, preventing one song from absorbing another. Existing
multiple matches and non-exact legacy timing still require review.

Original duplicate/unknown-time rows remain in the review evidence, with the
selected row and discarded duplicates identified. The receipt counts duplicate
rows separately and shows how many accepted listens used estimated song length.
Original source keys are retained alongside a stable recording/timestamp key.
A shorter later export cannot lower an already recorded Deezer listening time.
Original files are fingerprinted before applying these rules, preserving resume
checks. Jobs prepared before this policy retain their old behavior; reuploading
an export applies the new rules and resolves eligible older review entries.

Live ingestion and import reconciliation share the application's write lock;
imports cannot race polling between matching and insertion. Run one server writer
per database, as in the supplied Compose deployment. Multiple independent server
replicas writing the same database are not supported by this lock.
API source identities stay authoritative after export enrichment. An export-only
play may claim one matching API event durably; its other start/end timestamp
cannot then suppress a distinct API repeat. Confirmed ISRC release aliases still
refer to that same API event when its timestamp matches exactly.

A persisted per-row mutation result lets retries recover an insert/correction that
completed before its progress checkpoint. Added/corrected plays checkpoint
immediately; rows with no count or duration change checkpoint in groups of up to
100 and can be replayed after interruption. Repeated imports avoid rewriting
unchanged events, and issue examples are only written when they change.
The old startup routine that deleted
nearby same-track plays is no longer run: proximity alone cannot prove duplication.
No automatic deletion/merging of pre-existing duplicates is attempted.

## Backups

Backups are disabled by default. To enable them for the normal `server` Compose
service, add these values to the ignored `.env` file:

```dotenv
BACKUPS_ENABLED=true
BACKUP_BEFORE_IMPORT=true
BACKUP_SCHEDULE="0 3 * * *"
BACKUP_RETENTION_DAYS=14
BACKUP_HOST_DIR=./backups
```

Then include `docker-compose.backups.yml` when recreating the server. Inspect the
merged Compose configuration first and use the existing stack's project name.
The production Compose file calls its server service `app`; adapt the override's
service name if using that file. The runtime server images include `mongodump`.
A non-Docker installation must install MongoDB Database Tools and configure
`BACKUP_DIR` and `IMPORT_DIR` itself. Schedule syntax supports one daily UTC time
(`minute hour * * *`). Admin settings show configuration and the latest archive.
The schedule runs while the server is running; it does not backfill missed days.

Backups take a MongoDB `fsync` write lock, run a compressed database dump, then
unlock in a finally block. Reads remain available while writes wait. The database
account needs permission for `fsync` and `fsyncUnlock`. A dump timeout or failure
blocks the import. A failed dump never replaces a completed archive. Retention
only removes this application's completed archives after a successful backup.
Use a backup directory outside the database volume and copy archives off the host
if recovery from host/disk failure is required.

If the server process or host is forcibly killed while MongoDB remains running,
MongoDB may retain the write lock. An administrator must verify no backup is still
running and issue `db.fsyncUnlock()` from `mongosh` against that server. Normal
termination waits for the active dump to unlock; the Compose override allows an
11-minute shutdown grace period. Avoid force-killing the process. A future
replica-set deployment can use oplog-based consistent backups without this lock.

### Restore drill

Restore an archive into a separate disposable MongoDB instance first, using a
compatible MongoDB/Database Tools version:

```sh
mongorestore --uri=mongodb://127.0.0.1:27039 --gzip --archive=/path/to/backup.archive.gz
```

Check collection counts, known listening totals and application startup against
the restored copy. Before a real recovery, stop application writers, preserve
the current database separately, and restore into an empty replacement database.
A full restore rolls back all changes since the archive, not just one import.
Do not run restore commands against the live database as a routine import step.

## Saved import review

Settings → Account → Import listening history → **Review unresolved imports**
opens a persistent queue, ordered by most listens first. Previous/Next (including
wraparound) navigate without applying a choice. A compact recording summary shows
the number of listens and total reported listening time, counting each distinct
event once rather than multiplying repeated source evidence. Recording matches are
grouped by provider and source ISRC, falling back to Spotify ID or source
artist/title/album. Source album labels are retained to distinguish versions.
The category dropdown shows the number of review groups in each view, including
saved no-match groups. These counts match the navigation counter, not the number
of listens or raw source rows, and update after each saved choice.

Select a suggestion to save it immediately and advance to the next recording.
There is no preview or confirmation step. The search field also accepts a Spotify
track URL/URI/ID; submit **Select** to use it. Applying checks current history under
the ingestion write lock and uses the configured pre-import backup policy.
The next recording's suggestions preload after the current search settles.
Navigation reuses cached and in-flight searches; preloading never applies a choice.

**Not on Spotify** saves a per-account no-match choice and advances immediately.
Later imports of that source recording skip catalog resolution and count the rows
separately as marked not on Spotify. Their source evidence and listening time are
retained, but no new listening events or fake Spotify tracks are created. Existing
plays are left intact. The **Not on Spotify** filter shows these recordings;
**Find a match** reopens them and clears the saved no-match choice. Timestamp
conflicts in older jobs remain unresolved even if that recording has a no-match
choice. Reuploading a Deezer export applies the new rules while preserving
no-match choices and retaining only the selected event in that view.

One account's choice never affects another account. Choices are stored once per
source recording and reused by later exports, including renamed source labels
when the ISRC is unchanged. Applying a recording does not authorize merging
uncertain timestamps. Exact legacy Deezer repairs retain their prior mapping;
manual choices are linked through `Infos.recordingMappingId`. If artist ordering
changes, the primary-artist blacklist is recalculated. Original export ISRCs stay
on review evidence, not overwritten on the Spotify catalog.

All unresolved rows are stored compactly in `ImportReview`, independently of the
upload file and the receipt's 100 examples. Reuploads upsert stable issue keys;
conflicting duration variants are preserved separately, including variants
resolved by the Deezer longest-duration policy. Occurrence counts are the
maximum observed within an import, not a cumulative count across reuploads, and
are not assumed to be independent plays. Resolved evidence is retained with its
outcome and choice/import link. Deleting an account also removes its queue and
recording choices. Existing receipts cannot reconstruct lost rows: reupload the
source export once to populate the saved queue.

The category selector separates recording/existing-play matches, conflicting
source timestamps, and invalid source rows. The UI shows compact summaries;
paginated raw evidence remains available through the authenticated review API.
Conflicting variants are labelled as source rows and export listening time, not
confirmed listens. Conflicts retained from older jobs are read-only; reuploading
a Deezer export applies the longest-duration rule and keeps distinct recordings
with uncertain timing. Selecting a Spotify track alone does not apply that rule
to an older job or resolve uncertain matches against existing history. New receipts
break out unmatched recordings, existing-play matches and source conflicts;
receipt counts describe the original import, while the review queue reflects
subsequent resolutions.

Review requests share the per-account import guard. A saved mapping and stable
review-row mutation ID allow retry after a play was committed but before its
queue update. Refresh and retry the saved match to continue.
Already saved choices cannot be replaced through this initial review flow.

If a recording choice still leaves an uncertain match against history, a compact
comparison shows one pending export event and nearby saved listens, with dates,
versions and listening time (labelled estimated when appropriate). **Use this
listen** links the export to an unclaimed existing event, retaining its timestamp
and ID while updating its recording/duration as needed. **Add separate listen**
creates a separate event at the export timestamp. Each click saves directly, then
shows the next pending event or recording. Previous/Next can leave a decision for
later. Events already linked to another export entry cannot be repurposed.

**Don't add this listen** leaves all saved listening events unchanged and removes
only this export event from the pending queue. It retains the source evidence and
an exclusion flag, so later imports of the same source recording and timestamp
keep it excluded even if the reported duration changes. Other listens of that song
and other accounts are unaffected. Receipts count these as **not added by your
choice**, separately from recordings marked not on Spotify.

Timing choices use the import write lock and backup policy, revalidate the displayed
comparison before writing, and retain source keys so retries and later exports do
not add the event again. Catalog repairs retain the original mapping. A changed
comparison must be refreshed before choosing; no existing events are deleted.

## Validation

Run the regression suite with the local runner. It starts a MongoDB container
that exists only for the run, so the tests never reach the live database:

```sh
pnpm --filter @your_spotify/server test:local
```

Integration tests create and drop uniquely named `ystest_` databases, and refuse
to run against a server that holds any other database. To use a disposable
endpoint of your own instead:

```sh
TIMELINE_TEST_MONGO_URI=mongodb://127.0.0.1:27039 \
  pnpm --filter @your_spotify/server test
```

Archive restoration, lock release after a failed dump, and import refusal when a
required backup fails are verified by `backups.test.cjs`, which needs MongoDB
Database Tools. The local runner includes it when `mongodump` and `mongorestore`
are installed; with your own endpoint, also set `BACKUP_TEST_MONGO_URI` to it.

Synthetic cases cover API/export overlap, standard-to-extended upgrades, precise
repeated listens, Deezer duplicate policies, preserved review decisions, reported
versus estimated statistics, repeated imports and checkpoint recovery. Real
Spotify and Deezer exports have also been exercised on isolated database copies;
private exports, snapshots and validation logs are excluded from the repository.
Short export rows do not automatically delete old API plays. Correcting surplus
historical API events remains outside this change.
