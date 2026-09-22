import { Button, Skeleton } from "@mui/material";
import clsx from "clsx";
import { useCallback } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import { api } from "../../services/apis/api";
import { useListeningRequest } from "../../services/listeningTimeline";
import { selectRawIntervalDetail } from "../../services/redux/modules/user/selector";
import { msToMinutes } from "../../services/stats";
import { getImage } from "../../services/tools";
import TitleCard from "../TitleCard";
import { ImplementedCardProps } from "./types";

import s from "./bestListening.module.css";

export default function BestListeningCard({
  kind,
  className,
}: ImplementedCardProps & { kind: "artist" | "song" }) {
  const { interval } = useSelector(selectRawIntervalDetail);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const request = useCallback(async () => {
    if (kind === "artist") {
      const { data } = await api.getBestArtists(
        new Date(start),
        new Date(end),
        3,
        0,
      );
      return {
        data: data.map((item) => ({
          id: item.artist.id,
          name: item.artist.name,
          image: getImage(item.artist),
          count: item.count,
          minutes: msToMinutes(item.duration_ms),
          detail: `${item.differents.toLocaleString()} different songs`,
        })),
      };
    }
    const { data } = await api.getBestSongs(
      new Date(start),
      new Date(end),
      3,
      0,
    );
    return {
      data: data.map((item) => ({
        id: item.track.id,
        name: item.track.name,
        image: getImage(item.album),
        count: item.count,
        minutes: msToMinutes(item.duration_ms),
        detail: "",
      })),
    };
  }, [start, end, kind]);
  const { data, error, retry } = useListeningRequest(request);
  const winner = data?.[0];
  const runners = data?.slice(1, 3) ?? [];
  const countLabel = (count: number) =>
    kind === "artist"
      ? count === 1
        ? "song"
        : "songs"
      : count === 1
        ? "play"
        : "plays";
  return (
    <TitleCard
      title={kind === "artist" ? "Best artist" : "Best song"}
      className={clsx(s.root, className)}
      contentClassName={s.content}>
      {error ? (
        <div className={s.empty}>
          Could not load rankings. <Button onClick={retry}>Retry</Button>
        </div>
      ) : !data ? (
        <div className={s.layout} aria-label="Loading rankings">
          <div className={s.winner}>
            <Skeleton variant="rounded" className={s.cover} />
            <div className={s.winnerDetails}>
              <Skeleton width="85%" />
              <Skeleton width="65%" />
              <Skeleton width="55%" />
            </div>
          </div>
          <div className={s.runners}>
            {[2, 3].map((rank) => (
              <Skeleton key={rank} variant="rounded" height={54} />
            ))}
          </div>
        </div>
      ) : !winner ? (
        <div className={s.empty}>No listening history in this period.</div>
      ) : (
        <div className={s.layout}>
          <Link
            className={s.winner}
            to={`/${kind}/${winner.id}`}
            title={winner.name}>
            <img className={s.cover} src={winner.image} alt="" />
            <div className={s.winnerDetails}>
              <strong className={s.winnerName}>{winner.name}</strong>
              <div className={s.winnerStats}>
                <span>
                  <strong>{winner.count.toLocaleString()}</strong>{" "}
                  {countLabel(winner.count)}
                </span>
                <span>
                  <strong>{winner.minutes.toLocaleString()}</strong>{" "}
                  {winner.minutes === 1 ? "minute" : "minutes"}
                </span>
                {winner.detail && (
                  <span className={s.detail}>{winner.detail}</span>
                )}
              </div>
            </div>
          </Link>
          {runners.length > 0 && (
            <div className={s.runners}>
              {runners.map((item, index) => (
                <Link
                  key={item.id}
                  to={`/${kind}/${item.id}`}
                  className={s.runner}
                  title={item.name}
                  aria-label={`${index + 2}. ${item.name}, ${item.count.toLocaleString()} ${countLabel(item.count)}, ${item.minutes.toLocaleString()} minutes`}>
                  <div className={s.thumbnail}>
                    <img src={item.image} alt="" loading="lazy" />
                    <span className={s.rank} aria-hidden="true">
                      {index + 2}
                    </span>
                  </div>
                  <div className={s.runnerDetails}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.count.toLocaleString()} {countLabel(item.count)}
                    </span>
                    <span>
                      {item.minutes.toLocaleString()}{" "}
                      {item.minutes === 1 ? "minute" : "minutes"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </TitleCard>
  );
}
