import { Grid } from "@mui/material";
import { useSelector } from "react-redux";

import ArtistDistribution from "../../components/ArtistDistribution/ArtistDistribution";
import Header from "../../components/Header";
import History from "../../components/History";
import ArtistsListened from "../../components/ImplementedCards/ArtistsListened";
import BestAlbum from "../../components/ImplementedCards/BestAlbum";
import BestArtist from "../../components/ImplementedCards/BestArtist";
import BestSong from "../../components/ImplementedCards/BestSong";
import SongsListened from "../../components/ImplementedCards/SongsListened";
import TimeListened from "../../components/ImplementedCards/TimeListened";
import ListeningRepartition from "../../components/ImplementedCharts/ListeningRepartition";
import TimeListenedPer from "../../components/ImplementedCharts/TimeListenedPer";
import { ListeningOverviewProvider } from "../../components/ListeningOverview/context";
import { selectUser } from "../../services/redux/modules/user/selector";

import s from "./index.module.css";

// One column on a phone: the three best cards together, then the charts.
const phoneOrder = (order: number) => ({ order: { xs: order, md: 0 } });

export default function Home() {
  const user = useSelector(selectUser);

  if (!user) {
    return null;
  }

  return (
    <div>
      <Header title={`Welcome, ${user.username}`} tinyTitle="Welcome" />
      <div className={s.content}>
        <ListeningOverviewProvider>
          <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
            <Grid size={{ xs: 4 }}>
              <SongsListened />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <TimeListened />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <ArtistsListened />
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 8 }} sx={phoneOrder(4)}>
              <TimeListenedPer className={s.timelisten} />
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 4 }} sx={phoneOrder(1)}>
              <BestArtist />
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 8 }} sx={phoneOrder(6)}>
              <ListeningRepartition className={s.timelisten} />
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 4 }} sx={phoneOrder(2)}>
              <BestSong />
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 8 }} sx={phoneOrder(5)}>
              <ArtistDistribution className={s.timelisten} />
            </Grid>
            <Grid size={{ xs: 12, md: 6, lg: 4 }} sx={phoneOrder(3)}>
              <BestAlbum />
            </Grid>
            <Grid size={{ xs: 12 }} sx={phoneOrder(7)}>
              <History />
            </Grid>
          </Grid>
        </ListeningOverviewProvider>
      </div>
    </div>
  );
}
