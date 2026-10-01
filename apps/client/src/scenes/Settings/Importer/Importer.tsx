import {
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import { selectImportStates } from "../../../services/redux/modules/import/selector";
import { getImports } from "../../../services/redux/modules/import/thunk";
import { ImporterStateType } from "../../../services/redux/modules/import/types";
import { useAppDispatch } from "../../../services/redux/tools";
import ImportHistory from "./ImportHistory";
import ImportReview from "./ImportReview";

import textStyles from "../ListeningSettings.module.css";
import s from "./index.module.css";

export default function Importer() {
  const dispatch = useAppDispatch();
  const imports = useSelector(selectImportStates);
  const [type, setType] = useState(ImporterStateType.fullPrivacy);
  const [files, setFiles] = useState<File[]>([]);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [timezone, setTimezone] = useState("UTC");
  const [repairLegacyDeezer, setRepairLegacyDeezer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = imports?.some((st) => st.status === "progress");
  useEffect(() => {
    void dispatch(getImports(true));
  }, [dispatch]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void dispatch(getImports(true)), 2000);
    return () => clearInterval(timer);
  }, [dispatch, running]);
  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      await api.prepareImport(
        type,
        files,
        timezone,
        type === "deezer" && repairLegacyDeezer,
      );
      setFiles([]);
      setSelectionVersion((version) => version + 1);
      await dispatch(getImports(true));
    } catch {
      setError(
        "Could not read these files. Check the export type, timezone and file format, then try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <TitleCard
      title="Import listening history"
      contentClassName={textStyles.content}>
      <p>
        Imports add missing plays and correct listening time on matched plays.
        Repeated imports keep existing plays without counting them twice.
      </p>
      {!running && (
        <>
          <FormControl className={s.selectimport} fullWidth>
            <InputLabel id="import-type-select">Export type</InputLabel>
            <Select
              labelId="import-type-select"
              label="Export type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as ImporterStateType);
                setFiles([]);
              }}>
              <MenuItem value="full-privacy">
                Spotify extended streaming history
              </MenuItem>
              <MenuItem value="privacy">Spotify account data</MenuItem>
              <MenuItem value="deezer">Deezer listening history</MenuItem>
            </Select>
          </FormControl>
          {type === "deezer" && (
            <>
              <p>
                Duplicate recordings at the same time use the longest listening
                time. Missing listening time uses song length.
              </p>
              <TextField
                label="Timezone of dates in the Deezer export"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                helperText="The file has no timezone. Confirm UTC or enter an IANA timezone, e.g. Europe/Stockholm."
                fullWidth
                margin="normal"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={repairLegacyDeezer}
                    onChange={(event) =>
                      setRepairLegacyDeezer(event.target.checked)
                    }
                  />
                }
                label="Repair versions from an earlier Deezer import"
              />
              {repairLegacyDeezer && (
                <p>
                  Use when you previously imported this Deezer history. A unique
                  play at the exact export time can be reassigned to the
                  confirmed version of the same song and artist. Its previous
                  mapping is saved.
                </p>
              )}
            </>
          )}
          <p>
            Choose{" "}
            {type === "deezer"
              ? "the .xlsx export"
              : "the streaming history .json files from your export"}
            . Plays under 30 seconds are excluded.
          </p>
          <input
            key={`${type}:${selectionVersion}`}
            type="file"
            aria-label="Listening history files"
            multiple
            disabled={busy}
            accept={type === "deezer" ? ".xlsx" : ".json"}
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <p>{files.length > 0 && `${files.length} file(s) selected`}</p>
          <Button
            variant="contained"
            disabled={busy || !files.length}
            onClick={() => void prepare()}>
            {busy ? "Checking files…" : "Check files"}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <ImportReview
        running={Boolean(running)}
        refreshKey={
          imports?.map((st) => `${st._id}:${st.status}`).join(",") ?? ""
        }
      />
      <ImportHistory />
    </TitleCard>
  );
}
