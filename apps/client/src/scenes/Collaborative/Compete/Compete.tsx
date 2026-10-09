import {
  Autocomplete,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";

import Header from "../../../components/Header";
import { RequestState } from "../../../components/ListeningPatterns/shared";
import TimelineChart from "../../../components/ListeningTimeline/TimelineChart";
import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import { useListeningRequest } from "../../../services/hooks/hooks";
import {
  cumulativeTimelinePoints,
  TopTimelineKind,
} from "../../../services/listeningTimeline";
import {
  selectRawIntervalDetail,
  selectUser,
} from "../../../services/redux/modules/user/selector";
import {
  overlapKinds,
  TasteOverlap as TasteOverlapData,
  widestRegion,
} from "../../../services/tasteOverlap";
import CompetitionInsights from "./CompetitionInsights";
import TasteOverlap from "./TasteOverlap";

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
  kind,
  itemId,
}: ComparisonProps & { kind?: TopTimelineKind; itemId?: string }) {
  const request = useCallback(
    () =>
      userIds.length
        ? api.getCompetitionTimeline(
            userIds,
            new Date(start),
            new Date(end),
            "hours",
            kind && itemId ? { kind, id: itemId } : undefined,
          )
        : Promise.resolve({ data: null }),
    [userIds, start, end, kind, itemId],
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
        phoneHeight={220}
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
          itemId
            ? `${overlapKinds.find((item) => item.kind === kind)?.one} competition standings`
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

// What the selected people share, and a race for the one thing picked from it.
function ItemCompetition({
  userIds,
  start,
  end,
  kind,
  setKind,
}: ComparisonProps & {
  kind: TopTimelineKind;
  setKind: (kind: TopTimelineKind) => void;
}) {
  const [picked, setPicked] = useState<{ kind: TopTimelineKind; id: string }>();
  const request = useCallback(
    () =>
      userIds.length
        ? api.getTasteOverlap(userIds, new Date(start), new Date(end), kind)
        : Promise.resolve({ data: null }),
    [userIds, start, end, kind],
  );
  const { data, error, retry } = useListeningRequest(request);
  // Another kind is asked for while the one on screen stays, so the card
  // keeps its height.
  const [shown, setShown] = useState<{
    kind: TopTimelineKind;
    data: TasteOverlapData;
  }>();
  if (data && shown?.data !== data) setShown({ kind, data });
  const regions = shown?.data.regions;
  // A region can list something that did not make the most shared ones.
  const picks = [
    ...(shown?.data.items ?? []),
    ...(regions?.flatMap((region) => region.items) ?? []),
  ];
  const selected =
    (picked?.kind === shown?.kind &&
      picks.find((item) => item.id === picked?.id)) ||
    // The race starts with the top of the list the diagram opens on.
    (regions && regions[widestRegion(regions)]?.items[0]) ||
    picks[0];
  const options = shown?.data.items ?? [];
  const label = overlapKinds.find((item) => item.kind === shown?.kind)?.one;
  return (
    <TitleCard
      title={
        regions
          ? "Taste overlap"
          : `${overlapKinds.find((item) => item.kind === kind)?.one} competition`
      }
      right={
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kind}
          aria-label="Compare by"
          onChange={(_, value: TopTimelineKind | null) => {
            if (value !== null) setKind(value);
          }}>
          {overlapKinds.map((item) => (
            <ToggleButton key={item.kind} value={item.kind}>
              {item.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      }
      contentClassName={s.chartContent}>
      {!userIds.length ? (
        <p>Select at least one person to start comparing.</p>
      ) : error || !shown ? (
        <RequestState error={error} retry={retry} />
      ) : !selected ? (
        <p>No listening history in this period.</p>
      ) : (
        <>
          {regions && (
            <TasteOverlap
              people={shown.data.people}
              regions={regions}
              round={shown.kind === "artists"}
              pickedId={selected.id}
              pick={(id) => setPicked({ kind: shown.kind, id })}
            />
          )}
          <Autocomplete
            className={s.itemSelector}
            options={
              options.some((item) => item.id === selected.id)
                ? options
                : [selected, ...options]
            }
            value={selected}
            disableClearable
            getOptionLabel={(option) => option.name}
            getOptionKey={(option) => option.id}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            onChange={(_, value) =>
              setPicked({ kind: shown.kind, id: value.id })
            }
            renderOption={(props, item) => {
              const { key, ...rest } = props;
              return (
                <li
                  key={key}
                  {...rest}
                  className={clsx(rest.className, s.itemOption)}>
                  {item.image && <img src={item.image} alt="" loading="lazy" />}
                  <span>
                    {item.name}
                    {item.subtitle && <small>{item.subtitle}</small>}
                  </span>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField {...params} label={label} size="small" />
            )}
            noOptionsText="No matches"
          />
          <CompetitionRace
            userIds={userIds}
            start={start}
            end={end}
            kind={shown.kind}
            itemId={selected.id}
          />
        </>
      )}
    </TitleCard>
  );
}

export default function Compete() {
  const user = useSelector(selectUser);
  const participantsRequest = useCallback(
    () => api.getCompetitionParticipants(),
    [],
  );
  const {
    data: participants,
    error: participantsError,
    retry: refreshParticipants,
  } = useListeningRequest(participantsRequest);
  const { interval } = useSelector(selectRawIntervalDetail);
  const [selection, setSelection] = useState<string[]>();
  const [kind, setKind] = useState<TopTimelineKind>("artists");
  const currentUserId = user?._id;
  const selectedIds = (selection ?? (currentUserId ? [currentUserId] : []))
    .filter((id) => participants?.some((person) => person.id === id))
    .join(",");
  // The same people on a refreshed list must not restart every comparison.
  const userIds = useMemo(
    () => (selectedIds ? selectedIds.split(",") : []),
    [selectedIds],
  );
  useEffect(() => {
    window.addEventListener("focus", refreshParticipants);
    return () => window.removeEventListener("focus", refreshParticipants);
  }, [refreshParticipants]);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  // New people or dates get a fresh ranking and the most shared pick.
  const scope = JSON.stringify([start, end, [...userIds].sort()]);

  return (
    <div>
      <Header title="Competition" subtitle="" />
      <div className={s.content}>
        <div className={s.sidebar}>
          <TitleCard title="Who's competing?">
            <div className={s.usersList}>
              {!participants ? (
                <RequestState
                  error={participantsError}
                  retry={refreshParticipants}
                />
              ) : !participants.length ? (
                <p>No participants available.</p>
              ) : (
                participants.map((account) => (
                  <FormControlLabel
                    key={account.id}
                    label={
                      account.name + (account.id === user?._id ? " (you)" : "")
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
                ))
              )}
            </div>
          </TitleCard>
        </div>
        <div className={s.races}>
          <TitleCard title="Listening time" contentClassName={s.chartContent}>
            <CompetitionRace userIds={userIds} start={start} end={end} />
          </TitleCard>
          <ItemCompetition
            key={scope}
            userIds={userIds}
            start={start}
            end={end}
            kind={kind}
            setKind={setKind}
          />
          <CompetitionInsights userIds={userIds} start={start} end={end} />
        </div>
      </div>
    </div>
  );
}
