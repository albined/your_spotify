import {
  Alert,
  Autocomplete,
  Avatar,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useEffect, useState } from "react";

import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import { ArtistGroup, ArtistGroupsData } from "../../../services/artistGroups";
import { Artist } from "../../../services/types";

import s from "./index.module.css";

type Member = Pick<Artist, "id" | "name" | "images">;
const failure = (error: unknown) => {
  const response = error as { response?: { data?: { message?: string } } };
  return (
    response.response?.data?.message ??
    "Could not save artist groups. Please try again."
  );
};

function GroupEditor({
  group,
  data,
  onClose,
  onSaved,
}: {
  group: ArtistGroup | null;
  data: ArtistGroupsData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<Member[]>(
    data.members.filter((member) => group?.memberIds.includes(member.id)),
  );
  const [imageId, setImageId] = useState(group?.imageArtistId ?? "");
  const [enabled, setEnabled] = useState(group?.enabled ?? true);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    let current = true;
    setSearchError(false);
    if (!query.trim()) {
      setOptions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchGroupArtists(query.trim())
        .then((result) => {
          if (current) setOptions(result.data);
        })
        .catch(() => {
          if (current) setSearchError(true);
        })
        .finally(() => {
          if (current) setSearching(false);
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  const reserved = new Set(
    data.groups
      .filter((item) => item.id !== group?.id)
      .flatMap((item) => item.memberIds),
  );
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const input = {
        name: name.trim(),
        memberIds: members.map((member) => member.id),
        imageArtistId: imageId,
        enabled,
      };
      if (group) await api.updateArtistGroup({ ...group, ...input });
      else await api.createArtistGroup(input);
      await onSaved();
      onClose();
    } catch (e) {
      setError(failure(e));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!group) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.deleteArtistGroup(group);
      await onSaved();
      onClose();
    } catch (e) {
      setError(failure(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="artist-group-title">
      <DialogTitle id="artist-group-title">
        {deleting
          ? "Delete artist group?"
          : group
            ? "Edit artist group"
            : "Create artist group"}
      </DialogTitle>
      <DialogContent className={s.editor}>
        {error && <Alert severity="error">{error}</Alert>}
        {deleting ? (
          <p>The artists will appear separately again.</p>
        ) : (
          <>
            <TextField
              label="Group name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 80 } }}
              fullWidth
              disabled={saving}
            />
            <Autocomplete
              multiple
              options={[
                ...members,
                ...options.filter(
                  (option) =>
                    !members.some((member) => member.id === option.id),
                ),
              ]}
              value={members}
              disabled={saving}
              loading={searching}
              filterOptions={(items) => items}
              filterSelectedOptions
              getOptionLabel={(option) => option.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              getOptionDisabled={(option) => reserved.has(option.id)}
              inputValue={query}
              onInputChange={(_, value) => setQuery(value)}
              onChange={(_, value) => {
                if (value.length > 50) return;
                setMembers(value);
                if (!name.trim() && value[0]) setName(value[0].name);
                if (!value.some((member) => member.id === imageId))
                  setImageId(value[0]?.id ?? "");
              }}
              noOptionsText={
                query.trim() ? "No artists found" : "Type an artist name"
              }
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Avatar
                    src={option.images.at(-1)?.url}
                    alt=""
                    sx={{ width: 28, height: 28, marginRight: 1 }}
                  />
                  {option.name}
                  {reserved.has(option.id) ? " · Already grouped" : ""}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Artists"
                  placeholder="Search artists"
                  error={searchError}
                  helperText={
                    searchError ? "Search failed. Try again." : undefined
                  }
                />
              )}
            />
            {members.length > 0 && (
              <div>
                <div className={s.imageLabel}>Group image</div>
                <ToggleButtonGroup
                  value={imageId}
                  exclusive
                  onChange={(_, value: string | null) => {
                    if (value) setImageId(value);
                  }}
                  aria-label="Group image"
                  disabled={saving}
                  className={s.imageChoices}>
                  {members.map((member) => (
                    <ToggleButton
                      key={member.id}
                      value={member.id}
                      aria-label={`Use ${member.name} image`}
                      className={s.imageChoice}>
                      <Avatar src={member.images.at(-1)?.url} alt="" />
                      <span>{member.name}</span>
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={enabled}
                  onChange={(_, value) => setEnabled(value)}
                  disabled={saving}
                />
              }
              label="Count together for everyone"
            />
          </>
        )}
      </DialogContent>
      <DialogActions className={s.actions}>
        {group && !deleting && (
          <Button
            color="error"
            onClick={() => setDeleting(true)}
            disabled={saving}
            className={s.delete}>
            Delete group
          </Button>
        )}
        <Button
          onClick={deleting ? () => setDeleting(false) : onClose}
          disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={deleting ? "error" : "primary"}
          onClick={deleting ? remove : save}
          disabled={
            saving ||
            (!deleting && (!name.trim() || members.length < 2 || !imageId))
          }>
          {saving ? "Saving…" : deleting ? "Delete" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ArtistGroups() {
  const [data, setData] = useState<ArtistGroupsData>();
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<ArtistGroup | null | undefined>();
  const load = async () => {
    setError(false);
    setData((await api.getArtistGroups()).data);
  };
  useEffect(() => {
    void load().catch(() => setError(true));
  }, []);
  return (
    <TitleCard
      title="Artist groups"
      right={
        <Button onClick={() => setEditing(null)} disabled={!data}>
          Create group
        </Button>
      }>
      {!data ? (
        error ? (
          <Button onClick={() => void load().catch(() => setError(true))}>
            Retry
          </Button>
        ) : (
          <CircularProgress size={24} aria-label="Loading artist groups" />
        )
      ) : (
        <>
          {!data.groups.length && (
            <p>
              Count an artist’s aliases together across everyone’s statistics.
            </p>
          )}
          <div className={s.list}>
            {data.groups.map((group) => (
              <div className={s.group} key={group.id}>
                <Avatar
                  src={
                    data.members
                      .find((member) => member.id === group.imageArtistId)
                      ?.images.at(-1)?.url
                  }
                  alt=""
                />
                <div className={s.names}>
                  <strong>
                    {group.name}
                    {!group.enabled && (
                      <span className={s.disabled}> · Disabled</span>
                    )}
                  </strong>
                  <span>
                    {group.memberIds
                      .map(
                        (id) =>
                          data.members.find((member) => member.id === id)
                            ?.name ?? "Unknown artist",
                      )
                      .join(", ")}
                  </span>
                </div>
                <Button
                  onClick={() => setEditing(group)}
                  aria-label={`Edit ${group.name}`}>
                  Edit
                </Button>
              </div>
            ))}
          </div>
          {editing !== undefined && (
            <GroupEditor
              key={editing?.id ?? "new"}
              group={editing}
              data={data}
              onClose={() => setEditing(undefined)}
              onSaved={load}
            />
          )}
        </>
      )}
    </TitleCard>
  );
}
