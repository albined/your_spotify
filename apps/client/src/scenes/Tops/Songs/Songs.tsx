import { useSelector } from "react-redux";

import AddToPlaylist from "../../../components/AddToPlaylist";
import { GridWrapper } from "../../../components/Grid";
import Header from "../../../components/Header";
import { TrackSelectionPopup } from "../../../components/History/Track/TrackSelectionPopup";
import InfiniteList from "../../../components/InfiniteList";
import TopListeningRace from "../../../components/ListeningTimeline/TopListeningRace";
import { DEFAULT_PLAYLIST_NB } from "../../../components/PlaylistDialog/PlaylistDialog";
import { RightClickable } from "../../../components/RightClickable/RightClickable";
import {
  Selectable,
  SelectableContextProvider,
} from "../../../components/Selectable/Selectable.context";
import TableCard from "../../../components/TableCard";
import { api } from "../../../services/apis/api";
import { useIsGuest } from "../../../services/hooks/hooks";
import { useInfiniteScroll } from "../../../services/hooks/scrolling";
import { useSelectTracks } from "../../../services/hooks/useSelectTrack";
import { PlaylistContext } from "../../../services/redux/modules/playlist/types";
import { selectRawIntervalDetail } from "../../../services/redux/modules/user/selector";
import { getImage } from "../../../services/tools";
import { useTopMovement } from "../../../services/topMovement";
import Track from "./Track";
import TrackHeader from "./Track/TrackHeader";

import s from "./index.module.css";

export default function Songs() {
  const { interval } = useSelector(selectRawIntervalDetail);
  const isGuest = useIsGuest();
  const movement = useTopMovement("songs");

  const { items, hasMore, onNext, loading, error } = useInfiniteScroll(
    interval,
    api.getBestSongs,
  );

  const context: PlaylistContext = {
    type: "top",
    nb: DEFAULT_PLAYLIST_NB,
    interval: { start: interval.start.getTime(), end: interval.end.getTime() },
  };

  const { anchor, selectedTracks, setAnchor, setSelectedTracks, uniqSongIds } =
    useSelectTracks({ tracks: items.map((item) => item.track) });

  return (
    <>
      <div>
        <Header title="Top songs" />
        <div className={s.content}>
          <TopListeningRace kind="songs" />
          <TableCard
            artwork={items[0] && getImage(items[0].album)}
            right={isGuest ? undefined : <AddToPlaylist context={context} />}>
            <SelectableContextProvider
              selected={selectedTracks}
              setSelected={setSelectedTracks}>
              <InfiniteList
                next={onNext}
                hasMore={hasMore}
                dataLength={items.length}
                loading={loading}
                error={error}>
                <GridWrapper>
                  <TrackHeader />
                  {items.map((item, index) => (
                    <Selectable key={item.track.id} index={index}>
                      <RightClickable index={index} onRightClick={setAnchor}>
                        <Track
                          playable
                          rank={index + 1}
                          movement={movement.get(item.track.id)}
                          track={item.track}
                          album={item.album}
                          artists={[item.artist]}
                          count={item.count}
                          duration={item.duration_ms}
                        />
                      </RightClickable>
                    </Selectable>
                  ))}
                </GridWrapper>
              </InfiniteList>
            </SelectableContextProvider>
          </TableCard>
        </div>
      </div>
      <TrackSelectionPopup
        anchor={anchor}
        onClose={() => setAnchor(undefined)}
        songIds={uniqSongIds}
      />
    </>
  );
}
