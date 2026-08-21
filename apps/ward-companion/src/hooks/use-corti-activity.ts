import { useEffect, useState } from "react";

import {
  cortiActivityEvent,
  readCortiActivity,
  type CortiActivityEntry,
  type CortiActivitySnapshot,
} from "@/lib/corti-activity";

/**
 * Keeps every judge-facing Corti surface on the same event-backed receipt.
 * The hook never invents activity: it only reflects entries written after a
 * real SDK event or API response.
 */
export function useCortiActivity(): CortiActivitySnapshot {
  const [activity, setActivity] = useState<CortiActivitySnapshot>({});

  useEffect(() => {
    setActivity(readCortiActivity());
    const onActivity = (event: Event) => {
      const entry = (event as CustomEvent<CortiActivityEntry>).detail;
      setActivity((current) => ({ ...current, [entry.product]: entry }));
    };
    const onStorage = () => setActivity(readCortiActivity());
    window.addEventListener(cortiActivityEvent, onActivity);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(cortiActivityEvent, onActivity);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return activity;
}
