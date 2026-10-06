import { msToDuration } from "../../../../services/stats";
import { Artist as ArtistType } from "../../../../services/types";
import InlineArtist from "../../../../components/InlineArtist";
import Text from "../../../../components/Text";
import { useMobile } from "../../../../services/hooks/hooks";
import { ColumnDescription, GridRowWrapper } from "../../../../components/Grid";
import IdealImage from "../../../../components/IdealImage";
import Rank from "../../../../components/Rank";
import { RankChange } from "../../../../services/topMovement";
import s from "./index.module.css";
import { useArtistGrid } from "./ArtistGrid";

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
      node: (
        <Text
          size="normal"
          secondary
          className={isMobile ? "right" : undefined}>
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
