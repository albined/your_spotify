import RankStrip from "../../../components/DetailHero/RankStrip";
import { api } from "../../../services/apis/api";
import { useLoadArtists } from "../../../services/hooks/artist";
import { useAPI } from "../../../services/hooks/hooks";
import { getImage } from "../../../services/tools";

interface ArtistRankProps {
  artistId: string;
}

export default function ArtistRank({ artistId }: ArtistRankProps) {
  const rank = useAPI(api.getArtistRank, artistId);
  const { artists } = useLoadArtists(rank?.results.map((r) => r.id) ?? []);

  return (
    <RankStrip
      rank={rank}
      item={(id) => {
        const artist = artists[id];
        return (
          artist && {
            id,
            name: artist.name,
            image: getImage(artist),
            link: `/artist/${id}`,
          }
        );
      }}
    />
  );
}
