import { CircularProgress } from "@mui/material";
import { useParams } from "react-router-dom";

import FullscreenCentered from "../../components/FullscreenCentered";
import Text from "../../components/Text";
import { api } from "../../services/apis/api";
import { useAPI, useLastLoaded } from "../../services/hooks/hooks";
import SongStats from "./TrackStats";

export default function TrackStatsWrapper() {
  const params = useParams();
  const shown = useLastLoaded(
    params.id || "",
    useAPI(api.getTrackStats, params.id || ""),
  );
  const stats = shown?.value;

  if (!shown || !stats) {
    return (
      <FullscreenCentered>
        <CircularProgress />
        <div>
          <Text element="h3" size="big">
            Loading your stats
          </Text>
        </div>
      </FullscreenCentered>
    );
  }

  if ("code" in stats || !shown.id) {
    return (
      <FullscreenCentered>
        <Text element="h3" size="big">
          You never listened to this song, might be someone else registered
        </Text>
      </FullscreenCentered>
    );
  }

  return (
    <div className={shown.stale ? "loading-next" : undefined}>
      <SongStats trackId={shown.id} stats={stats} />
    </div>
  );
}
