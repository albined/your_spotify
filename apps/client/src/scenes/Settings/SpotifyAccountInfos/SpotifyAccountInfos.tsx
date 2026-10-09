import { Button } from "@mui/material";

import TitleCard from "../../../components/TitleCard";
import { getSpotifyLogUrl } from "../../../services/tools";
import { SpotifyMe } from "../../../services/types";
import SettingLine from "../SettingLine";

interface SpotifyAccountInfosProps {
  // Missing while it loads, or when the link to Spotify needs renewing.
  spotifyAccount: SpotifyMe | null;
}

export default function SpotifyAccountInfos({
  spotifyAccount,
}: SpotifyAccountInfosProps) {
  return (
    <TitleCard title="Linked Spotify account">
      {spotifyAccount && (
        <>
          <SettingLine left="Id" right={spotifyAccount.id} />
          <SettingLine left="Mail" right={spotifyAccount.email} />
          <SettingLine left="Product type" right={spotifyAccount.product} />
        </>
      )}
      <SettingLine
        left="Relog to Spotify"
        right={
          <Button component="a" href={getSpotifyLogUrl()}>
            Relog
          </Button>
        }
      />
    </TitleCard>
  );
}
