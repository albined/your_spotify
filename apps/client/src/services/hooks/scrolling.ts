import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_ITEMS_TO_LOAD } from "../apis/api";
import { Interval } from "../intervals";

export function useInfiniteScroll<T>(
  interval: Interval,
  call: (
    start: Date,
    end: Date,
    nb: number,
    offset: number,
  ) => Promise<{ data: T[] }>,
  filter?: (item: T) => boolean,
) {
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const start = interval.start.getTime();
  const end = interval.end.getTime();
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const cursor = useRef<{
    offset: number;
    busy: boolean;
    more: boolean;
  } | null>(null);

  const onNext = useCallback(async () => {
    const page = cursor.current;
    if (!page || page.busy || !page.more) return;
    page.busy = true;
    setLoading(true);
    setError(false);
    try {
      // An entirely filtered-out page must still advance the server offset.
      // Keep going until dataLength can change or the server reaches the end.
      let visible: T[] = [];
      do {
        const result = await call(
          new Date(start),
          new Date(end),
          DEFAULT_ITEMS_TO_LOAD,
          page.offset,
        );
        if (cursor.current !== page) return;
        page.offset += result.data.length;
        page.more = result.data.length === DEFAULT_ITEMS_TO_LOAD;
        visible = filterRef.current
          ? result.data.filter(filterRef.current)
          : result.data;
      } while (!visible.length && page.more);
      setItems((previous) => [...previous, ...visible]);
      setHasMore(page.more);
    } catch {
      if (cursor.current !== page) return;
      setError(true);
      setHasMore(false);
    } finally {
      page.busy = false;
      if (cursor.current === page) setLoading(false);
    }
  }, [call, start, end]);

  useEffect(() => {
    // Reset only when the date values/request change, not Date object identity.
    cursor.current = { offset: 0, busy: false, more: true };
    setItems([]);
    setHasMore(true);
    void onNext();
    return () => {
      cursor.current = null;
    };
  }, [onNext]);

  return { items, hasMore, onNext, loading, error, retry: onNext };
}
