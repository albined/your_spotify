import { useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

// Phones animate the change between pages. The pressed link answers at once
// and the pages are swapped in one motion as soon as the new one is drawn.
// Which motion depends on how the pages relate.
//   fade          unrelated pages, such as the tabs of the bottom bar
//   push          into an artist, album or song page
//   tops-forward  between the Top lists, which sit side by side
//   tops-back

// Called by the layout once the route that was asked for is on screen. The
// router applies a navigation as a React transition, so it is not when
// navigate() returns.
let shown: (() => void) | undefined;

const tops = ["/top/songs", "/top/artists", "/top/albums"];
const detail = /^\/(artist|album|song)\//;

function motion(from: string, to: string) {
  const before = tops.indexOf(from);
  const after = tops.indexOf(to);
  if (before >= 0 && after >= 0) {
    return after > before ? "tops-forward" : "tops-back";
  }
  // Stepping between neighbours keeps the page and dims it instead.
  if (detail.test(to)) return detail.test(from) ? undefined : "push";
  return "fade";
}

export function usePageTransitions() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    shown?.();
    shown = undefined;
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !document.startViewTransition ||
        !window.matchMedia("(max-width: 900px)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !link ||
        link.target ||
        link.hasAttribute("download") ||
        link.origin !== window.location.origin ||
        link.pathname === window.location.pathname
      ) {
        return;
      }
      const kind = motion(window.location.pathname, link.pathname);
      if (!kind) return;
      // The router's own handler stands down for a prevented click.
      event.preventDefault();
      const root = document.documentElement;
      root.dataset.nav = kind;
      // Styled as pressed straight away; the old page is captured with it.
      link.classList.add("nav-pressed");
      const transition = document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            const fallback = setTimeout(resolve, 400);
            shown = () => {
              clearTimeout(fallback);
              resolve();
            };
            navigate(`${link.pathname}${link.search}${link.hash}`, {
              replace: kind.startsWith("tops"),
            });
          }),
      );
      // A skipped transition still changes the page, only without the motion.
      transition.ready.catch(() => undefined);
      transition.finished.finally(() => {
        root.removeAttribute("data-nav");
        link.classList.remove("nav-pressed");
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);
}
