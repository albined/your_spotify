import { CircularProgress } from "@mui/material";
import { useSelector } from "react-redux";
import { Navigate, Route, Routes } from "react-router-dom";

import ButtonsHeader from "../../components/ButtonsHeader";
import FullscreenCentered from "../../components/FullscreenCentered";
import Header from "../../components/Header";
import Masonry from "../../components/Masonry";
import Text from "../../components/Text";
import { api } from "../../services/apis/api";
import { useAPI } from "../../services/hooks/hooks";
import { selectSettings } from "../../services/redux/modules/settings/selector";
import {
  selectIsPublic,
  selectUser,
} from "../../services/redux/modules/user/selector";
import { compact, conditionalEntry } from "../../services/tools";
import AccountInfos from "./AccountInfos";
import AllowRegistration from "./AllowRegistration";
import AllTimeStartDate from "./AllTimeStartDate";
import ArtistGroups from "./ArtistGroups/ArtistGroups";
import ArtistVisibility from "./ArtistVisibility/ArtistVisibility";
import Backups from "./Backups";
import BlacklistArtist from "./BlacklistArtist";
import CompetitionParticipation from "./CompetitionParticipation";
import DarkMode from "./DarkMode";
import DateFormat from "./DateFormat";
import DeleteUser from "./DeleteUser";
import EnableAffinity from "./EnableAffinity";
import Importer from "./Importer";
import ListeningTime from "./ListeningTime";
import PublicToken from "./PublicToken";
import SetAdmin from "./SetAdmin";
import SpotifyAccountInfos from "./SpotifyAccountInfos";
import { StatMeasurement } from "./StatMeasurement";
import Timezone from "./Timezone";

import s from "./index.module.css";

export default function Settings() {
  const settings = useSelector(selectSettings);
  const sme = useAPI(api.sme);
  const user = useSelector(selectUser);
  const isPublic = useSelector(selectIsPublic);

  if (!settings) {
    return (
      <FullscreenCentered>
        <CircularProgress />
        <Text element="h3" size="big">
          Your settings are loading
        </Text>
      </FullscreenCentered>
    );
  }

  if (!user) {
    return null;
  }

  // Someone viewing through a public link can only change how it looks.
  const tabs = compact([
    conditionalEntry({ url: "/settings/account", label: "Account" }, !isPublic),
    { url: "/settings/display", label: "Display" },
    conditionalEntry(
      { url: "/settings/statistics", label: "Statistics" },
      !isPublic,
    ),
    conditionalEntry({ url: "/settings/import", label: "Import" }, !isPublic),
    conditionalEntry(
      { url: "/settings/admin", label: "Admin" },
      user.admin && !isPublic,
    ),
  ]);

  return (
    <div>
      <Header
        title="Settings"
        subtitle="Here are the settings for Your Spotify, anyone with an account can access this page"
        hideInterval
      />
      <ButtonsHeader items={tabs} />
      <div className={s.content}>
        <Routes>
          <Route
            path="/account"
            element={
              isPublic ? (
                <Navigate to="/settings/display" replace />
              ) : (
                <Masonry>
                  <AccountInfos user={user} isPublic={isPublic} />
                  <SpotifyAccountInfos spotifyAccount={sme} />
                  <PublicToken />
                  <CompetitionParticipation />
                </Masonry>
              )
            }
          />
          <Route
            path="/display"
            element={
              <Masonry>
                <DarkMode />
                {!isPublic && <Timezone />}
                {!isPublic && <DateFormat />}
                {!isPublic && <StatMeasurement />}
              </Masonry>
            }
          />
          <Route
            path="/statistics"
            element={
              <Masonry>
                {!isPublic && <ListeningTime />}
                {!isPublic && <AllTimeStartDate />}
                {!isPublic && <ArtistVisibility />}
                {!isPublic && <BlacklistArtist />}
              </Masonry>
            }
          />
          <Route
            path="/import"
            element={
              <div className={s.single}>{!isPublic && <Importer />}</div>
            }
          />
          <Route
            path="/admin"
            element={
              <div className={s.admin}>
                {user.admin && !isPublic && <ArtistGroups />}
                <Masonry>
                  {user.admin && !isPublic && <Backups />}
                  {user.admin && !isPublic && <SetAdmin />}
                  {user.admin && !isPublic && <DeleteUser />}
                  {user.admin && !isPublic && (
                    <AllowRegistration settings={settings} />
                  )}
                  {user.admin && !isPublic && (
                    <EnableAffinity settings={settings} />
                  )}
                </Masonry>
              </div>
            }
          />
        </Routes>
      </div>
    </div>
  );
}
