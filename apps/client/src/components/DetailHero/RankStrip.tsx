import { Link } from "react-router-dom";

import s from "./index.module.css";

export interface RankResponse {
  index: number;
  isMax: boolean;
  isMin: boolean;
  results: { id: string; count: number }[];
}

interface RankItem {
  id: string;
  name: string;
  image?: string;
  link: string;
}

interface RankStripProps {
  rank: RankResponse | null;
  // Undefined until the neighbouring items have loaded.
  item: (id: string) => RankItem | undefined;
}

// The item's neighbours in the all-time ranking, itself marked.
export default function RankStrip({ rank, item }: RankStripProps) {
  const items = rank?.results.map(({ id, count }, k, all) => ({
    count,
    position: rank.index + k + (rank.isMax ? 1 : 0) + (rank.isMin ? -1 : 0),
    current: rank.isMax ? k === 0 : rank.isMin ? k === all.length - 1 : k === 1,
    detail: item(id),
  }));
  const loaded = items?.every(({ detail }) => detail);
  return (
    <div className={s.ranks}>
      {loaded &&
        items?.map(({ count, position, current, detail }) => (
          <Link
            key={detail!.id}
            to={detail!.link}
            className={s.rank}
            aria-current={current ? "page" : undefined}
            title={detail!.name}>
            <span className={s.position}>#{position}</span>
            {detail!.image && <img src={detail!.image} alt="" loading="lazy" />}
            <span className={s.rankTexts}>
              <strong>{detail!.name}</strong>
              <span>
                {count.toLocaleString()} {count === 1 ? "play" : "plays"}
              </span>
            </span>
          </Link>
        ))}
    </div>
  );
}
