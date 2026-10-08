import { commonUnits } from "../../../../components/Grid/commonUnits";
import { useMobile } from "../../../../services/hooks/hooks";

export function useArtistGrid() {
  const [isMobile] = useMobile();

  return {
    rank: { unit: commonUnits.rank, key: "rank" },
    cover: { unit: commonUnits.cover, key: "cover" },
    title: { unit: commonUnits.mainTitle, key: "title" },
    genres: { unit: "2fr", key: "genres" },
    count: { unit: commonUnits.rowStat(isMobile), key: "count" },
    total: { unit: commonUnits.stat(isMobile), key: "total" },
  } as const;
}
