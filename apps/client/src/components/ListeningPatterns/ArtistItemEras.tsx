import { ArtistItemErasData } from "../../services/detailListening";
import ListeningMatrix from "./ListeningMatrix";

export default function ArtistItemEras({ data }: { data: ArtistItemErasData }) {
  return (
    <>
      {data.albums.length > 0 && (
        <ListeningMatrix
          data={data}
          series={data.albums}
          title="Album eras"
          label="Artist album eras"
          sortByPeak
          rowWeight={0.8}
        />
      )}
      {data.songs.length > 0 && (
        <ListeningMatrix
          data={data}
          series={data.songs}
          title="Song eras"
          label="Artist song eras"
          sortByPeak
          rowWeight={0.8}
        />
      )}
    </>
  );
}
