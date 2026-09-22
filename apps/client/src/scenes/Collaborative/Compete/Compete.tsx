import {
  Autocomplete,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
} from "@mui/material";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";

import Header from "../../../components/Header";
import TimelineChart from "../../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import {
  cumulativeTimelinePoints,
  useListeningRequest,
} from "../../../services/listeningTimeline";
import { selectAccounts } from "../../../services/redux/modules/admin/selector";
import {
  selectRawIntervalDetail,
  selectUser,
} from "../../../services/redux/modules/user/selector";

import s from "./index.module.css";

interface ComparisonProps {
  userIds: string[];
  start: number;
  end: number;
}

function CompetitionRace({
  userIds,
  start,
  end,
  artistId,
}: ComparisonProps & { artistId?: string }) {
  const request = useCallback(
    () =>
      userIds.length
        ? api.getCompetitionTimeline(
            userIds,
            new Date(start),
            new Date(end),
            "hours",
            artistId,
          )
        : Promise.resolve({ data: null }),
    [userIds, start, end, artistId],
  );
  const { data, error, retry } = useListeningRequest(request);
  if (!userIds.length)
    return <p>Select at least one person to start comparing.</p>;
  if (error)
    return (
      <p>
        Could not load the comparison. <Button onClick={retry}>Retry</Button>
      </p>
    );
  if (!data)
    return <CircularProgress size={24} aria-label="Loading comparison" />;
  if (!data.series.some((item) => (item.values.at(-1) ?? 0) > 0)) {
    return <p>No listening history in this period.</p>;
  }
  const leaderboard = data.series
    .map((item) => ({ ...item, total: item.values.at(-1) ?? 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return (
    <>
      <TimelineChart
        height={360}
        bounds={data}
        data={cumulativeTimelinePoints(
          data,
          data.series.map((item) => item.values),
        )}
        series={data.series}
        unit="h"
      />
      <ol
        className={s.leaderboard}
        aria-label={
          artistId
            ? "Artist competition standings"
            : "Overall competition standings"
        }>
        {leaderboard.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <strong>
              {item.total.toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })}{" "}
              h
            </strong>
          </li>
        ))}
      </ol>
    </>
  );
}

function ArtistCompetition({ userIds, start, end }: ComparisonProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const request = useCallback(
    () =>
      userIds.length
        ? api.getCompetitionArtists(userIds, new Date(start), new Date(end))
        : Promise.resolve({ data: [] }),
    [userIds, start, end],
  );
  const { data: artists, error, retry } = useListeningRequest(request);
  const selected =
    artists?.find((artist) => artist.id === selectedId) ?? artists?.[0];
  return (
    <TitleCard title="Artist competition" contentClassName={s.chartContent}>
      {!userIds.length ? (
        <p>Select at least one person to start comparing.</p>
      ) : error ? (
        <p>
          Could not load artists. <Button onClick={retry}>Retry</Button>
        </p>
      ) : !artists ? (
        <CircularProgress size={24} aria-label="Loading competition artists" />
      ) : !selected ? (
        <p>No artist listening history in this period.</p>
      ) : (
        <>
          <Autocomplete
            className={s.artistSelector}
            options={artists}
            value={selected}
            disableClearable
            getOptionLabel={(option) => option.name}
            getOptionKey={(option) => option.id}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onChange={(_, value) => setSelectedId(value.id)}
            renderOption={(props, artist) => {
              const { key, ...rest } = props;
              return (
                <li
                  key={key}
                  {...rest}
                  className={clsx(rest.className, s.artistOption)}>
                  {artist.image && (
                    <img src={artist.image} alt="" loading="lazy" />
                  )}
                  <span>{artist.name}</span>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField {...params} label="Artist" size="small" />
            )}
            noOptionsText="No matching artists"
          />
          <CompetitionRace
            userIds={userIds}
            start={start}
            end={end}
            artistId={selected.id}
          />
        </>
      )}
    </TitleCard>
  );
}

export default function Compete() {
  const user = useSelector(selectUser);
  const accounts = useSelector(selectAccounts);
  const { interval } = useSelector(selectRawIntervalDetail);
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
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  // New people or dates get a fresh ranking and the strongest shared artist.
  const artistScope = JSON.stringify([start, end, [...userIds].sort()]);

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
                  label={
                    account.username +
                    (account.id === user?._id ? " (you)" : "")
                  }
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
        </div>
        <div className={s.races}>
          <TitleCard title="Listening time" contentClassName={s.chartContent}>
            <CompetitionRace userIds={userIds} start={start} end={end} />
          </TitleCard>
          <ArtistCompetition
            key={artistScope}
            userIds={userIds}
            start={start}
            end={end}
          />
        </div>
      </div>
    </div>
  );
}
