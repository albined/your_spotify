import { ColumnDescription, GridRowWrapper } from "../../../../components/Grid";
import { RowStat } from "../../../../components/Grid/RowStat";
import IdealImage from "../../../../components/IdealImage";
import InlineArtist from "../../../../components/InlineArtist";
import Rank from "../../../../components/Rank";
import Text from "../../../../components/Text";
import { useMobile } from "../../../../services/hooks/hooks";
import { msToDuration } from "../../../../services/stats";
import { RankChange } from "../../../../services/topMovement";
import { Artist as ArtistType } from "../../../../services/types";
import { useArtistGrid } from "./ArtistGrid";

import s from "./index.module.css";

interface ArtistProps {
  artist: ArtistType;
  count: number;
  duration: number;
  rank: number;
  movement?: RankChange;
}

export default function Artist({
  artist,
  duration,
  count,
  rank,
  movement,
}: ArtistProps) {
  const [isMobile, isTablet] = useMobile();
  const artistGrid = useArtistGrid();

  const genres = artist.genres.join(", ");

  const columns: ColumnDescription[] = [
    { ...artistGrid.rank, node: <Rank rank={rank} movement={movement} /> },
    {
      ...artistGrid.cover,
      node: (
        <IdealImage
          images={artist.images}
          size={48}
          alt="Artist cover"
          className={s.cover}
          width={48}
          height={48}
        />
      ),
    },
    {
      ...artistGrid.title,
      node: (
        <Text size="normal" className="otext">
          <InlineArtist size="normal" artist={artist} />
        </Text>
      ),
    },
    {
      ...artistGrid.genres,
      node: !isTablet && (
        <Text size="normal" className="otext" title={genres} secondary>
          {genres}
        </Text>
      ),
    },
    {
      ...artistGrid.count,
      node: isMobile ? (
        <RowStat count={count} duration={duration} />
      ) : (
        <Text size="normal" secondary>
          {count}
        </Text>
      ),
    },
    {
      ...artistGrid.total,
      node: !isMobile && (
        <Text size="normal" className="center" secondary>
          {msToDuration(duration)}
        </Text>
      ),
    },
  ];

  return <GridRowWrapper className={s.row} columns={columns} />;
}
