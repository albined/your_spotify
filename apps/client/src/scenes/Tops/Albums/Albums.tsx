import { useSelector } from "react-redux";

import { GridWrapper } from "../../../components/Grid";
import Header from "../../../components/Header";
import InfiniteList from "../../../components/InfiniteList";
import TopListeningRace from "../../../components/ListeningTimeline/TopListeningRace";
import TableCard from "../../../components/TableCard";
import TopsSwitch from "../../../components/TopsSwitch";
import { api } from "../../../services/apis/api";
import { useInfiniteScroll } from "../../../services/hooks/scrolling";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import { getImage } from "../../../services/tools";
import { useTopMovement } from "../../../services/topMovement";
import Album from "./Album";
import AlbumHeader from "./Album/AlbumHeader";

import s from "./index.module.css";

export default function Albums() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const movement = useTopMovement("albums");
  const { items, hasMore, onNext, loading, error } = useInfiniteScroll(
    interval,
    api.getBestAlbums,
  );

  return (
    <div>
      <Header title="Top albums" phoneTitle={<TopsSwitch />} />
      <div className={s.content}>
        <TopListeningRace kind="albums" />
        <TableCard artwork={items[0] && getImage(items[0].album)}>
          <InfiniteList
            next={onNext}
            hasMore={hasMore}
            dataLength={items.length}
            loading={loading}
            error={error}>
            <GridWrapper>
              <AlbumHeader />
              {items.map((item, rank) => (
                <Album
                  key={item.album.id}
                  rank={rank + 1}
                  movement={movement.get(item.album.id)}
                  artists={[item.artist]}
                  album={item.album}
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
