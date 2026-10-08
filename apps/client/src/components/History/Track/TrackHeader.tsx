import { AccessTime } from "@mui/icons-material";

import { useMobile } from "../../../services/hooks/hooks";
import { GridHeaderWrapper } from "../../Grid";
import { trackGrid } from "./TrackGrid";

export default function TrackHeader() {
  const [isMobile, isTablet] = useMobile();

  const columns = [
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
    { ...trackGrid.listened, node: !isMobile && <div>Listened at</div> },
    { ...trackGrid.option, node: !isMobile && <div /> },
  ];

  if (isMobile) return null;
  return <GridHeaderWrapper columns={columns} />;
}
