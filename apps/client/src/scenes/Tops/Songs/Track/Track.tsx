import clsx from "clsx";
import { Fragment } from "react";

import { GridRowWrapper } from "../../../../components/Grid";
import { RowStat } from "../../../../components/Grid/RowStat";
import InlineAlbum from "../../../../components/InlineAlbum";
import InlineArtist from "../../../../components/InlineArtist";
import InlineTrack from "../../../../components/InlineTrack";
import LongClickableTrack from "../../../../components/LongClickableTrack";
import PlayButton from "../../../../components/PlayButton";
import Rank from "../../../../components/Rank";
import Text from "../../../../components/Text";
import TrackOptions from "../../../../components/TrackOptions";
import { useMobile } from "../../../../services/hooks/hooks";
import { msToDuration } from "../../../../services/stats";
import { RankChange } from "../../../../services/topMovement";
import { Artist, Album, Track as TrackType } from "../../../../services/types";
import { useTrackGrid } from "./TrackGrid";

import s from "./index.module.css";

interface TrackProps {
  track: TrackType;
  artists: Artist[];
  album?: Album;
  playable?: boolean;
  count: number;
  duration: number;
  rank: number;
  movement?: RankChange;
}

export default function Track(props: TrackProps) {
  const [isMobile, isTablet] = useMobile();
  const trackGrid = useTrackGrid();

  const { track, album, artists, playable, duration, count, rank, movement } =
    props;

  const columns = [
    { ...trackGrid.rank, node: <Rank rank={rank} movement={movement} /> },
    {
      ...trackGrid.cover,
      node: playable && (
        <PlayButton id={track.id} covers={album?.images ?? []} />
      ),
    },
    {
      ...trackGrid.title,
      node: (
        <div className={clsx("otext", s.names)}>
          <InlineTrack element="div" track={track} size="normal" />
          <div className="subtitle">
            {artists.map((art, k, a) => (
              <Fragment key={art.id}>
                <InlineArtist artist={art} noStyle size="normal" />
                {k !== a.length - 1 && ", "}
              </Fragment>
            ))}
          </div>
        </div>
      ),
    },
    {
      ...trackGrid.album,
      node: !isTablet && album && (
        <InlineAlbum
          element="div"
          className="otext"
          album={album}
          size="normal"
          secondary
        />
      ),
    },
    {
      ...trackGrid.duration,
      node: !isMobile && (
        <Text element="div" size="normal" secondary>
          {msToDuration(track.duration_ms)}
        </Text>
      ),
    },
    {
      ...trackGrid.count,
      node: isMobile ? (
        <RowStat count={count} duration={duration} />
      ) : (
        <Text element="div" size="normal" secondary>
          {count}
        </Text>
      ),
    },
    {
      ...trackGrid.total,
      node: !isMobile && (
        <Text element="div" className="center" size="normal" secondary>
          {msToDuration(duration)}
        </Text>
      ),
    },
    { ...trackGrid.options, node: !isMobile && <TrackOptions track={track} /> },
  ];

  return (
    <LongClickableTrack track={track}>
      <GridRowWrapper
        columns={columns}
        className={clsx("play-button-holder", s.row)}
      />
    </LongClickableTrack>
  );
}
