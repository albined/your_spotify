import RankStrip from "../../../components/DetailHero/RankStrip";
import { api } from "../../../services/apis/api";
import { useLoadAlbums } from "../../../services/hooks/artist";
import { useAPI } from "../../../services/hooks/hooks";
import { getImage } from "../../../services/tools";

interface AlbumRankProps {
  albumId: string;
}

export default function AlbumRank({ albumId }: AlbumRankProps) {
  const rank = useAPI(api.getAlbumRank, albumId);
  const { albums } = useLoadAlbums(rank?.results.map((r) => r.id) ?? []);

  return (
    <RankStrip
      rank={rank}
      item={(id) => {
        const album = albums[id];
        return (
          album && {
            id,
            name: album.name,
            image: getImage(album),
            link: `/album/${id}`,
          }
        );
      }}
    />
  );
}
