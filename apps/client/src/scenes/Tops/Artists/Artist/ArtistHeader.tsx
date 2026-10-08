import { GridHeaderWrapper } from "../../../../components/Grid";
import { useMobile } from "../../../../services/hooks/hooks";
import { useArtistGrid } from "./ArtistGrid";

export default function ArtistHeader() {
  const [isMobile, isTablet] = useMobile();
  const artistGrid = useArtistGrid();

  const columns = [
    { ...artistGrid.rank, node: <div className="center">#</div> },
    { ...artistGrid.cover, node: <div /> },
    { ...artistGrid.title, node: <div>Artist</div> },
    { ...artistGrid.genres, node: !isTablet && <div>Genres</div> },
    {
      ...artistGrid.count,
      node: <div className={isMobile ? "right" : undefined}>Plays</div>,
    },
    {
      ...artistGrid.total,
      node: !isMobile && <div className="center">Total</div>,
    },
  ];

  if (isMobile) return null;
  return <GridHeaderWrapper columns={columns} />;
}
