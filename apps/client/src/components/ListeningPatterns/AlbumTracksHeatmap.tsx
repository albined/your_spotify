import { DetailListeningData } from "../../services/detailListening";
import ListeningMatrix from "./ListeningMatrix";

export default function AlbumTracksHeatmap({
  data,
}: {
  data: DetailListeningData;
}) {
  return (
    <ListeningMatrix
      data={data}
      series={data.tracks}
      title="Songs over time"
      label="Album songs over time"
    />
  );
}
