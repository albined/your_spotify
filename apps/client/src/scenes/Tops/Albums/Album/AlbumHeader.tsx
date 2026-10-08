import { GridHeaderWrapper } from "../../../../components/Grid";
import { useMobile } from "../../../../services/hooks/hooks";
import { useAlbumGrid } from "./AlbumGrid";

export default function AlbumHeader() {
  const [isMobile] = useMobile();
  const albumGrid = useAlbumGrid();

  const columns = [
    { ...albumGrid.rank, node: <div className="center">#</div> },
    { ...albumGrid.cover, node: <div /> },
    { ...albumGrid.title, node: <div>Album</div> },
    {
      ...albumGrid.count,
      node: <div className={isMobile ? "right" : undefined}>Plays</div>,
    },
    {
      ...albumGrid.total,
      node: !isMobile && <div className="center">Total</div>,
    },
  ];

  if (isMobile) return null;
  return <GridHeaderWrapper columns={columns} />;
}
