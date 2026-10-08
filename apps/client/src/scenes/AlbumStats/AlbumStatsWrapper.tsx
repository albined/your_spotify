import { CircularProgress } from "@mui/material";
import { useParams } from "react-router-dom";

import FullscreenCentered from "../../components/FullscreenCentered";
import Text from "../../components/Text";
import { api } from "../../services/apis/api";
import { useAPI, useLastLoaded } from "../../services/hooks/hooks";
import AlbumStats from "./AlbumStats";

export default function AlbumStatsWrapper() {
  const params = useParams();
  const shown = useLastLoaded(
    params.id || "",
    useAPI(api.getAlbumStats, params.id || ""),
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
          You never listened to this album, might be someone else registered
        </Text>
      </FullscreenCentered>
    );
  }

  return (
    <div className={shown.stale ? "loading-next" : undefined}>
      <AlbumStats stats={stats} />
    </div>
  );
}
