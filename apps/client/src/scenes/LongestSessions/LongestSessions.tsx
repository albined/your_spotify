import { useCallback } from "react";
import { useSelector } from "react-redux";

import Header from "../../components/Header";
import { RequestState } from "../../components/ListeningPatterns/shared";
import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import { useListeningRequest } from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import { sessionSections } from "../../services/sessionBars";
import LongestSession from "./LongestSession/LongestSession";

import s from "./index.module.css";

export default function LongestSessions() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(
    () => api.getLongestSessions(new Date(start), new Date(end)),
    [start, end],
  );
  const { data, error, retry } = useListeningRequest(request);
  const sessions = (data ?? [])
    .map((session) => ({
      session,
      timeline: sessionSections(
        session.distanceToLast.distance.map((row) => row.info),
      ),
    }))
    .filter((row) => row.timeline.duration > 0)
    .sort(
      (a, b) =>
        b.timeline.duration - a.timeline.duration ||
        a.timeline.start - b.timeline.start,
    );
  const maximum = Math.max(1, ...sessions.map((row) => row.timeline.duration));

  return (
    <div>
      <Header title="Longest sessions" subtitle="" />
      <div className={s.content}>
        <TitleCard title="Longest sessions">
          {!data ? (
            <RequestState error={error} retry={retry} />
          ) : !sessions.length ? (
            <p>No sessions in this period.</p>
          ) : (
            <div className={s.sessions}>
              {sessions.map(({ session, timeline }, index) => (
                <LongestSession
                  key={timeline.start}
                  session={session}
                  timeline={timeline}
                  maximum={maximum}
                  rank={index + 1}
                />
              ))}
            </div>
          )}
        </TitleCard>
      </div>
    </div>
  );
}
