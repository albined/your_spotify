import { AccessTime } from "@mui/icons-material";

import { GridHeaderWrapper } from "../../../../components/Grid";
import { useMobile } from "../../../../services/hooks/hooks";
import { useTrackGrid } from "./TrackGrid";

export default function TrackHeader() {
  const [isMobile, isTablet] = useMobile();

  const trackGrid = useTrackGrid();

  const columns = [
    { ...trackGrid.rank, node: <div className="center">#</div> },
    { ...trackGrid.cover, node: <div /> },
    { ...trackGrid.title, node: <div>Title</div> },
    { ...trackGrid.album, node: !isTablet && <div>Album</div> },
    {
      ...trackGrid.duration,
      node: !isMobile && (
        <div>
          <AccessTime titleAccess="Duration" />
        </div>
      ),
    },
    {
      ...trackGrid.count,
      node: <div className={isMobile ? "right" : undefined}>Plays</div>,
    },
    {
      ...trackGrid.total,
      node: !isMobile && <div className="center">Total</div>,
    },
    { ...trackGrid.options, node: !isMobile && <div /> },
  ];

  if (isMobile) return null;
  return <GridHeaderWrapper columns={columns} />;
}
