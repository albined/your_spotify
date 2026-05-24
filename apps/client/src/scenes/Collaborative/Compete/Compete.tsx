import {
  Autocomplete,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  LineChart,
  Line as RLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
} from "recharts";
import Header from "../../../components/Header";
import Text from "../../../components/Text";
import Tooltip from "../../../components/Tooltip";
import { api } from "../../../services/apis/api";
import { useAPI, useConditionalAPI } from "../../../services/hooks/hooks";
import { selectAccounts } from "../../../services/redux/modules/admin/selector";
import {
  selectRawIntervalDetail,
  selectUser,
} from "../../../services/redux/modules/user/selector";
import {
  buildFromDateId,
  buildXYDataObjSpread,
  formatXAxisDateTooltip,
  msToDuration,
  msToMinutes,
  useFormatXAxis,
} from "../../../services/stats";
import { Artist, DateId, Timesplit } from "../../../services/types";
import s from "./index.module.css";

const COLORS = [
  "#1DB954", // Spotify Green
  "#30A3F2", // Sky Blue
  "#E91E63", // Pink
  "#FF9800", // Orange
  "#9C27B0", // Purple
  "#00BCD4", // Cyan
  "#FFEB3B", // Yellow
  "#795548", // Brown
  "#607D8B", // Slate
];

export default function Compete() {
  const user = useSelector(selectUser);
  const accounts = useSelector(selectAccounts);
  const { interval } = useSelector(selectRawIntervalDetail);

  // Users checklist
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    () => new Set(user ? [user._id] : []),
  );

  // Settings
  const [metric, setMetric] = useState<
    "durationMs" | "count" | "differentTracks" | "differentArtists"
  >("durationMs");
  const [isCumulative, setIsCumulative] = useState(true);
  const [timeSplit, setTimeSplit] = useState<Timesplit | "auto">("auto");

  // Artist search and filter
  const [artistSearch, setArtistSearch] = useState("");
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);

  const [artistResults] = useConditionalAPI(
    artistSearch.length >= 3,
    api.search,
    artistSearch,
  );

  const userIds = useMemo(() => Array.from(selectedUserIds), [selectedUserIds]);

  const activeTimeSplit = timeSplit === "auto" ? interval.timesplit : timeSplit;

  // Fetch listening data for all selected users
  const result = useAPI(
    api.competeTimePer,
    userIds,
    interval.start,
    interval.end,
    activeTimeSplit,
    selectedArtist?.id,
  );

  const toggleUser = (uId: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(uId)) {
        next.delete(uId);
      } else {
        next.add(uId);
      }
      return next;
    });
  };

  const transformedData = useMemo(() => {
    if (!result || !user || userIds.length === 0) return [];

    // Group items by DateKey
    const groupedByDate: Record<string, Record<string, (typeof result)[0]>> = {};
    result.forEach(item => {
      if (!item._id) return;
      const dateKey = `${item._id.year}-${item._id.month ?? 1}-${item._id.day ?? 1}-${item._id.hour ?? 0}`;
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = {};
      }
      groupedByDate[dateKey][item.owner] = item;
    });

    // Extract unique dates from the result
    const uniqueDates = Array.from(
      new Set(
        result
          .filter(r => r._id)
          .map(r =>
            JSON.stringify({
              year: r._id!.year,
              month: r._id!.month,
              day: r._id!.day,
              hour: r._id!.hour,
            }),
          ),
      ),
    );

    const dateObjList = uniqueDates.map(str => {
      const dateId = JSON.parse(str) as DateId;
      const dateKey = `${dateId.year}-${dateId.month ?? 1}-${dateId.day ?? 1}-${dateId.hour ?? 0}`;
      const ownersData = groupedByDate[dateKey] || {};
      const item: any = { _id: dateId };

      userIds.forEach(uId => {
        const userData = ownersData[uId];
        item[`durationMs_${uId}`] = userData ? userData.durationMs : 0;
        item[`count_${uId}`] = userData ? userData.count : 0;
        item[`differentTracks_${uId}`] = userData ? userData.differentTracks : 0;
        item[`differentArtists_${uId}`] = userData ? userData.differentArtists : 0;
      });
      return item;
    });

    // Sort chronologically
    dateObjList.sort(
      (a, b) => buildFromDateId(a._id).getTime() - buildFromDateId(b._id).getTime(),
    );

    const keys = userIds.flatMap(uId => [
      `durationMs_${uId}`,
      `count_${uId}`,
      `differentTracks_${uId}`,
      `differentArtists_${uId}`,
    ]);

    const filledData = buildXYDataObjSpread(
      dateObjList,
      keys,
      interval.start,
      interval.end,
      false,
    );

    // Apply cumulative mapping if selected (only valid for durationMs and count)
    const isCumulativeActive =
      isCumulative && (metric === "durationMs" || metric === "count");
    if (isCumulativeActive) {
      const currentSums: Record<string, number> = {};
      userIds.forEach(uId => {
        currentSums[`durationMs_${uId}`] = 0;
        currentSums[`count_${uId}`] = 0;
      });

      filledData.forEach(point => {
        userIds.forEach(uId => {
          const currentDuration = currentSums[`durationMs_${uId}`] ?? 0;
          const currentCount = currentSums[`count_${uId}`] ?? 0;

          const nextDuration = currentDuration + ((point[`durationMs_${uId}`] as number) || 0);
          const nextCount = currentCount + ((point[`count_${uId}`] as number) || 0);

          currentSums[`durationMs_${uId}`] = nextDuration;
          currentSums[`count_${uId}`] = nextCount;

          point[`durationMs_${uId}`] = nextDuration;
          point[`count_${uId}`] = nextCount;
        });
      });
    }

    return filledData;
  }, [result, user, userIds, interval, isCumulative, metric]);

  const accountsDict = useMemo(() => {
    return accounts.reduce<Record<string, (typeof accounts)[0]>>((acc, curr) => {
      acc[curr.id] = curr;
      return acc;
    }, {});
  }, [accounts]);

  const formatX = useFormatXAxis(transformedData);

  const formatY = (val: number) => {
    if (metric === "durationMs") {
      return `${msToMinutes(val)}m`;
    }
    return val.toString();
  };

  const currentMetricKey = `${metric}_`;

  const isCumulativeDisabled =
    metric === "differentTracks" || metric === "differentArtists";

  return (
    <div className={s.root}>
      <Header
        title="Competition"
        subtitle="Compare listening habits and compete with others on YourSpotify"
      />

      <div className={s.content}>
        <div className={s.sidebar}>
          <div className={s.sidebarSection}>
            <Text element="h2" size="big">
              Select Users
            </Text>
            <div className={s.usersList}>
              {accounts.map(account => (
                <button
                  type="button"
                  key={account.id}
                  className={s.userRow}
                  onClick={() => toggleUser(account.id)}>
                  <Text size="normal">{account.username}</Text>
                  <Checkbox
                    checked={selectedUserIds.has(account.id)}
                    disableRipple
                  />
                </button>
              ))}
            </div>
          </div>

          <div className={s.sidebarSection}>
            <Text element="h2" size="big">
              Controls
            </Text>
            <div className={s.controls}>
              <Select
                variant="standard"
                value={metric}
                fullWidth
                onChange={ev =>
                  setMetric(
                    ev.target.value as
                      | "durationMs"
                      | "count"
                      | "differentTracks"
                      | "differentArtists",
                  )
                }>
                <MenuItem value="durationMs">Time listened</MenuItem>
                <MenuItem value="count">Song play count</MenuItem>
                <MenuItem value="differentTracks">Different songs played</MenuItem>
                <MenuItem value="differentArtists">Artist diversity</MenuItem>
              </Select>

              <Select
                variant="standard"
                value={timeSplit}
                fullWidth
                style={{ marginTop: 8 }}
                onChange={ev =>
                  setTimeSplit(ev.target.value as Timesplit | "auto")
                }>
                <MenuItem value="auto">Resolution: Auto</MenuItem>
                <MenuItem value="hour">Resolution: Hour</MenuItem>
                <MenuItem value="day">Resolution: Day</MenuItem>
                <MenuItem value="week">Resolution: Week</MenuItem>
                <MenuItem value="month">Resolution: Month</MenuItem>
                <MenuItem value="year">Resolution: Year</MenuItem>
              </Select>

              <FormControlLabel
                control={
                  <Switch
                    checked={isCumulative && !isCumulativeDisabled}
                    disabled={isCumulativeDisabled}
                    onChange={ev => setIsCumulative(ev.target.checked)}
                  />
                }
                label="Cumulative curves"
              />

              <Autocomplete
                options={artistResults?.artists || []}
                getOptionLabel={option => option.name}
                onInputChange={(_, val) => setArtistSearch(val)}
                onChange={(_, val) => setSelectedArtist(val)}
                renderInput={params => (
                  <TextField
                    {...params}
                    label="Filter by Artist"
                    variant="standard"
                  />
                )}
                value={selectedArtist}
                isOptionEqualToValue={(option, val) => option.id === val.id}
                noOptionsText={
                  artistSearch.length < 3
                    ? "Type 3 characters to search..."
                    : "No artists found"
                }
              />

              {selectedArtist && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    setSelectedArtist(null);
                    setArtistSearch("");
                  }}>
                  Clear Artist Filter
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className={s.chartContainer}>
          <div className={s.chartHeader}>
            <Text element="h3" size="big">
              {metric === "durationMs" && "Listening Duration"}
              {metric === "count" && "Play Count"}
              {metric === "differentTracks" && "Unique Songs"}
              {metric === "differentArtists" && "Unique Artists"}
              {selectedArtist && ` for ${selectedArtist.name}`}
            </Text>
          </div>

          {result === null ? (
            <div className={s.loading}>
              <CircularProgress size={24} />
              <Text size="normal">Loading comparison data...</Text>
            </div>
          ) : transformedData.length === 0 ? (
            <div className={s.loading}>
              <Text size="normal">No data available for the selected range.</Text>
            </div>
          ) : (
            <div className={s.chartWrapper}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={transformedData}>
                  <XAxis
                    name="X"
                    domain={["dataMin", "dataMax"]}
                    dataKey="x"
                    tickFormatter={formatX}
                    style={{ fontWeight: "bold" }}
                  />
                  <YAxis
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={formatY}
                    width="auto"
                  />
                  <RTooltip
                    wrapperStyle={{ zIndex: 10 }}
                    contentStyle={{ backgroundColor: "var(--background)" }}
                    labelStyle={{ color: "var(--text-on-light)" }}
                    content={
                      <Tooltip
                        title={formatXAxisDateTooltip}
                        value={(payloadItem, val, root) => {
                          const color = root.color;
                          const name = root.name;
                          let formattedValue = "";
                          if (metric === "durationMs") {
                            formattedValue = msToDuration(val);
                          } else if (metric === "count") {
                            formattedValue = `${val} plays`;
                          } else if (metric === "differentTracks") {
                            formattedValue = `${val} unique songs`;
                          } else {
                            formattedValue = `${val} unique artists`;
                          }
                          return (
                            <span style={{ color }}>
                              {name}: {formattedValue}
                            </span>
                          );
                        }}
                      />
                    }
                  />
                  {userIds.map((uId, index) => {
                    const account = accountsDict[uId];
                    if (!account) return null;
                    return (
                      <RLine
                        key={uId}
                        connectNulls
                        type="monotone"
                        dataKey={`${currentMetricKey}${uId}`}
                        name={account.username}
                        stroke={COLORS[index % COLORS.length]}
                        strokeWidth={2.5}
                        dot={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
