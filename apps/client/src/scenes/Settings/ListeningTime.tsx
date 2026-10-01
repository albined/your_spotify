import { FormControlLabel, Switch } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { useSelector } from "react-redux";

import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import { useAPI } from "../../services/hooks/hooks";
import { selectUser } from "../../services/redux/modules/user/selector";
import { checkLogged } from "../../services/redux/modules/user/thunk";
import { useAppDispatch } from "../../services/redux/tools";

import s from "./ListeningSettings.module.css";

export default function ListeningTime() {
  const user = useSelector(selectUser);
  const accuracy = useAPI(api.listeningAccuracy);
  const dispatch = useAppDispatch();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const save = async (checked: boolean) => {
    setSaving(true);
    setError(false);
    try {
      await api.setSetting("useFullSongDurations", checked);
      const refreshed = await dispatch(checkLogged()).unwrap();
      if (!refreshed) throw new Error("Could not refresh account");
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <TitleCard title="Listening time" contentClassName={s.content}>
      <FormControlLabel
        label="Use full song durations"
        control={
          <Switch
            checked={user?.settings.useFullSongDurations ?? false}
            disabled={saving}
            onChange={(_, checked) => void save(checked)}
          />
        }
      />
      <p>
        By default, time statistics use reported listening time from imports,
        with full song length as an estimate for other plays. Enable this to use
        full song lengths throughout. Stored listening time is always preserved.
      </p>
      <p>Session estimates continue to use full song lengths.</p>
      {accuracy && (
        <>
          <p>
            {accuracy.reported.toLocaleString()} of{" "}
            {accuracy.total.toLocaleString()} plays have reported listening time
            {accuracy.total > 0 &&
              ` (${Math.round((100 * accuracy.reported) / accuracy.total)}%)`}
            .
          </p>
          <p>
            Last successful import:{" "}
            {accuracy.lastImport
              ? `${formatDistanceToNow(new Date(accuracy.lastImport), { addSuffix: true })} (${new Date(accuracy.lastImport).toLocaleDateString()})`
              : "None"}
          </p>
          {accuracy.latestReported && (
            <p>
              Latest play with reported time:{" "}
              {new Date(accuracy.latestReported).toLocaleString()}
            </p>
          )}
          <p>
            Earlier history may still include estimates. Import coverage can
            have gaps.
          </p>
        </>
      )}
      {error && <p role="alert">Could not save. Please try again.</p>}
    </TitleCard>
  );
}
