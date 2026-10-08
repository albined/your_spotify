import { SystemUpdateAlt as UpdateIcon } from "@mui/icons-material";
import { Tooltip } from "@mui/material";
import clsx from "clsx";
import { useSelector } from "react-redux";
import { useLocation } from "react-router-dom";

import { useSharePage } from "../../../services/hooks/hooks";
import { useNavigate } from "../../../services/hooks/useNavigate";
import {
  selectUpdateAvailable,
  selectVersion,
} from "../../../services/redux/modules/settings/selector";
import { selectUser } from "../../../services/redux/modules/user/selector";
import { Album, Artist, Track } from "../../../services/types";
import SiderSearch from "../../SiderSearch";
import Text from "../../Text";
import SiderCategory from "./SiderCategory/SiderCategory";
import SiderTitle from "./SiderTitle";
import { useLinks } from "./useLinks";

import s from "./index.module.css";

interface SiderProps {
  className?: string;
}

export default function Sider({ className }: SiderProps) {
  const user = useSelector(selectUser);
  const navigate = useNavigate();
  const location = useLocation();

  function goToArtist(artist: Artist) {
    navigate(`/artist/${artist.id}`);
  }

  function goToTrack(track: Track) {
    navigate(`/song/${track.id}`);
  }

  function goToAlbum(album: Album) {
    navigate(`/album/${album.id}`);
  }

  const { toCopy, onCopy } = useSharePage();

  const version = useSelector(selectVersion);
  const updateAvailable = useSelector(selectUpdateAvailable);

  const links = useLinks();

  if (!user) {
    return null;
  }

  return (
    <div className={clsx(s.root, className)}>
      <div className={s.title}>
        <SiderTitle />
      </div>
      <SiderSearch
        showShortcut
        onTrackClick={goToTrack}
        onAlbumClick={goToAlbum}
        onArtistClick={goToArtist}
      />
      <nav>
        {links.map((category) => (
          <SiderCategory
            key={category.label}
            user={user}
            pathname={location.pathname}
            onCopy={onCopy}
            toCopy={toCopy ?? ""}
            category={category}
          />
        ))}
      </nav>
      <div className={s.versionwrapper}>
        {version && (
          <Text noStyle className={s.version} size="small">
            v{version}
          </Text>
        )}
        {updateAvailable && (
          <Tooltip title="An update is available">
            <a
              href="https://github.com/Yooooomi/your_spotify/releases"
              target="_blank"
              rel="noreferrer">
              <Text onDark size="normal">
                <UpdateIcon fontSize="small" color="info" />
              </Text>
            </a>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
