import { useCallback, useEffect, useState } from "react";
import { useData } from "../../lib/store";

/** Snoozed notifications are hidden until their time passes; `onWake` fires for each one that returns. The list lives in your synced settings. */
export function useSnooze(onWake: (id: string) => void) {
  const { data, act } = useData();
  const map = data.settings.snoozed ?? {};
  const [now, setNow] = useState(Date.now());
  const save = useCallback((next: Record<string, number>) => act.replaceWorkspace((d) => ({ ...d, settings: { ...d.settings, snoozed: next } })), [act]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const due = Object.entries(map).filter(([, until]) => until <= now);
    if (!due.length) return;
    const next = { ...map };
    due.forEach(([id]) => { delete next[id]; onWake(id); });
    save(next);
  }, [now, map, onWake, save]);
  const snooze = useCallback((id: string, ms = 3_600_000) => save({ ...(act.snapshot().settings.snoozed ?? {}), [id]: Date.now() + ms }), [act, save]);
  const hidden = useCallback((id: string) => (map[id] ?? 0) > now, [map, now]);
  return { snooze, hidden };
}
