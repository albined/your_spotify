import { ExpandMore } from "@mui/icons-material";
import { Tooltip } from "@mui/material";
import { useState } from "react";
import { useSelector } from "react-redux";

import { selectUser } from "../../services/redux/modules/user/selector";
import {
  artistColor,
  ListeningSession,
  sessionArtwork,
  sessionArtistBlocks,
  sessionSections,
} from "../../services/sessionBars";
import { msToDuration } from "../../services/stats";
import InlineArtist from "../InlineArtist";
import InlineTrack from "../InlineTrack";
import { usePlotWidth } from "../ListeningPatterns/shared";

import s from "./index.module.css";

export default function LongestSession({
  session,
  timeline,
  maximum,
  rank,
}: {
  session: ListeningSession;
  timeline: ReturnType<typeof sessionSections>;
  maximum: number;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(0);
  const { ref, width } = usePlotWidth();
  const user = useSelector(selectUser);
  const locale =
    user?.settings.dateFormat === "default"
      ? undefined
      : user?.settings.dateFormat;
  const timeZone = user?.statisticsTimezone;
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const artists = new Map(session.artists.map((artist) => [artist.id, artist]));
  const blocks = sessionArtistBlocks(timeline);
  const artwork = sessionArtwork(blocks, timeline.listened, width);
  const tracks = session.distanceToLast.distance
    .map((row) => row.info)
    .sort((a, b) => Date.parse(a.played_at) - Date.parse(b.played_at));
  const detailsId = `session-${timeline.start}`;
  return (
    <article className={s.session}>
      <button
        type="button"
        className={s.heading}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={detailsId}>
        <span className={s.date}>
          <span className={s.rank}>#{rank}</span>
          {date.formatRange(timeline.start, timeline.end)}
        </span>
        <span className={s.stats}>
          <strong>{msToDuration(timeline.listened)}</strong>
          <span>{tracks.length} songs</span>
          <ExpandMore
            fontSize="small"
            sx={{ transform: expanded ? "rotate(180deg)" : undefined }}
          />
        </span>
      </button>
      <div
        className={s.bar}
        ref={ref}
        role="group"
        aria-label={`Session ${rank} artist mix`}
        style={{ width: `${(100 * timeline.listened) / maximum}%` }}>
        {blocks.map((section, index) => {
          const artist = artists.get(section.artist);
          const label = `${artist?.name ?? "Unknown artist"} · ${msToDuration(section.end - section.start)} · ${section.songs} songs`;
          const image = artist?.images.at(-1)?.url;
          return (
            <Tooltip title={label} key={index} arrow enterTouchDelay={0}>
              <button
                type="button"
                className={s.section}
                aria-label={label}
                tabIndex={index === focused ? 0 : -1}
                onFocus={() => setFocused(index)}
                onKeyDown={(event) => {
                  const next =
                    index +
                    (event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowLeft"
                        ? -1
                        : 0);
                  if (next === index) return;
                  event.preventDefault();
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>("button")
                    [next]?.focus();
                }}
                style={{
                  left: `${(100 * section.start) / timeline.listened}%`,
                  width: `${(100 * (section.end - section.start)) / timeline.listened}%`,
                  background: artistColor(section.artist),
                }}>
                {image && artwork.has(index) && (
                  <img src={image} alt="" loading="lazy" />
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
      {expanded && (
        <ol id={detailsId} className={s.tracks}>
          {tracks.map((track) => {
            const artist = artists.get(track.primaryArtistId);
            const fullTrack = session.full_tracks[track.id];
            return (
              <li key={track._id}>
                {fullTrack ? (
                  <InlineTrack track={fullTrack} size="normal" />
                ) : (
                  <span>Unknown song</span>
                )}
                {artist && <InlineArtist artist={artist} size="small" />}
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
