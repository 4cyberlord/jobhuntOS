// Pulls GATE Scout discoveries from the server API and reports Approve/Dismiss decisions back.
// The sync key is kept in its own localStorage entry (not in app data) so exports/backups never contain it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gateEnvelopeSchema } from "@job-hunt-os/contracts";
import { useData } from "./store";

const KEY = "jhos.gate.sync";
export type SyncConfig = { apiUrl: string; syncKey: string; intervalSec: number };
// the hosted GATE API; only the sync key (from DESKTOP_SYNC_KEY) has to be pasted in Settings
const DEFAULT: SyncConfig = { apiUrl: "https://job-hunt-os-api.vercel.app", syncKey: "", intervalSec: 120 };
type Status = { state: "off" | "idle" | "syncing" | "error"; lastAt?: number; error?: string; lastCount?: number };

let status: Status = { state: "off" };
const subs = new Set<() => void>();
const setStatus = (s: Status) => { status = s; subs.forEach((f) => f()); };

export function readSyncConfig(): SyncConfig {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return DEFAULT; }
}
export function writeSyncConfig(c: SyncConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
  subs.forEach((f) => f());
}
const CURSOR = "jhos.gate.cursor";
const readCursor = () => { try { return localStorage.getItem(CURSOR) ?? "1970-01-01T00:00:00.000Z"; } catch { return "1970-01-01T00:00:00.000Z"; } };
const writeCursor = (v: string) => { try { localStorage.setItem(CURSOR, v); } catch { /* storage unavailable */ } };
const configured = (c: SyncConfig) => /^https?:\/\//.test(c.apiUrl) && c.syncKey.length > 0;
export const useSyncStatus = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => status);
export const useSyncConfig = () => { const [c, setC] = useState(readSyncConfig); useEffect(() => { const f = () => setC(readSyncConfig()); subs.add(f); return () => { subs.delete(f); }; }, []); return c; };

let current: (() => Promise<void>) | null = null;
/** Trigger a pull right now (used by the "Sync now" button). */
export const syncNow = () => current?.();

const headers = (c: SyncConfig) => ({ Authorization: `Bearer ${c.syncKey}`, "Content-Type": "application/json" });
const base = (c: SyncConfig) => c.apiUrl.replace(/\/+$/, "");

/** Mounted once in the app shell. */
export function useGateSyncRunner() {
  const { data, act } = useData();
  const busy = useRef(false);
  const pushed = useRef<Map<string, string>>(new Map(data.gate.map((g) => [g.id, g.gateStatus])));

  const pull = useCallback(async () => {
    const c = readSyncConfig();
    if (!configured(c)) return setStatus({ state: "off" });
    if (busy.current) return;
    busy.current = true;
    setStatus({ ...status, state: "syncing" });
    try {
      // Cursor sync: ask for everything changed since the last item we processed. Unlike the server's one-shot "delivered"
      // flag this survives a failed parse or a crash mid-pull, and a fresh install simply starts from the beginning.
      let since = readCursor();
      let created = 0, skipped = 0, reason = "";
      for (let page = 0; page < 20; page++) {
        const res = await fetch(`${base(c)}/v1/desktop/gate/opportunities?since=${encodeURIComponent(since)}`, { headers: headers(c) });
        if (!res.ok) throw new Error(res.status === 401 ? "The sync key was rejected (401)." : `Server returned ${res.status}.`);
        const body = (await res.json()) as { items?: { gate_opportunity_id: string; updated_at?: string; envelope: unknown }[] };
        const batch = body.items ?? [];
        const items = batch.flatMap((i) => {
          const p = gateEnvelopeSchema.safeParse(i.envelope);
          if (!p.success) { skipped++; reason ||= p.error.issues[0] ? `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` : "invalid envelope"; return []; }
          return [{ envelope: p.data, remoteId: i.gate_opportunity_id }];
        });
        if (items.length) created += act.ingestGate(items).created;
        const last = batch.at(-1)?.updated_at;
        // step back 1ms so items sharing the boundary timestamp are never skipped (re-seeing one is harmless: ingest dedupes)
        if (last) since = new Date(Date.parse(last) - 1).toISOString();
        if (batch.length < 100) break;
      }
      writeCursor(since);
      if (skipped) throw new Error(`${skipped} item${skipped === 1 ? "" : "s"} could not be read (${reason}).`);
      setStatus({ state: "idle", lastAt: Date.now(), lastCount: created });
    } catch (e) {
      setStatus({ state: "error", lastAt: status.lastAt, error: e instanceof Error ? e.message : "Sync failed." });
    } finally {
      busy.current = false;
    }
  }, [act]);

  useEffect(() => {
    current = pull;
    const run = () => void pull();
    run();
    const id = setInterval(run, Math.max(30, readSyncConfig().intervalSec) * 1000);
    const on = () => run();
    subs.add(on);
    return () => { clearInterval(id); subs.delete(on); };
  }, [pull]);

  // report decisions made in the app back to the server (best effort)
  useEffect(() => {
    const c = readSyncConfig();
    if (!configured(c)) return;
    for (const g of data.gate) {
      const prev = pushed.current.get(g.id);
      pushed.current.set(g.id, g.gateStatus);
      if (prev === g.gateStatus || !g.remoteId) continue;
      void fetch(`${base(c)}/v1/desktop/gate/${encodeURIComponent(g.remoteId)}/status`, { method: "POST", headers: headers(c), body: JSON.stringify({ gate_status: g.gateStatus, linked_job_id: g.linkedJobId }) }).catch(() => undefined);
    }
  }, [data.gate]);

  return pull;
}
