import {
  Autocomplete,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";

import Header from "../../../components/Header";
import TimelineChart from "../../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import { useConditionalAPI } from "../../../services/hooks/hooks";
import {
  CompetitionMetric,
  cumulativeTimelinePoints,
  useListeningRequest,
} from "../../../services/listeningTimeline";
import { selectAccounts } from "../../../services/redux/modules/admin/selector";
import {
  selectRawIntervalDetail,
  selectUser,
} from "../../../services/redux/modules/user/selector";
import { Artist } from "../../../services/types";

import s from "./index.module.css";

const metrics: Record<CompetitionMetric, { name: string; unit: string }> = {
  hours: { name: "Listening time", unit: "h" },
  count: { name: "Song plays", unit: "plays" },
  differentTracks: { name: "Unique songs", unit: "songs" },
  differentArtists: { name: "Unique artists", unit: "artists" },
};

export default function Compete() {
  const user = useSelector(selectUser);
  const accounts = useSelector(selectAccounts);
  const { interval } = useSelector(selectRawIntervalDetail);
  // Undefined means the default (yourself), including while the user loads.
  const [selection, setSelection] = useState<string[]>();
  const currentUserId = user?._id;
  const userIds = useMemo(
    () => selection ?? (currentUserId ? [currentUserId] : []),
    [selection, currentUserId],
  );
  const participants = useMemo(() => {
    if (!user || accounts.some((account) => account.id === user._id))
      return accounts;
    return [{ id: user._id, username: user.username }, ...accounts];
  }, [accounts, user]);
  const [metric, setMetric] = useState<CompetitionMetric>("hours");
  const [artistSearch, setArtistSearch] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [artistResults] = useConditionalAPI(
    artistSearch.length >= 3,
    api.search,
    artistSearch,
  );
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const artistId = selectedArtist?.id;
  const request = useCallback(
    () =>
      userIds.length
        ? api.getCompetitionTimeline(
            userIds,
            new Date(start),
            new Date(end),
            metric,
            artistId,
          )
        : Promise.resolve({ data: null }),
    [userIds, start, end, metric, artistId],
  );
  const { data, error, retry } = useListeningRequest(request);
  const currentMetric = metrics[metric];
  const leaderboard = data?.series
    .map((item) => ({ ...item, total: item.values.at(-1) ?? 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const hasListens = data?.series.some((item) => (item.values.at(-1) ?? 0) > 0);

  return (
    <div>
      <Header
        title="Competition"
        subtitle="Watch your listening totals grow alongside your friends"
      />
      <div className={s.content}>
        <div className={s.sidebar}>
          <TitleCard title="Who's competing?">
            <div className={s.usersList}>
              {participants.map((account) => (
                <FormControlLabel
                  key={account.id}
                  label={`${account.username}${account.id === user?._id ? " (you)" : ""}`}
                  control={
                    <Checkbox
                      checked={userIds.includes(account.id)}
                      onChange={(_, checked) =>
                        setSelection(
                          checked
                            ? [...userIds, account.id]
                            : userIds.filter((id) => id !== account.id),
                        )
                      }
                    />
                  }
                />
              ))}
            </div>
          </TitleCard>
          <TitleCard title="Compare">
            <div className={s.controls}>
              <Select
                size="small"
                value={metric}
                inputProps={{ "aria-label": "Competition metric" }}
                onChange={(event) =>
                  setMetric(event.target.value as CompetitionMetric)
                }>
                {Object.entries(metrics).map(([key, value]) => (
                  <MenuItem key={key} value={key}>
                    {value.name}
                  </MenuItem>
                ))}
              </Select>
              <Autocomplete
                options={artistResults?.artists ?? []}
                getOptionLabel={(option) => option.name}
                onInputChange={(_, value) => setArtistSearch(value)}
                onChange={(_, value) => setSelectedArtist(value)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Filter by artist"
                    size="small"
                  />
                )}
                value={selectedArtist}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                noOptionsText={
                  artistSearch.length < 3
                    ? "Type 3 characters to search"
                    : "No artists found"
                }
              />
            </div>
          </TitleCard>
        </div>
        <TitleCard
          title={`${currentMetric.name}${selectedArtist ? ` · ${selectedArtist.name}` : ""}`}
          contentClassName={s.chartContent}>
          <p className={s.description}>
            Cumulative totals from the start of the selected period. Everyone
            starts at zero.
            {(metric === "differentTracks" || metric === "differentArtists") &&
              " Each song or artist counts once per person, even if played again."}
          </p>
          {!userIds.length ? (
            <p>Select at least one person to start comparing.</p>
          ) : error ? (
            <p>
              Could not load the comparison.{" "}
              <Button onClick={retry}>Retry</Button>
            </p>
          ) : !data ? (
            <CircularProgress aria-label="Loading comparison" />
          ) : !hasListens ? (
            <p>No listening history for these people and filters.</p>
          ) : (
            <>
              <TimelineChart
                height={360}
                bounds={data}
                data={cumulativeTimelinePoints(
                  data,
                  data.series.map((item) => item.values),
                )}
                series={data.series}
                unit={currentMetric.unit}
              />
              <ol className={s.leaderboard} aria-label="Competition standings">
                {leaderboard?.map((item) => (
                  <li key={item.id}>
                    <span>{item.name}</span>
                    <strong>
                      {item.total.toLocaleString(undefined, {
                        maximumFractionDigits: metric === "hours" ? 1 : 0,
                      })}{" "}
                      {currentMetric.unit}
                    </strong>
                  </li>
                ))}
              </ol>
            </>
          )}
        </TitleCard>
      </div>
    </div>
  );
}
