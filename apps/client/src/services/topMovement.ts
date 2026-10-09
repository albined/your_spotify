import { useCallback, useMemo } from "react";
import { useSelector } from "react-redux";

import { api } from "./apis/api";
import { useListeningRequest } from "./hooks/hooks";
import { TopTimelineKind } from "./listeningTimeline";
import { selectRawIntervalDetail } from "./redux/modules/user/selector";

export interface RankChange {
  change: number | null;
  since: Date;
}

export function useTopMovement(kind: TopTimelineKind) {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getTopMovement(kind, new Date(start), new Date(end)),
    [kind, start, end],
  );
  const { data } = useListeningRequest(request);
  return useMemo(() => {
    const movement = new Map<string, RankChange>();
    if (!data?.since) return movement;
    const since = new Date(data.since);
    for (const item of data.items) {
      movement.set(item.id, { change: item.change, since });
    }
    return movement;
  }, [data]);
}
