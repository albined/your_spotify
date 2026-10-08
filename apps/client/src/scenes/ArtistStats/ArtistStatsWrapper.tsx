import { Button, CircularProgress } from "@mui/material";
import { useCallback } from "react";
import { useParams } from "react-router-dom";

import FullscreenCentered from "../../components/FullscreenCentered";
import Text from "../../components/Text";
import { api } from "../../services/apis/api";
import { useLastLoaded } from "../../services/hooks/hooks";
import { useListeningRequest } from "../../services/listeningTimeline";
import ArtistStats from "./ArtistStats";

export default function ArtistStatsWrapper() {
  const params = useParams();
  const request = useCallback(
    () => api.getArtistStats(params.id || ""),
    [params.id],
  );
  const { data, error, retry } = useListeningRequest(request);
  const shown = useLastLoaded(params.id || "", data);
  const stats = shown?.value;

  if (error)
    return (
      <FullscreenCentered>
        <Text element="h3" size="normal">
          This artist or group is unavailable.
        </Text>
        <Button onClick={retry}>Retry</Button>
      </FullscreenCentered>
    );

  if (!shown || !stats) {
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

  if ("code" in stats || !shown.id) {
    return (
      <FullscreenCentered>
        <Text element="h3" size="normal">
          You never listened to this artist, might be someone else registered
        </Text>
      </FullscreenCentered>
    );
  }

  return (
    <div className={shown.stale ? "loading-next" : undefined}>
      <ArtistStats artistId={shown.id} stats={stats} />
    </div>
  );
}
