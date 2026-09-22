import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import Header from "../../components/Header";
import { RequestState } from "../../components/ListeningPatterns/shared";
import LoadingButton from "../../components/LoadingButton";
import TitleCard from "../../components/TitleCard";
import { api } from "../../services/apis/api";
import {
  selectRawIntervalDetail,
  selectUser,
} from "../../services/redux/modules/user/selector";
import { ListeningSession, sessionSections } from "../../services/sessionBars";
import LongestSession from "./LongestSession/LongestSession";

import s from "./index.module.css";

const PAGE_SIZE = 5;

function SessionList({ start, end }: { start: number; end: number }) {
  const [page, setPage] = useState({ offset: 0, attempt: 0 });
  const [state, setState] = useState<{
    data?: ListeningSession[];
    page?: typeof page;
    hasMore: boolean;
    error: boolean;
  }>({ hasMore: false, error: false });
  const { data, hasMore, error } = state;
  const loading = state.page !== page;

  useEffect(() => {
    let active = true;
    // One extra result tells us whether another page exists.
    api
      .getLongestSessions(
        new Date(start),
        new Date(end),
        page.offset,
        PAGE_SIZE + 1,
      )
      .then(
        ({ data: batch }) => {
          if (!active) return;
          setState((previous) => ({
            data: [
              ...(previous.data ?? []).slice(0, page.offset),
              ...batch.slice(0, PAGE_SIZE),
            ],
            page,
            hasMore: batch.length > PAGE_SIZE,
            error: false,
          }));
        },
        () => {
          if (active) {
            setState((previous) => ({ ...previous, page, error: true }));
          }
        },
      );
    return () => {
      active = false;
    };
  }, [start, end, page]);

  const loadMore = () =>
    setPage({ offset: data?.length ?? 0, attempt: page.attempt + 1 });
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

  if (!data) return <RequestState error={error && !loading} retry={loadMore} />;
  if (!sessions.length) return <p>No sessions in this period.</p>;
  return (
    <>
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
      {hasMore && (
        <div className={s.more}>
          {error && !loading && (
            <span role="alert">Could not load more sessions.</span>
          )}
          <LoadingButton loading={loading} onClick={loadMore}>
            {error && !loading ? "Retry" : "Load 5 more"}
          </LoadingButton>
        </div>
      )}
    </>
  );
}

export default function LongestSessions() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const user = useSelector(selectUser);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  return (
    <div>
      <Header title="Longest sessions" subtitle="" />
      <div className={s.content}>
        <TitleCard title="Longest sessions">
          <SessionList
            key={`${user?._id}:${start}:${end}`}
            start={start}
            end={end}
          />
        </TitleCard>
      </div>
    </div>
  );
}
