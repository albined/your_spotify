import { ChevronRight, ExitToApp, SettingsOutlined } from "@mui/icons-material";
import { ReactNode, useEffect } from "react";
import { useSelector } from "react-redux";
import { Link, Navigate } from "react-router-dom";

import Header from "../../components/Header";
import { useSider } from "../../components/Layout/useSider";
import SiderSearch from "../../components/SiderSearch";
import { useNavigate } from "../../services/hooks/useNavigate";
import { selectVersion } from "../../services/redux/modules/settings/selector";
import { getVersion } from "../../services/redux/modules/settings/thunk";
import { useAppDispatch } from "../../services/redux/tools";

import s from "./index.module.css";

interface Row {
  label: string;
  link: string;
  icon: ReactNode;
}

export default function More() {
  const { siderIsDrawer } = useSider();
  const navigate = useNavigate();
  const version = useSelector(selectVersion);
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(getVersion());
  }, [dispatch]);

  if (!siderIsDrawer) {
    return <Navigate to="/" replace />;
  }

  const rows: Row[] = [
    {
      label: "Settings",
      link: "/settings/account",
      icon: <SettingsOutlined />,
    },
    { label: "Logout", link: "/logout", icon: <ExitToApp /> },
  ];

  return (
    <div>
      <Header title="More" hideInterval hideShare />
      <div className={s.content}>
        <SiderSearch
          showShortcut={false}
          inputClassname={s.search}
          onTrackClick={(track) => navigate(`/song/${track.id}`)}
          onAlbumClick={(album) => navigate(`/album/${album.id}`)}
          onArtistClick={(artist) => navigate(`/artist/${artist.id}`)}
        />
        <nav className={s.rows} aria-label="More">
          {rows.map((row) => (
            <Link key={row.link} to={row.link} className={s.row}>
              {row.icon}
              <span>{row.label}</span>
              <ChevronRight className={s.chevron} />
            </Link>
          ))}
        </nav>
        {version && <div className={s.version}>v{version}</div>}
      </div>
    </div>
  );
}
