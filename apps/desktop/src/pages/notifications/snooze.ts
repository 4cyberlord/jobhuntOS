import { useCallback, useEffect, useState } from "react";

const KEY = "jhos.notif.snoozed";
type Map = Record<string, number>;
const read = (): Map => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Map; } catch { return {}; } };
const write = (m: Map) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* storage unavailable */ } };

/** Snoozed notifications are hidden until their time passes; `onWake` fires for each one that returns. */
export function useSnooze(onWake: (id: string) => void) {
  const [map, setMap] = useState<Map>(read);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const due = Object.entries(map).filter(([, until]) => until <= now);
    if (!due.length) return;
    const next = { ...map };
    due.forEach(([id]) => { delete next[id]; onWake(id); });
    write(next);
    setMap(next);
  }, [now, map, onWake]);
  const snooze = useCallback((id: string, ms = 3_600_000) => {
    setMap((m) => { const n = { ...m, [id]: Date.now() + ms }; write(n); return n; });
  }, []);
  const hidden = useCallback((id: string) => (map[id] ?? 0) > now, [map, now]);
  return { snooze, hidden };
}
