import { Alert, Button } from "@mui/material";
import InfiniteScroll from "react-infinite-scroll-component";
import { useSelector } from "react-redux";
import { GridWrapper } from "../../../components/Grid";
import Header from "../../../components/Header";
import TopListeningRace from "../../../components/ListeningTimeline/TopListeningRace";
import Loader from "../../../components/Loader";
import TitleCard from "../../../components/TitleCard";
import { api } from "../../../services/apis/api";
import { useInfiniteScroll } from "../../../services/hooks/scrolling";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import Artist from "./Artist";
import ArtistHeader from "./Artist/ArtistHeader";
import s from "./index.module.css";

export default function Artists() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const { items, hasMore, onNext, error, loading, retry } = useInfiniteScroll(
    interval,
    api.getBestArtists,
  );

  return (
    <div>
      <Header
        title="Top artists"
        subtitle="Here are the artists you listened to the most"
      />
      <div className={s.content}>
        <TopListeningRace kind="artists" />
        <TitleCard title="Top artists" noBorder>
          <InfiniteScroll
            next={onNext}
            hasMore={hasMore}
            dataLength={items.length}
            loader={<Loader />}>
            <GridWrapper>
              <ArtistHeader />
              {items.map((item, rank) => (
                <Artist
                  key={item.artist.id}
                  rank={rank + 1}
                  artist={item.artist}
                  count={item.count}
                  totalCount={item.total_count}
                  duration={item.duration_ms}
                  totalDuration={item.total_duration_ms}
                />
              ))}
            </GridWrapper>
          </InfiniteScroll>
          {error && (
            <Alert
              severity="error"
              action={
                <Button onClick={() => void retry()} disabled={loading}>
                  Retry
                </Button>
              }>
              Could not load more artists. Your loaded rows are still here.
            </Alert>
          )}
        </TitleCard>
      </div>
    </div>
  );
}
