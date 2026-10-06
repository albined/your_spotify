import { useSelector } from "react-redux";

import { GridWrapper } from "../../../components/Grid";
import Header from "../../../components/Header";
import InfiniteList from "../../../components/InfiniteList";
import TopListeningRace from "../../../components/ListeningTimeline/TopListeningRace";
import TableCard from "../../../components/TableCard";
import { api } from "../../../services/apis/api";
import { useInfiniteScroll } from "../../../services/hooks/scrolling";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import { getImage } from "../../../services/tools";
import { useTopMovement } from "../../../services/topMovement";
import Artist from "./Artist";
import ArtistHeader from "./Artist/ArtistHeader";

import s from "./index.module.css";

export default function Artists() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const movement = useTopMovement("artists");
  const { items, hasMore, onNext, error, loading } = useInfiniteScroll(
    interval,
    api.getBestArtists,
  );

  return (
    <div>
      <Header title="Top artists" />
      <div className={s.content}>
        <TopListeningRace kind="artists" />
        <TableCard artwork={items[0] && getImage(items[0].artist)}>
          <InfiniteList
            next={onNext}
            hasMore={hasMore}
            dataLength={items.length}
            loading={loading}
            error={error}>
            <GridWrapper>
              <ArtistHeader />
              {items.map((item, rank) => (
                <Artist
                  key={item.artist.id}
                  rank={rank + 1}
                  movement={movement.get(item.artist.id)}
                  artist={item.artist}
                  count={item.count}
                  duration={item.duration_ms}
                />
              ))}
            </GridWrapper>
          </InfiniteList>
        </TableCard>
      </div>
    </div>
  );
}
