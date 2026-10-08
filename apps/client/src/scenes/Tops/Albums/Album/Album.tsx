import { Fragment } from "react";

import { ColumnDescription, GridRowWrapper } from "../../../../components/Grid";
import { RowStat } from "../../../../components/Grid/RowStat";
import IdealImage from "../../../../components/IdealImage";
import InlineAlbum from "../../../../components/InlineAlbum";
import InlineArtist from "../../../../components/InlineArtist";
import Rank from "../../../../components/Rank";
import Text from "../../../../components/Text";
import { useMobile } from "../../../../services/hooks/hooks";
import { msToDuration } from "../../../../services/stats";
import { RankChange } from "../../../../services/topMovement";
import { Artist, Album as AlbumType } from "../../../../services/types";
import { useAlbumGrid } from "./AlbumGrid";

import s from "./index.module.css";

interface AlbumProps {
  artists: Artist[];
  album: AlbumType;
  count: number;
  duration: number;
  rank: number;
  movement?: RankChange;
}

export default function Album({
  album,
  artists,
  duration,
  count,
  rank,
  movement,
}: AlbumProps) {
  const [isMobile] = useMobile();
  const albumGrid = useAlbumGrid();

  const columns: ColumnDescription[] = [
    { ...albumGrid.rank, node: <Rank rank={rank} movement={movement} /> },
    {
      ...albumGrid.cover,
      node: (
        <IdealImage
          className={s.cover}
          images={album.images}
          alt="Album cover"
          size={48}
          width={48}
          height={48}
        />
      ),
    },
    {
      ...albumGrid.title,
      node: (
        <div className={s.names}>
          <div>
            <InlineAlbum size="normal" album={album} />
          </div>
          <div className="subtitle">
            {artists.map((art, k, a) => (
              <Fragment key={art.id}>
                <InlineArtist size="normal" artist={art} noStyle />
                {k !== a.length - 1 && ", "}
              </Fragment>
            ))}
          </div>
        </div>
      ),
    },
    {
      ...albumGrid.count,
      node: isMobile ? (
        <RowStat count={count} duration={duration} />
      ) : (
        <Text size="normal" secondary>
          {count}
        </Text>
      ),
    },
    {
      ...albumGrid.total,
      node: !isMobile && (
        <Text size="normal" className="center" secondary>
          {msToDuration(duration)}
        </Text>
      ),
    },
  ];

  return <GridRowWrapper columns={columns} />;
}
