import { Button } from "@mui/material";
import { ReactNode, useEffect, useRef } from "react";

import Loader from "../Loader";

import s from "./index.module.css";

interface Props {
  children: ReactNode;
  dataLength: number;
  hasMore: boolean;
  loading: boolean;
  error: boolean;
  next: () => Promise<void>;
}

export default function InfiniteList({
  children,
  dataLength,
  hasMore,
  loading,
  error,
  next,
}: Props) {
  const footer = useRef<HTMLDivElement>(null);

  // Recheck after each page, even when the footer stayed inside the viewport.
  useEffect(() => {
    const node = footer.current;
    if (!node || !hasMore || loading || error) return;
    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!active || !entry?.isIntersecting) return;
        observer.disconnect();
        void next();
      },
      { rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [dataLength, hasMore, loading, error, next]);

  return (
    <div className={s.root} aria-busy={loading}>
      {children}
      <div ref={footer} className={s.footer}>
        {loading && <Loader aria-label="Loading more items" />}
        {error && !loading && (
          <div className={s.error} role="alert">
            Could not load more items.
            <Button onClick={() => void next()}>Retry</Button>
          </div>
        )}
      </div>
    </div>
  );
}
