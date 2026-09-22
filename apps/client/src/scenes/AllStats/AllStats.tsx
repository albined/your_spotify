import { Grid } from "@mui/material";
import { useSelector } from "react-redux";

import ArtistDistribution from "../../components/ArtistDistribution/ArtistDistribution";
import Header from "../../components/Header";
import ArtistListeningRepartition from "../../components/ImplementedCharts/ArtistListeningRepartition";
import BestArtistsBar from "../../components/ImplementedCharts/BestArtistsBar";
import BestOfHour from "../../components/ImplementedCharts/BestOfHour";
import ListeningRepartition from "../../components/ImplementedCharts/ListeningRepartition";
import SongsListenedPer from "../../components/ImplementedCharts/SongsListenedPer";
import TimeListenedPer from "../../components/ImplementedCharts/TimeListenedPer";
import ArtistDiversity from "../../components/ListeningOverview/ArtistDiversity";
import { ListeningOverviewProvider } from "../../components/ListeningOverview/context";
import ArtistActivity from "../../components/ListeningPatterns/ArtistActivity";
import ListeningHeatmaps from "../../components/ListeningPatterns/ListeningHeatmaps";
import ReleaseDates from "../../components/ReleaseDates/ReleaseDates";
import { selectUser } from "../../services/redux/modules/user/selector";

import s from "./index.module.css";

export default function AllStats() {
  const user = useSelector(selectUser);

  if (!user) {
    return null;
  }

  return (
    <div className={s.root}>
      <Header
        title="All stats"
        subtitle="You can find here all kind of stats based on the time span on the
          right"
      />
      <div className={s.content}>
        <ListeningOverviewProvider>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <BestArtistsBar className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <ListeningRepartition className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <ArtistListeningRepartition className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <BestOfHour className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ArtistDistribution />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ReleaseDates />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ListeningHeatmaps />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ArtistActivity />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <SongsListenedPer className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <TimeListenedPer className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <ArtistDiversity className={s.chart} />
            </Grid>
          </Grid>
        </ListeningOverviewProvider>
      </div>
    </div>
  );
}
