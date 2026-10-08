import { Grid } from "@mui/material";
import { useSelector } from "react-redux";

import ArtistDistribution from "../../components/ArtistDistribution/ArtistDistribution";
import Header from "../../components/Header";
import BestArtistsBar from "../../components/ImplementedCharts/BestArtistsBar";
import ListeningRepartition from "../../components/ImplementedCharts/ListeningRepartition";
import ArtistDiversity from "../../components/ListeningOverview/ArtistDiversity";
import { ListeningOverviewProvider } from "../../components/ListeningOverview/context";
import ListeningVolume from "../../components/ListeningOverview/ListeningVolume";
import ArtistActivity from "../../components/ListeningPatterns/ArtistActivity";
import ArtistEras from "../../components/ListeningPatterns/ArtistEras";
import ArtistHours from "../../components/ListeningPatterns/ArtistHours";
import ListeningHeatmaps from "../../components/ListeningPatterns/ListeningHeatmaps";
import LongestSessions from "../../components/LongestSessions/LongestSessions";
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
      <Header title="All stats" />
      <div className={s.content}>
        <ListeningOverviewProvider>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <BestArtistsBar className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <ListeningRepartition className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ArtistDistribution />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ArtistEras />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <ArtistHours />
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
              <ListeningVolume metric="hours" switchable className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12, md: 12, lg: 6 }}>
              <ArtistDiversity className={s.chart} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <LongestSessions />
            </Grid>
          </Grid>
        </ListeningOverviewProvider>
      </div>
    </div>
  );
}
