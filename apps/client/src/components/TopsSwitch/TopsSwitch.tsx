import { CSSProperties } from "react";
import { Link, useLocation } from "react-router-dom";

import s from "./index.module.css";

const tops = [
  { label: "Songs", link: "/top/songs" },
  { label: "Artists", link: "/top/artists" },
  { label: "Albums", link: "/top/albums" },
];

// Changing list slides the lists past each other: see pageTransition.
export default function TopsSwitch() {
  const { pathname } = useLocation();
  const current = tops.findIndex((top) => top.link === pathname);

  return (
    <nav
      className={s.root}
      aria-label="Top lists"
      style={{ "--tops-index": Math.max(0, current) } as CSSProperties}>
      <span className={s.pill} aria-hidden="true" />
      <div className={s.items}>
        {tops.map((top, index) => (
          <Link
            key={top.link}
            to={top.link}
            replace
            className={s.item}
            aria-current={index === current ? "page" : undefined}>
            {top.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
