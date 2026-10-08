import RankStrip from "../../../components/DetailHero/RankStrip";
import { api } from "../../../services/apis/api";
import { useAPI } from "../../../services/hooks/hooks";
import { useTracks } from "../../../services/track";

interface TrackRankProps {
  trackId: string;
}

export default function TrackRank({ trackId }: TrackRankProps) {
  const rank = useAPI(api.getTrackRank, trackId);
  const { tracks } = useTracks(rank?.results.map((r) => r.id) ?? []);

  return (
    <RankStrip
      rank={rank}
      item={(id) => {
        const track = tracks[id];
        return track && { id, name: track.name, link: `/song/${id}` };
      }}
    />
  );
}
