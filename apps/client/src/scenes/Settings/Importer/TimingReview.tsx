import { Button, CircularProgress } from "@mui/material";
import Axios from "axios";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../services/apis/api";
import type { TimingReview as TimingData } from "../../../services/importReview";

import s from "./ImportReview.module.css";

const duration = (ms: number) =>
  Math.floor(ms / 60000) +
  ":" +
  String(Math.floor(ms / 1000) % 60).padStart(2, "0");
const message = (error: unknown) =>
  Axios.isAxiosError<{ message?: string }>(error)
    ? (error.response?.data.message ??
      "Could not load the comparison. Try again.")
    : "Could not load the comparison. Try again.";

export default function TimingReview({
  group,
  disabled,
  date,
  onBusy,
  onSaved,
}: {
  group: string;
  disabled: boolean;
  date: (value: string | null) => string;
  onBusy: (value: boolean) => void;
  onSaved: (outcome: string) => Promise<void>;
}) {
  const [data, setData] = useState<TimingData>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const applying = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(undefined);
    api
      .getImportTiming(group)
      .then(({ data: result }) => {
        if (active) setData(result);
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
  }, [group, reload]);
  const apply = async (existingId: string | null, exclude = false) => {
    if (!data || disabled || applying.current || loading) return;
    applying.current = true;
    setSaving(true);
    onBusy(true);
    setError("");
    try {
      const { data: result } = await api.applyImportTiming(
        group,
        data.rowId,
        data.token,
        existingId,
        exclude,
      );
      await onSaved(result.outcome);
      setReload((n) => n + 1);
    } catch (err) {
      setError(message(err));
    } finally {
      applying.current = false;
      setSaving(false);
      onBusy(false);
    }
  };
  return (
    <section className={s.timing} aria-label="Compare saved listens">
      <h5>Is this already in your history?</h5>
      <p className={s.muted}>
        {data?.candidates.length &&
        data.candidates.every((play) => !play.canUse)
          ? "The saved listens belong to other export entries. Add this one separately, or leave it out."
          : "Use an existing listen, add this entry separately, or leave it out."}
      </p>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className={s.searchStatus} role="status">
          <CircularProgress size={16} color="inherit" /> Loading saved listens…
        </p>
      )}
      {data && !loading && (
        <>
          <div className={s.timingEntry}>
            <span className={s.eyebrow}>
              Export entry · {date(data.export.at)}
            </span>
            <a
              className={s.candidateTitle}
              href={data.export.track.url}
              target="_blank"
              rel="noreferrer">
              {data.export.track.title}
            </a>
            <span className={s.candidateMeta}>
              {duration(data.export.listenedMs)}{" "}
              {data.export.estimated
                ? "estimated from song length"
                : "listened"}
            </span>
          </div>
          <ul className={s.candidates} aria-label="Saved listens">
            {data.candidates.map((play) => (
              <li key={play.id}>
                <div className={s.candidateInfo}>
                  <span className={s.eyebrow}>Saved · {date(play.at)}</span>
                  <span className={s.candidateTitle}>
                    {play.track?.title ?? "Unknown recording"}
                  </span>
                  <span className={s.candidateMeta}>
                    {duration(play.listenedMs)}{" "}
                    {play.estimated ? "estimated from song length" : "listened"}
                  </span>
                  {!play.canUse && (
                    <span className={s.candidateMeta}>
                      Already linked to another export entry.
                    </span>
                  )}
                </div>
                {play.canUse && (
                  <Button
                    variant="outlined"
                    disabled={disabled || saving}
                    onClick={() => void apply(play.id)}>
                    Use this listen
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {!data.candidates.length && (
            <p className={s.muted}>No matching saved listens nearby.</p>
          )}
          {data.moreCandidates && (
            <p className={s.muted}>Showing 20 nearby saved listens.</p>
          )}
          <div className={s.matchActions}>
            {data.candidates.some((play) => play.canUse) && (
              <span className={s.muted}>
                Using an existing listen keeps its date and updates its song and
                listening time.
              </span>
            )}
            {data.canAdd && (
              <Button
                disabled={disabled || saving}
                onClick={() => void apply(null, true)}>
                Don't add this listen
              </Button>
            )}
            {data.canAdd && (
              <Button
                variant="outlined"
                disabled={disabled || saving}
                onClick={() => void apply(null)}>
                Add separate listen
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <Button
          disabled={disabled || saving}
          onClick={() => {
            setError("");
            setReload((n) => n + 1);
          }}>
          Refresh comparison
        </Button>
      )}
    </section>
  );
}
