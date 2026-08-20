import { useEffect, useRef, useState } from "react";

/** Shows a loading state the first time a view is opened (and on scope changes). */
export function useFirstLoad(key: string, ms = 420) {
  const seen = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(!seen.current.has(key));

  useEffect(() => {
    if (seen.current.has(key)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      seen.current.add(key);
      setLoading(false);
    }, ms);
    return () => clearTimeout(timer);
  }, [key, ms]);

  return loading;
}

/** Runs an action with a brief pending state so buttons feel responsive. */
export function usePendingAction(ms = 450) {
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = (id: string, action: () => void) => {
    if (pending) return;
    setPending(id);
    timer.current = setTimeout(() => {
      action();
      setPending(null);
    }, ms);
  };

  return { pending, run };
}
