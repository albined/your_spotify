import { Button, LinearProgress } from "@mui/material";
import { useState } from "react";
import { useSelector } from "react-redux";

import { api } from "../../../../services/apis/api";
import { selectImportStates } from "../../../../services/redux/modules/import/selector";
import { getImports } from "../../../../services/redux/modules/import/thunk";
import { useAppDispatch } from "../../../../services/redux/tools";

const labels = {
  ready: "Ready to import",
  progress: "Importing",
  success: "Complete",
  failure: "Stopped",
  "failure-removed": "Dismissed",
};
const sources: Record<string, string> = {
  privacy: "Spotify account data",
  "full-privacy": "Spotify extended history",
  deezer: "Deezer",
};
const date = (value: string) => new Date(value).toLocaleDateString();

export default function ImportHistory() {
  const imports = useSelector(selectImportStates);
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (id: string, dismiss = false) => {
    setBusy(true);
    setError("");
    try {
      if (dismiss) await api.cleanupImport(id);
      else await api.startPreparedImport(id);
      await dispatch(getImports(true));
    } catch {
      setError("Could not update this import. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!imports?.length) return null;
  const running = imports.some((st) => st.status === "progress");
  return (
    <div style={{ marginTop: 24 }}>
      <h3>Import history</h3>
      {imports.map((st) => (
        <article
          key={st._id}
          style={{ borderTop: "1px solid #8885", paddingBlock: 12 }}>
          <strong>
            {sources[st.type] ?? st.type} · {labels[st.status]}
          </strong>
          <p>
            Uploaded {date(st.createdAt)} · {st.total.toLocaleString()} rows
          </p>
          {st.range?.start && st.range.end && (
            <p>
              Dates in files: {date(st.range.start)} – {date(st.range.end)}
              {st.type === "deezer" && ` (${st.timezone ?? "UTC"})`}
            </p>
          )}
          {st.repairLegacyDeezer && (
            <p>Earlier Deezer version repairs enabled.</p>
          )}
          {st.status === "ready" && (
            <p>
              Existing matches will be updated; uncertain matches will be held
              aside. The date range does not guarantee complete history.
            </p>
          )}
          {st.status === "progress" && (
            <>
              <p aria-live="polite">
                {st.stage === "backup"
                  ? "Creating a database backup…"
                  : `Processed ${st.current.toLocaleString()} of ${st.total.toLocaleString()} rows`}
              </p>
              <LinearProgress
                variant={
                  st.stage === "backup" ? "indeterminate" : "determinate"
                }
                value={st.total ? (100 * st.current) / st.total : 0}
              />
            </>
          )}
          {st.summary && st.status !== "ready" && (
            <>
              <p>
                {st.summary.added.toLocaleString()} new ·{" "}
                {st.summary.updated.toLocaleString()} corrected ·{" "}
                {st.summary.unchanged.toLocaleString()} unchanged
              </p>
              <p>
                {st.summary.short.toLocaleString()} under 30s ·{" "}
                {st.summary.invalid.toLocaleString()} invalid ·{" "}
                {st.issueCounts ? (
                  <>
                    {st.issueCounts.recording.toLocaleString()} unmatched ·{" "}
                    {st.issueCounts.legacy.toLocaleString()} existing-play
                    matches · {st.issueCounts.timestamp.toLocaleString()}{" "}
                    conflicting export rows
                  </>
                ) : (
                  <>
                    {st.summary.unresolved.toLocaleString()} unmatched ·{" "}
                    {st.summary.ambiguous.toLocaleString()} uncertain
                  </>
                )}
              </p>
              {(Boolean(st.summary.duplicates) || Boolean(st.estimated)) && (
                <p>
                  {(st.summary.duplicates ?? 0).toLocaleString()} duplicate rows
                  combined · {(st.estimated ?? 0).toLocaleString()} listens use
                  estimated song length
                </p>
              )}
              <p>
                {!!st.summary.excluded && (
                  <>
                    {st.summary.excluded.toLocaleString()} not added by your
                    choice ·{" "}
                  </>
                )}
                {!!st.summary.noMatch && (
                  <>
                    {st.summary.noMatch.toLocaleString()} marked not on Spotify
                    ·{" "}
                  </>
                )}
                Listening-time change: {st.summary.deltaMs >= 0 ? "+" : ""}
                {(st.summary.deltaMs / 3600000).toFixed(2)} hours, including new
                plays.
              </p>
            </>
          )}
          {st.backup && <p>Pre-import backup saved.</p>}
          {st.error && <p role="alert">{st.error}</p>}
          {!!st.issues?.length && (
            <details>
              <summary>Original import examples (up to 100)</summary>
              <p>
                These are examples recorded when the import ran. Use Review
                unresolved imports below for the current saved queue. Older
                imports need a reupload to populate that queue.
              </p>
              <ul>
                {st.issues.map((issue) => (
                  <li key={issue.row}>
                    Row {issue.row}: {issue.title || "Unknown track"} —{" "}
                    {issue.reason}
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [JSON.stringify({ ...st, issues: st.issues }, null, 2)],
                      { type: "application/json" },
                    ),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `import-${st._id}.json`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}>
                Download receipt
              </Button>
            </details>
          )}
          {(st.status === "ready" || st.status === "failure") && (
            <>
              <Button
                disabled={busy || running}
                onClick={() => void run(st._id)}>
                {st.status === "ready"
                  ? "Start import"
                  : "Retry from saved progress"}
              </Button>
              <Button
                disabled={busy || running}
                onClick={() => void run(st._id, true)}>
                Dismiss
              </Button>
            </>
          )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
