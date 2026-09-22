import { createContext, ReactNode, useCallback, useContext } from "react";
import { useSelector } from "react-redux";

import { api } from "../../services/apis/api";
import {
  ListeningOverview,
  OverviewPeriod,
} from "../../services/listeningOverview";
import { useListeningRequest } from "../../services/listeningTimeline";
import {
  selectRawIntervalDetail,
  selectUser,
} from "../../services/redux/modules/user/selector";

const Context = createContext<{
  data?: ListeningOverview;
  error?: boolean;
  retry: () => void;
} | null>(null);

export function useOverviewSelection() {
  const { interval, name } = useSelector(selectRawIntervalDetail);
  const user = useSelector(selectUser);
  return {
    user,
    start: interval.start.getTime(),
    end: interval.end.getTime(),
    period: name as OverviewPeriod,
  };
}

export function ListeningOverviewProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { start, end, period, user } = useOverviewSelection();
  const request = useCallback(async () => {
    if (!user) throw new Error("No account selected");
    return api.getListeningOverview(new Date(start), new Date(end), period);
  }, [start, end, period, user]);
  const result = useListeningRequest(request);
  return <Context.Provider value={result}>{children}</Context.Provider>;
}

export function useListeningOverview() {
  const result = useContext(Context);
  if (!result)
    throw new Error("Listening charts require ListeningOverviewProvider");
  return result;
}
