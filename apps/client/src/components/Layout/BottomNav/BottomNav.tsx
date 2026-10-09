import {
  BarChart,
  BarChartOutlined,
  EmojiEvents,
  EmojiEventsOutlined,
  Home,
  HomeOutlined,
  MoreHoriz,
  Star,
  StarBorder,
} from "@mui/icons-material";
import { ReactNode } from "react";
import { useSelector } from "react-redux";
import { Link, useLocation } from "react-router-dom";

import { useIsGuest } from "../../../services/hooks/hooks";
import { selectAffinityEnabled } from "../../../services/redux/modules/settings/selector";
import { compact } from "../../../services/tools";
import { scrollToTop } from "../ScrollTop";

import s from "./index.module.css";

interface Tab {
  label: string;
  link: string;
  icon: ReactNode;
  iconOn: ReactNode;
  active: (pathname: string) => boolean;
}

export default function BottomNav() {
  const { pathname } = useLocation();
  const affinityEnabled = useSelector(selectAffinityEnabled);
  const isGuest = useIsGuest();
  const competition = "/collaborative/compete";

  const tabs: Tab[] = compact([
    {
      label: "Home",
      link: "/",
      icon: <HomeOutlined />,
      iconOn: <Home />,
      active: (path) => path === "/",
    },
    {
      label: "All stats",
      link: "/all",
      icon: <BarChartOutlined />,
      iconOn: <BarChart />,
      active: (path) => path === "/all",
    },
    {
      label: "Top",
      link: "/top/artists",
      icon: <StarBorder />,
      iconOn: <Star />,
      active: (path) => path.startsWith("/top/"),
    },
    affinityEnabled && !isGuest
      ? {
          label: "Competition",
          link: competition,
          icon: <EmojiEventsOutlined />,
          iconOn: <EmojiEvents />,
          active: (path) => path === competition,
        }
      : undefined,
    {
      label: "More",
      link: "/more",
      icon: <MoreHoriz />,
      iconOn: <MoreHoriz />,
      active: (path) =>
        path === "/more" ||
        path.startsWith("/settings") ||
        (path.startsWith("/collaborative") && path !== competition),
    },
  ]);

  return (
    <nav className={s.root} aria-label="Main">
      {tabs.map((tab) => {
        const active = tab.active(pathname);
        return (
          <Link
            key={tab.link}
            to={tab.link}
            className={s.tab}
            // Pressing the tab of the page already open goes back to its top.
            onClick={
              pathname === tab.link
                ? (event) => {
                    event.preventDefault();
                    scrollToTop();
                  }
                : undefined
            }
            aria-current={active ? "page" : undefined}>
            {active ? tab.iconOn : tab.icon}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
