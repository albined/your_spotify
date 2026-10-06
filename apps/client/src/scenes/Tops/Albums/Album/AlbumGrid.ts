import { commonUnits } from "../../../../components/Grid/commonUnits";
import { useMobile } from "../../../../services/hooks/hooks";

export function useAlbumGrid() {
  const [isMobile] = useMobile();

  return {
    rank: { unit: commonUnits.rank, key: "rank" },
    cover: { unit: commonUnits.cover, key: "cover" },
    title: { unit: commonUnits.mainTitle, key: "title" },
    count: { unit: commonUnits.stat(isMobile), key: "count" },
    total: { unit: commonUnits.stat(isMobile), key: "total" },
  } as const;
}
