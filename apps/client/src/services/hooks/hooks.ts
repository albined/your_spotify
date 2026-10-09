import { debounce, useMediaQuery } from "@mui/material";
import {
  RefObject,
  startTransition,
  TouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSelector } from "react-redux";

import { detailIntervalToQuery } from "../intervals";
import { alertMessage } from "../redux/modules/message/reducer";
import {
  selectIntervalDetail,
  selectRawIntervalDetail,
  selectUser,
} from "../redux/modules/user/selector";
import { useAppDispatch } from "../redux/tools";
import { UnboxPromise } from "../types";

// A value that is loading again because the period changed stays as it was
// until the new one arrives, so the page does not blank between periods. Any
// other reload, such as a different artist, still starts empty.
export function useHeldOverPeriod<T>(value: T | undefined) {
  const { interval } = useSelector(selectRawIntervalDetail);
  const period = `${interval.start.getTime()}-${interval.end.getTime()}`;
  const [last, setLast] = useState<{
    period: string;
    value: T;
    held: boolean;
  }>();
  if (value !== null && value !== undefined) {
    if (!last || last.held || last.period !== period || last.value !== value) {
      setLast({ period, value, held: false });
    }
    return value;
  }
  if (!last) return value;
  if (last.period !== period) setLast({ ...last, period, held: true });
  return last.held || last.period !== period ? last.value : value;
}

export function useAPI<Fn extends (...ags: any[]) => Promise<{ data: D }>, D>(
  call: Fn,
  ...args: Parameters<Fn>
): null | UnboxPromise<ReturnType<Fn>>["data"] {
  const [state, setState] = useState<{
    deps: unknown[];
    data?: UnboxPromise<ReturnType<Fn>>["data"];
    failed?: boolean;
  }>();
  const deps = [call, ...args];
  useEffect(() => {
    let active = true;
    async function fetch() {
      const result = await call(...args);
      // Dense chart updates should not take priority over input/date changes.
      if (active) startTransition(() => setState({ deps, data: result.data }));
    }

    fetch().catch((error) => {
      console.error(error);
      if (active) setState({ deps, failed: true });
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // An answer to an earlier request is never shown as this one's.
  const current =
    state?.deps.length === deps.length &&
    state.deps.every((dep, index) => Object.is(dep, deps[index]));
  const held = useHeldOverPeriod(current ? state.data : undefined) ?? null;
  // After a failure the previous period's numbers must not pass as this one's.
  return current && state.failed ? null : held;
}

// Keep stale responses from overwriting a newly selected artist/date range.
export function useListeningRequest<T>(request: () => Promise<{ data: T }>) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    request: typeof request;
    data?: T;
    error?: boolean;
  }>();
  useEffect(() => {
    let active = true;
    // Asking again keeps an answer that is already shown; only a failed
    // request goes back to loading.
    setState((current) =>
      current?.request === request && !current.error ? current : undefined,
    );
    request().then(
      ({ data }) => {
        // Chart rendering can yield to input while a response is displayed.
        if (active) startTransition(() => setState({ request, data }));
      },
      () => {
        if (!active) return;
        // A refresh that fails leaves the answer already shown in place.
        setState((current) =>
          current?.request === request && !current.error
            ? current
            : { request, error: true },
        );
      },
    );
    return () => {
      active = false;
    };
  }, [request, attempt]);
  const error = state?.request === request && state.error === true;
  const held = useHeldOverPeriod(
    state?.request === request ? state.data : undefined,
  );
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // After a failure the previous period's numbers must not pass as this one's.
  return { data: error ? undefined : held, error, retry };
}

export function useConditionalAPI<
  Fn extends (...ags: any[]) => Promise<{ data: D }>,
  D,
>(
  condition: boolean,
  call: Fn,
  ...args: Parameters<Fn>
): [null | UnboxPromise<ReturnType<Fn>>["data"], boolean] {
  const [value, setValue] = useState<
    UnboxPromise<ReturnType<Fn>>["data"] | null
  >(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function fetch() {
      const result = await call(...args);
      if (active) {
        startTransition(() => {
          setLoading(false);
          setValue(result.data);
        });
      }
    }

    if (condition) {
      setLoading(true);
      fetch().catch(console.error);
    } else {
      setValue(null);
      setLoading(false);
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...args, condition, call]);

  return [value, loading];
}

export function useShareLink() {
  const user = useSelector(selectUser);
  const interval = useSelector(selectIntervalDetail);

  if (!user) {
    return undefined;
  }
  const search = new URLSearchParams(window.location.search);
  Object.entries(detailIntervalToQuery(interval, "g")).forEach(
    ([key, value]) => {
      search.set(key, value);
    },
  );
  if (user.publicToken) {
    search.set("token", user.publicToken);
  }
  return `${window.location.origin}${
    window.location.pathname
  }?${search.toString()}`;
}

// Keeps the last loaded page on screen while the next one is requested, so
// stepping between items does not blank the screen.
export function useLastLoaded<T>(id: string, value: T | null | undefined) {
  const [last, setLast] = useState<{ id: string; value: T }>();
  const loaded = value !== null && value !== undefined;
  if (loaded && (last?.id !== id || last.value !== value)) {
    setLast({ id, value });
  }
  if (loaded) return { id, value, stale: false };
  return last && { ...last, stale: true };
}

export function useSharePage() {
  const dispatch = useAppDispatch();
  const user = useSelector(selectUser);
  const toCopy = useShareLink();

  const onCopy = () => {
    if (!user?.publicToken) {
      dispatch(
        alertMessage({
          level: "error",
          message:
            "No public token generated, go to the settings page to generate one",
        }),
      );
      return;
    }
    dispatch(
      alertMessage({
        level: "info",
        message: "Copied current page to clipboard with public token",
      }),
    );
  };

  return { toCopy, onCopy };
}

export function useIsGuest() {
  const user = useSelector(selectUser);

  return !!user?.isGuest;
}

export function useResizeDebounce(
  cb: (width: number) => void,
  ref?: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const cbWithWidth = () => cb(ref?.current?.clientWidth ?? 0);
    const internCb = debounce(cbWithWidth, 1000);
    setTimeout(cbWithWidth, 100);
    window.addEventListener("resize", internCb);
    return () => {
      window.removeEventListener("resize", internCb);
    };
  }, [cb, ref]);
}

export function useMobile(): [boolean, boolean, boolean] {
  return [
    useMediaQuery("(max-width: 900px)"),
    useMediaQuery("(max-width: 1250px)"),
    useMediaQuery("(min-width: 1250px)"),
  ];
}

export function useLongPress(callback: () => void, ms = 300) {
  const currentTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  function stop() {
    document.removeEventListener("scroll", stop);
    clearTimeout(currentTimeout.current);
    currentTimeout.current = undefined;
  }

  function start(event: TouchEvent<HTMLDivElement>) {
    document.addEventListener("scroll", stop);
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(currentTimeout.current);
    currentTimeout.current = setTimeout(callback, ms);
  }

  return { onTouchStart: start, onTouchEnd: stop };
}

export function useBooleanState(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);

  const onOpen = () => setOpen(true);
  const onClose = () => setOpen(false);

  return [open, onOpen, onClose];
}
