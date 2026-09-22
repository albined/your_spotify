import { Button, CircularProgress } from "@mui/material";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import FullscreenCentered from "../../components/FullscreenCentered";
import Text from "../../components/Text";
import { api } from "../../services/apis/api";
import { useListeningRequest } from "../../services/listeningTimeline";
import ArtistStats from "./ArtistStats";

export default function ArtistStatsWrapper() {
  const params = useParams();
  const request = useCallback(
    () => api.getArtistStats(params.id || ""),
    [params.id],
  );
  const { data: stats, error, retry } = useListeningRequest(request);

  if (error)
    return (
      <FullscreenCentered>
        <Text element="h3" size="normal">
          This artist or group is unavailable.
        </Text>
        <Button onClick={retry}>Retry</Button>
      </FullscreenCentered>
    );

  if (!stats) {
    return (
      <FullscreenCentered>
        <CircularProgress />
        <div>
          <Text element="h3" size="normal">
            Loading your stats
          </Text>
        </div>
      </FullscreenCentered>
    );
  }

  if ("code" in stats || !params.id) {
    return (
      <FullscreenCentered>
        <Text element="h3" size="normal">
          You never listened to this artist, might be someone else registered
        </Text>
      </FullscreenCentered>
    );
  }

  return <ArtistStats artistId={params.id} stats={stats} />;
}
