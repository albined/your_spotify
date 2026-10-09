import { ArrowUpward } from "@mui/icons-material";
import clsx from "clsx";
import { useEffect, useState } from "react";

import s from "./index.module.css";

interface ScrollTopProps {
  besideSider: boolean;
  aboveBottomNav: boolean;
}

// Offered on the way back up from deep in a page, and gone again as soon as
// the reader carries on down.
export default function ScrollTop({
  besideSider,
  aboveBottomNav,
}: ScrollTopProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < window.innerHeight * 1.5) setShown(false);
      else if (y < last - 4) setShown(true);
      else if (y > last + 4) setShown(false);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      className={clsx(
        s.root,
        shown && s.shown,
        besideSider && s.besideSider,
        aboveBottomNav && s.aboveBottomNav,
      )}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      onClick={() => scrollToTop()}>
      <ArrowUpward fontSize="inherit" />
      Back to top
    </button>
  );
}

export function scrollToTop() {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
}
