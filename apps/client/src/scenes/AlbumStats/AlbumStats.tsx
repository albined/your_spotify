import { TimelapseOutlined } from "@mui/icons-material";
import { CircularProgress, Grid } from "@mui/material";
import { Fragment } from "react";

import DetailHero from "../../components/DetailHero";
import IdealImage from "../../components/IdealImage";
import ImageTwoLines from "../../components/ImageTwoLines";
import InlineArtist from "../../components/InlineArtist";
import InlineTrack from "../../components/InlineTrack";
import DetailListening from "../../components/ListeningPatterns/DetailListening";
import Text from "../../components/Text";
import TitleCard from "../../components/TitleCard";
import { AlbumStatsResponse } from "../../services/apis/api";
import { msToDuration } from "../../services/stats";
import { getImage } from "../../services/tools";
import FirstAndLast from "../ArtistStats/FirstAndLast";
import AlbumRank from "./AlbumRank";

import s from "./index.module.css";

interface AlbumStatsProps {
  stats: AlbumStatsResponse;
}

export default function AlbumStats({ stats }: AlbumStatsProps) {
  if (!stats) {
    return <CircularProgress />;
  }

  return (
    <div>
      <DetailHero
        kind="Album"
        image={getImage(stats.album)}
        title={stats.album.name}
        subtitle={stats.artists.map((artist, k) => (
          <Fragment key={artist.id}>
            <InlineArtist size="normal" artist={artist} />
            {k < stats.artists.length - 1 && ", "}
          </Fragment>
        ))}>
        <AlbumRank albumId={stats.album.id} />
      </DetailHero>
      <div className={s.content}>
        <Grid
          container
          sx={{ justifyContent: "flex-start", alignItems: "flex-start" }}
          spacing={2}
          style={{ marginTop: 0 }}>
          <Grid size={{ xs: 12 }}>
            <DetailListening kind="album" id={stats.album.id} />
          </Grid>
          <Grid
            container
            size={{ xs: 12, lg: 6 }}
            sx={{ justifyContent: "flex-start", alignItems: "flex-start" }}
            spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TitleCard title="Context" contentClassName={s.context}>
                <div className={s.artists}>
                  {stats.artists.map((artist) => (
                    <ImageTwoLines
                      key={artist.id}
                      image={<IdealImage images={artist.images} size={48} />}
                      first={<InlineArtist size="normal" artist={artist} />}
                      second="Artist"
                    />
                  ))}
                </div>
                <ImageTwoLines
                  image={<TimelapseOutlined color="primary" fontSize="large" />}
                  first={`${msToDuration(
                    stats.tracks.reduce(
                      (acc, { track }) => track.duration_ms + acc,
                      0,
                    ),
                  )} (${stats.tracks.length} tracks)`}
                  second="Total duration"
                />
              </TitleCard>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FirstAndLast
                firstImages={stats.album.images}
                lastImages={stats.album.images}
                firstDate={new Date(stats.firstLast.first.played_at)}
                lastDate={new Date(stats.firstLast.last.played_at)}
                firstElement={
                  <InlineTrack
                    size="normal"
                    track={stats.firstLast.first.track}
                  />
                }
                lastElement={
                  <InlineTrack
                    size="normal"
                    track={stats.firstLast.last.track}
                  />
                }
              />
            </Grid>
          </Grid>
          <Grid size={{ xs: 12, lg: 6 }}>
            <TitleCard title="Most listened tracks">
              {stats.tracks.map(({ track, count }, k) => (
                <div key={track.id} className={s.ml}>
                  <Text element="strong" size="big" className={s.mlrank}>
                    #{k + 1}
                  </Text>
                  <ImageTwoLines
                    image={
                      <IdealImage
                        className={s.cardimg}
                        images={stats.album.images}
                        size={48}
                        alt="album cover"
                      />
                    }
                    first={<InlineTrack size="normal" track={track} />}
                    second={`${count} times`}
                  />
                </div>
              ))}
            </TitleCard>
          </Grid>
        </Grid>
      </div>
    </div>
  );
}
