import CloseRounded from "@mui/icons-material/CloseRounded";
import {
  Alert,
  Autocomplete,
  Avatar,
  Button,
  CircularProgress,
  IconButton,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import { useEffect, useState } from "react";

import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import {
  ArtistVisibilityEntry,
  VisibilityArtist,
} from "../../../services/artistVisibility";
import { checkLogged } from "../../../services/redux/modules/user/thunk";
import { useAppDispatch } from "../../../services/redux/tools";

import s from "./index.module.css";

export default function ArtistVisibility() {
  const dispatch = useAppDispatch();
  const [entries, setEntries] = useState<ArtistVisibilityEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<VisibilityArtist[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError(undefined);
    api.artistVisibility().then(
      ({ data }) => {
        if (active) setEntries(data);
      },
      () => {
        if (active) setError("Could not load artist visibility.");
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    let active = true;
    setOptions([]);
    setSearchError(false);
    setSearching(Boolean(query.trim()));
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      api
        .searchVisibilityArtists(query.trim())
        .then(({ data }) => {
          if (active) setOptions(data);
        })
        .catch(() => {
          if (active) setSearchError(true);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const save = async (artistId: string, hidden: boolean | null) => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      if (hidden === null) await api.removeArtistVisibility(artistId);
      else await api.setArtistVisibility(artistId, hidden);
      const { data } = await api.artistVisibility();
      setEntries(data);
      setQuery("");
      await dispatch(checkLogged()).unwrap();
    } catch (e) {
      const response = e as { response?: { data?: { message?: string } } };
      setError(
        response.response?.data?.message ??
          "Could not save artist visibility. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <TitleCard title="Artist visibility" contentClassName={s.content}>
      <p className={s.description}>
        Hide artists from your statistics. Your listening history is always
        saved, and you can show them again anytime.
      </p>
      {error && (
        <Alert
          severity="error"
          action={
            !entries && (
              <Button color="inherit" onClick={() => setAttempt(attempt + 1)}>
                Retry
              </Button>
            )
          }>
          {error}
        </Alert>
      )}
      {entries === null ? (
        !error && <CircularProgress size={24} aria-label="Loading artists" />
      ) : (
        <>
          <Autocomplete
            value={null}
            inputValue={query}
            onInputChange={(_, value, reason) => {
              if (reason === "input" || reason === "clear") setQuery(value);
            }}
            onChange={(_, artist) => {
              if (artist) void save(artist.id, true);
            }}
            options={options}
            filterOptions={(items) => items}
            getOptionLabel={(artist) => artist.name}
            getOptionKey={(artist) => artist.id}
            getOptionDisabled={(artist) =>
              entries.some((entry) => entry.artistId === artist.id)
            }
            disabled={saving}
            loading={searching}
            noOptionsText={
              searchError
                ? "Search failed. Try again."
                : query.trim()
                  ? "No artists found in your library"
                  : "Type an artist name"
            }
            renderOption={({ key, ...props }, artist) => (
              <li key={key} {...props}>
                <Avatar
                  src={artist.images[0]?.url}
                  alt=""
                  className={s.optionImage}
                />
                {artist.name}
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Find an artist to hide" />
            )}
          />
          <p className={s.hint}>
            Only main-artist credits are hidden. Featured appearances stay.
          </p>
          {entries.length === 0 ? (
            <p className={s.empty}>No artists hidden.</p>
          ) : (
            <ul
              className={s.list}
              aria-label="Artist visibility preferences"
              aria-busy={saving}>
              {[...entries]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((entry) => (
                  <li className={s.row} key={entry.artistId}>
                    <Avatar src={entry.images[0]?.url} alt="" />
                    <div className={s.name}>
                      <span>{entry.name}</span>
                      <small>{entry.hidden ? "Hidden" : "Shown"}</small>
                    </div>
                    <Switch
                      checked={entry.hidden}
                      onChange={(_, hidden) =>
                        void save(entry.artistId, hidden)
                      }
                      slotProps={{
                        input: {
                          "aria-label": `Hide ${entry.name} from statistics`,
                          "aria-disabled": saving,
                        },
                      }}
                    />
                    <Tooltip title="Remove from this list and show in statistics">
                      <span>
                        <IconButton
                          size="small"
                          disabled={saving}
                          aria-label={`Remove ${entry.name} from visibility list`}
                          onClick={() => void save(entry.artistId, null)}>
                          <CloseRounded fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </TitleCard>
  );
}
