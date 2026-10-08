import { Skeleton } from "@mui/material";
import { useSelector } from "react-redux";

import { api } from "../../../services/apis/api";
import { useAPI } from "../../../services/hooks/hooks";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import {
  getLastPeriod,
  getPercentMore,
  msToCompactDuration,
  msToMinutes,
} from "../../../services/stats";
import { Timesplit } from "../../../services/types";
import Text from "../../Text";
import TitleCard from "../../TitleCard";
import ListeningChange from "../ListeningChange";
import { ImplementedCardProps } from "../types";

import s from "../index.module.css";

interface TimeListenedProps extends ImplementedCardProps {}

export default function TimeListened({ className }: TimeListenedProps) {
  const { interval, unit } = useSelector(selectRawIntervalDetail);
  const result = useAPI(
    api.timePer,
    interval.start,
    interval.end,
    Timesplit.all,
  );
  const lastPeriod = getLastPeriod(interval.start, interval.end);
  const resultOld = useAPI(
    api.timePer,
    lastPeriod.start,
    lastPeriod.end,
    Timesplit.all,
  );

  if (!result || !resultOld) {
    return (
      <TitleCard title="Time" className={className}>
        <div className={s.root}>
          <Text size="normal">
            <Skeleton width={50} />
          </Text>
          <Skeleton className={s.loadingDelta} />
        </div>
      </TitleCard>
    );
  }

  const count = result[0]?.count ?? 0;
  const oldCount = resultOld[0]?.count ?? 0;

  const percentMore = getPercentMore(oldCount, count);

  return (
    <TitleCard title="Time" className={className} fade>
      <div className={s.root}>
        <Text element="span" size="huge" className={s.value}>
          <span className={s.wide}>{msToMinutes(count)} minutes</span>
          <span className={s.narrow}>{msToCompactDuration(count)}</span>
        </Text>
        <ListeningChange percent={percentMore} unit={unit} />
      </div>
    </TitleCard>
  );
}
