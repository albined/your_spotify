import { CSSProperties, MouseEvent, useLayoutEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import s from "./index.module.css";

const tops = [
  { label: "Songs", link: "/top/songs" },
  { label: "Artists", link: "/top/artists" },
  { label: "Albums", link: "/top/albums" },
];

// The router applies a navigation as a React transition, so the new list is
// not on screen when navigate() returns. The switch of the page that replaces
// this one reports when it is, and only then is the new state captured.
let shown: (() => void) | undefined;

export default function TopsSwitch() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = tops.findIndex((top) => top.link === pathname);

  useLayoutEffect(() => {
    shown?.();
    shown = undefined;
  }, [pathname]);

  // Slide the lists past each other where the browser can animate the change.
  const slide = (event: MouseEvent, index: number) => {
    if (
      index === current ||
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    event.preventDefault();
    const root = document.documentElement;
    root.dataset.tops = index > current ? "forward" : "back";
    document
      .startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            shown = resolve;
            setTimeout(resolve, 400);
            navigate(tops[index]!.link, { replace: true });
          }),
      )
      .finished.finally(() => root.removeAttribute("data-tops"));
  };

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
            onClick={(event) => slide(event, index)}
            aria-current={index === current ? "page" : undefined}>
            {top.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
