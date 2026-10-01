import {
  CheckRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  OpenInNewRounded,
  RefreshRounded,
} from "@mui/icons-material";
import {
  Button,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Tooltip,
} from "@mui/material";
import Axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../../../services/apis/api";
import type {
  ReviewCandidate,
  ReviewCategory,
  ReviewGroups,
} from "../../../services/importReview";
import { selectUser } from "../../../services/redux/modules/user/selector";
import TimingReview from "./TimingReview";

import s from "./ImportReview.module.css";

const reviewViews = [
  ["recording", "Recording matches"],
  ["timestamp", "Conflicting timestamps"],
  ["invalid", "Invalid source rows"],
  ["no-match", "Not on Spotify"],
] as const;

const message = (error: unknown) =>
  Axios.isAxiosError<{ message?: string }>(error)
    ? (error.response?.data.message ?? "Could not load the review. Try again.")
    : "Could not load the review. Try again.";
const duration = (ms: number) =>
  Math.floor(ms / 60000) +
  ":" +
  String(Math.floor(ms / 1000) % 60).padStart(2, "0");
const listeningTime = (ms: number) => {
  if (ms < 60000) return Math.floor(ms / 1000) + "s";
  const minutes = Math.floor(ms / 60000);
  return minutes < 60
    ? minutes + "m"
    : Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
};
const isTrackInput = (value: string) =>
  /^(https?:\/\/|spotify:)/i.test(value.trim()) ||
  /^[a-zA-Z0-9]{22}$/.test(value.trim());
type CandidateResult = {
  candidates: ReviewCandidate[];
  searchUnavailable: boolean;
};

export default function ImportReview({
  running,
  refreshKey,
}: {
  running: boolean;
  refreshKey: string;
}) {
  const user = useSelector(selectUser);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReviewCategory>("recording");
  const [queue, setQueue] = useState<ReviewGroups>({ groups: [], counts: [] });
  const [index, setIndex] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [visibleCount, setVisibleCount] = useState(3);
  const [searching, setSearching] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const applying = useRef(false);
  const requests = useRef(0);
  const candidateCache = useRef(new Map<string, ReviewCandidate[]>());
  const candidateRequests = useRef(new Map<string, Promise<CandidateResult>>());
  const group =
    queue.groups[Math.min(index, Math.max(queue.groups.length - 1, 0))];
  const groupId = group?._id;
  const groupTitle = group?.title;
  const savedTrackId = group?.savedTrackId;
  const noMatch = group?.noMatch;
  const nextGroup =
    queue.groups.length > 1
      ? queue.groups[(index + 1) % queue.groups.length]
      : undefined;
  const nextTitle =
    nextGroup && !nextGroup.savedTrackId && !nextGroup.noMatch
      ? nextGroup.title
      : undefined;
  const disabled = busy || loading || running;
  const zone = user?.settings.timezone;
  const date = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          timeZone: !zone || zone === "follow" ? undefined : zone,
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "Unknown date";
  const cancelSearch = useCallback(() => {
    requests.current++;
  }, []);
  const loadCandidates = useCallback(
    (value: string): Promise<CandidateResult> => {
      const searchQuery = value.trim().slice(0, 160);
      const cacheKey = searchQuery.toLowerCase();
      const cached = candidateCache.current.get(cacheKey);
      if (cached)
        return Promise.resolve({
          candidates: cached,
          searchUnavailable: false,
        });
      const pending = candidateRequests.current.get(cacheKey);
      if (pending) return pending;
      const request = api
        .getImportCandidates(searchQuery)
        .then(({ data }) => {
          if (!data.searchUnavailable) {
            if (candidateCache.current.size >= 100)
              candidateCache.current.delete(
                candidateCache.current.keys().next().value!,
              );
            candidateCache.current.set(cacheKey, data.candidates);
          }
          return data;
        })
        .finally(() => candidateRequests.current.delete(cacheKey));
      candidateRequests.current.set(cacheKey, request);
      return request;
    },
    [],
  );
  const search = useCallback(
    async (value: string) => {
      if (!value.trim()) return;
      const request = ++requests.current;
      setSearching(true);
      setVisibleCount(3);
      setCandidates([]);
      setError("");
      try {
        const data = await loadCandidates(value);
        if (request !== requests.current) return;
        setCandidates(data.candidates);
        setSearchUnavailable(data.searchUnavailable);
      } catch (err) {
        if (request === requests.current) setError(message(err));
      } finally {
        if (request === requests.current) setSearching(false);
      }
    },
    [loadCandidates],
  );
  useEffect(() => {
    if (
      !open ||
      running ||
      loading ||
      busy ||
      searching ||
      searchUnavailable ||
      category !== "recording" ||
      !nextTitle
    )
      return;
    // Start only after the current search settles; share in-flight requests if
    // the user advances before preloading finishes. Navigation cancels the timer.
    const timer = setTimeout(() => {
      void loadCandidates(nextTitle).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [
    open,
    running,
    loading,
    busy,
    searching,
    searchUnavailable,
    category,
    nextTitle,
    loadCandidates,
  ]);
  useEffect(() => {
    if (!open || running) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .getImportReview(category)
      .then(({ data }) => {
        if (active) {
          setQueue(data);
          setIndex((i) => Math.min(i, Math.max(0, data.groups.length - 1)));
        }
      })
      .catch((err: unknown) => {
        if (active) setError(message(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, category, reload, refreshKey, running]);
  useEffect(() => {
    requests.current++;
    setCandidates([]);
    setSearching(false);
    setSearchUnavailable(false);
    setVisibleCount(3);
    setQuery(groupTitle ?? "");
    if (
      groupId &&
      groupTitle &&
      !savedTrackId &&
      !noMatch &&
      category === "recording" &&
      open &&
      !running
    )
      void search(groupTitle);
    return cancelSearch;
  }, [
    groupId,
    groupTitle,
    savedTrackId,
    noMatch,
    category,
    open,
    running,
    search,
    cancelSearch,
  ]);
  const navigate = (step: number) => {
    if (!queue.groups.length) return;
    setIndex((i) => (i + step + queue.groups.length) % queue.groups.length);
    setNotice("");
    setError("");
  };
  const apply = async (track: string | null, reopen = false) => {
    if (!group || disabled || applying.current) return;
    applying.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    cancelSearch();
    setSearching(false);
    try {
      if (reopen) {
        await api.reopenImportNoMatch(group._id);
        setNotice("Moved back to recording matches.");
      } else if (track === null) {
        await api.markImportNoMatch(group._id);
        setNotice("Saved as not on Spotify.");
      } else {
        const { data } = await api.applyImportChoice(group._id, track);
        const matched =
          data.summary.added + data.summary.updated + data.summary.unchanged;
        setNotice(
          data.summary.ambiguous
            ? "Choice saved. " +
                data.summary.ambiguous +
                " still need comparison with saved listens."
            : "Saved · " + matched + (matched === 1 ? " listen" : " listens"),
        );
      }
      // Advance to the next recording, even when timing issues remain here.
      const nextId = reopen
        ? group._id
        : queue.groups[(index + 1) % queue.groups.length]?._id;
      try {
        const view = reopen ? "recording" : category;
        const { data: refreshed } = await api.getImportReview(view);
        setCategory(view);
        setQueue(refreshed);
        const nextIndex = refreshed.groups.findIndex((g) => g._id === nextId);
        setIndex(
          nextIndex >= 0
            ? nextIndex
            : Math.min(index, Math.max(0, refreshed.groups.length - 1)),
        );
      } catch {
        setError("Choice saved. Refresh to load the remaining recordings.");
      }
    } catch (err) {
      setError(message(err));
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };
  const timingSaved = async (outcome: string) => {
    setNotice(
      outcome === "excluded"
        ? "Not added. Existing listens unchanged."
        : outcome === "added"
          ? "Separate listen added."
          : "Saved listen updated.",
    );
    const nextId = queue.groups[(index + 1) % queue.groups.length]?._id;
    try {
      const { data } = await api.getImportReview(category);
      setQueue(data);
      const current = data.groups.findIndex((g) => g._id === groupId);
      const next = data.groups.findIndex((g) => g._id === nextId);
      setIndex(current >= 0 ? current : Math.max(0, next));
    } catch {
      setError("Choice saved. Refresh to load the remaining recordings.");
    }
  };
  const rankedCandidates = [...candidates].sort(
    (a, b) =>
      Number(
        Boolean(group?.isrc) &&
          b.isrc?.toUpperCase() === group?.isrc?.toUpperCase(),
      ) -
      Number(
        Boolean(group?.isrc) &&
          a.isrc?.toUpperCase() === group?.isrc?.toUpperCase(),
      ),
  );
  return (
    <details
      className={s.review}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Review unresolved imports</summary>
      {open && (
        <div className={s.body}>
          <div className={s.toolbar}>
            <FormControl size="small" className={s.category}>
              <InputLabel id="review-category-label">Review</InputLabel>
              <Select
                labelId="review-category-label"
                label="Review"
                value={category}
                disabled={disabled}
                onChange={(event) => {
                  setCategory(event.target.value as ReviewCategory);
                  setQueue({ ...queue, groups: [] });
                  setIndex(0);
                  setNotice("");
                  setError("");
                }}>
                {reviewViews.map(([view, label]) => (
                  <MenuItem key={view} value={view}>
                    {label} (
                    {queue.groupCounts?.[view]?.toLocaleString() ?? "…"})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Tooltip title="Refresh review">
              <span>
                <IconButton
                  aria-label="Refresh review"
                  disabled={disabled}
                  onClick={() => setReload((n) => n + 1)}>
                  <RefreshRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </div>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className={s.notice} role="status">
              <CheckRounded fontSize="small" /> {notice}
            </p>
          )}
          {running && (
            <p className={s.muted} role="status">
              Waiting for the import to finish…
            </p>
          )}
          {loading && (
            <p className={s.muted} role="status">
              Loading recordings…
            </p>
          )}
          {!loading && !running && !group && (
            <p className={s.empty}>All clear in this category.</p>
          )}
          {group && !running && (
            <>
              <nav
                aria-label="Import review navigation"
                className={s.navigation}>
                <span className={s.muted}>
                  {category === "recording" || category === "no-match"
                    ? "Most listens first"
                    : category === "timestamp"
                      ? "Oldest first"
                      : "Most rows first"}
                </span>
                <div className={s.paging}>
                  <Tooltip title="Previous · keep undecided">
                    <span>
                      <IconButton
                        aria-label="Previous"
                        disabled={disabled || queue.groups.length < 2}
                        onClick={() => navigate(-1)}>
                        <ChevronLeftRounded />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <span aria-live="polite">
                    {index + 1} / {queue.groups.length}
                  </span>
                  <Tooltip title="Next · keep undecided">
                    <span>
                      <IconButton
                        aria-label="Next"
                        disabled={disabled || queue.groups.length < 2}
                        onClick={() => navigate(1)}>
                        <ChevronRightRounded />
                      </IconButton>
                    </span>
                  </Tooltip>
                </div>
              </nav>
              <section className={s.recording} aria-label="Source recording">
                <span className={s.eyebrow}>
                  {group.provider === "deezer" ? "Deezer" : "Spotify"} export
                </span>
                <h4>
                  {category === "timestamp"
                    ? date(group.start)
                    : group.title || "Unknown recording"}
                </h4>
                {category !== "timestamp" && (
                  <>
                    <p className={s.artist}>
                      {group.artist || "Unknown artist"}
                    </p>
                    {group.album && <p className={s.album}>{group.album}</p>}
                  </>
                )}
                <dl className={s.stats}>
                  <div>
                    <dt>
                      {category === "recording" || category === "no-match"
                        ? "listens"
                        : "source rows"}
                    </dt>
                    <dd>{group.count.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>
                      {category === "recording" || category === "no-match"
                        ? "listened"
                        : "export listening time"}
                      {group.timedCount > 0 && group.timedCount < group.count
                        ? " (partial)"
                        : ""}
                    </dt>
                    <dd>
                      {group.timedCount
                        ? listeningTime(group.listenedMs)
                        : "Unavailable"}
                    </dd>
                  </div>
                </dl>
              </section>
              {category === "timestamp" && (
                <p className={s.muted}>
                  Conflicting entries, not confirmed listens. Left unresolved.
                </p>
              )}
              {category === "invalid" && (
                <p className={s.muted}>
                  Missing or invalid export data. Excluded from your stats.
                </p>
              )}
              {category === "recording" && savedTrackId && (
                <div className={s.saved}>
                  <CheckRounded fontSize="small" />
                  <span>Song matched · compare saved listens below</span>
                  <a
                    href={"https://open.spotify.com/track/" + savedTrackId}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open saved match in Spotify">
                    <OpenInNewRounded fontSize="small" />
                  </a>
                </div>
              )}
              {(category === "no-match" || noMatch) && (
                <div className={s.matchActions}>
                  <span className={s.muted}>
                    Saved without a Spotify match · not added to stats
                  </span>
                  <Button
                    disabled={disabled}
                    onClick={() => void apply(null, true)}>
                    Find a match
                  </Button>
                </div>
              )}
              {category === "recording" && !noMatch && (
                <>
                  {!savedTrackId && (
                    <div className={s.matchHeading}>
                      <h5>Choose a match</h5>
                      <span className={s.muted}>
                        Selection saves automatically
                      </span>
                    </div>
                  )}
                  {!savedTrackId && (
                    <>
                      <form
                        className={s.search}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (isTrackInput(query)) void apply(query.trim());
                          else void search(query.trim().slice(0, 160));
                        }}>
                        <TextField
                          fullWidth
                          label="Search or paste a Spotify link"
                          size="small"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          slotProps={{ htmlInput: { maxLength: 500 } }}
                          disabled={disabled}
                        />
                        <Button
                          type="submit"
                          variant="outlined"
                          disabled={disabled || searching || !query.trim()}>
                          {isTrackInput(query) ? "Select" : "Search"}
                        </Button>
                      </form>
                      {searchUnavailable && (
                        <p className={s.muted} role="status">
                          Spotify search unavailable. Try a track link.
                        </p>
                      )}
                      {searching && (
                        <p className={s.searchStatus} role="status">
                          <CircularProgress size={16} color="inherit" /> Finding
                          matches…
                        </p>
                      )}
                      {!searching && candidates.length === 0 && (
                        <p className={s.empty}>
                          No matches. Try another search or a Spotify link.
                        </p>
                      )}
                      <ul
                        className={s.candidates}
                        aria-label="Spotify matches"
                        aria-busy={busy}>
                        {rankedCandidates
                          .slice(0, visibleCount)
                          .map((candidate) => (
                            <li key={candidate.id}>
                              <div className={s.candidateInfo}>
                                <a
                                  className={s.candidateTitle}
                                  href={candidate.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={
                                    candidate.title + " · open in Spotify"
                                  }>
                                  {candidate.title}
                                  <OpenInNewRounded />
                                </a>
                                <span className={s.candidateArtist}>
                                  {candidate.artists.join(", ")}
                                </span>
                                <span className={s.candidateMeta}>
                                  {candidate.album} ·{" "}
                                  {duration(candidate.durationMs)}
                                </span>
                                {candidate.isrc &&
                                  candidate.isrc.toUpperCase() ===
                                    group.isrc?.toUpperCase() && (
                                    <span className={s.exactMatch}>
                                      <CheckRounded /> Same recording ID
                                    </span>
                                  )}
                              </div>
                              <Button
                                variant="outlined"
                                disabled={disabled}
                                aria-label={"Select " + candidate.title}
                                onClick={() => void apply(candidate.id)}>
                                Select
                              </Button>
                            </li>
                          ))}
                      </ul>
                      <div className={s.matchActions}>
                        {candidates.length > visibleCount && (
                          <Button
                            disabled={disabled}
                            onClick={() => setVisibleCount((n) => n + 3)}>
                            Show more matches
                          </Button>
                        )}
                        <Tooltip title="Save this choice for future imports">
                          <span className={s.noMatch}>
                            <Button
                              disabled={disabled}
                              onClick={() => void apply(null)}>
                              Not on Spotify
                            </Button>
                          </span>
                        </Tooltip>
                      </div>
                    </>
                  )}
                  {savedTrackId && (
                    <TimingReview
                      key={groupId + ":" + reload + ":" + refreshKey}
                      group={group._id}
                      disabled={disabled}
                      date={date}
                      onBusy={setBusy}
                      onSaved={timingSaved}
                    />
                  )}
                </>
              )}
              {busy && (
                <p className={s.searchStatus} role="status">
                  <CircularProgress size={16} color="inherit" /> Saving choice…
                </p>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
