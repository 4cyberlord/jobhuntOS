// Pulls GATE Scout discoveries from the server API and reports Approve/Dismiss decisions back.
// The connection (API URL + sync key) is the only thing stored on the device; see syncConfig.ts.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gateEnvelopeSchema, type GateStatus } from "@job-hunt-os/contracts";
import { useData } from "./store";
import { persistSyncConfig, readSyncConfig, type SyncConfig } from "./syncConfig";

export type { SyncConfig };
type Status = { state: "off" | "idle" | "syncing" | "error"; lastAt?: number; error?: string; lastCount?: number };

let status: Status = { state: "off" };
const subs = new Set<() => void>();
const setStatus = (s: Status) => { status = s; subs.forEach((f) => f()); };

export { readSyncConfig };
export function writeSyncConfig(c: SyncConfig) {
  persistSyncConfig(c);
  subs.forEach((f) => f());
}
// the cursor lives in memory only: the workspace already holds every GATE item, so a fresh start just re-checks (ingest dedupes)
let cursor = { since: "1970-01-01T00:00:00.000Z", afterId: "" };
const readCursor = () => cursor;
const writeCursor = (since: string, afterId = "") => { cursor = { since, afterId }; };
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
      let { since, afterId } = readCursor();
      let created = 0, skipped = 0, reason = "";
      for (let page = 0; page < 20; page++) {
        const res = await fetch(`${base(c)}/v1/desktop/gate/opportunities?since=${encodeURIComponent(since)}${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ""}`, { headers: headers(c) });
        if (!res.ok) throw new Error(res.status === 401 ? "The sync key was rejected (401)." : `Server returned ${res.status}.`);
        const body = (await res.json()) as { more?: boolean; next_since?: string; next_id?: string; items?: { gate_opportunity_id: string; gate_status?: string; updated_at?: string; envelope: unknown }[] };
        const batch = body.items ?? [];
        const items = batch.flatMap((i) => {
          const p = gateEnvelopeSchema.safeParse(i.envelope);
          if (!p.success) { skipped++; reason ||= p.error.issues[0] ? `${p.error.issues[0].path.join(".")}: ${p.error.issues[0].message}` : "invalid envelope"; return []; }
          return [{ envelope: p.data, remoteId: i.gate_opportunity_id }];
        });
        if (items.length) created += act.ingestGate(items).created;
        // decisions made elsewhere (another device, Telegram) flow back; an item you already decided here is never changed
        act.applyServerDecisions(batch.filter((i) => ["approved", "dismissed", "saved_for_later", "expired"].includes(i.gate_status ?? "")).map((i) => ({ remoteId: i.gate_opportunity_id, status: i.gate_status as GateStatus })));
        const last = batch.at(-1)?.updated_at;
        if (body.next_since) { since = body.next_since; afterId = body.next_id ?? ""; }
        else if (last) { since = new Date(Date.parse(last) - 1).toISOString(); afterId = ""; } // older API compatibility
        if (!body.more) break;
      }
      writeCursor(since, afterId);
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
      // only a decision made on an item we already had is pushed; a newly arrived item must never overwrite what the server holds
      if (prev === undefined || prev === g.gateStatus || !g.remoteId) continue;
      void fetch(`${base(c)}/v1/desktop/gate/${encodeURIComponent(g.remoteId)}/status`, { method: "POST", headers: headers(c), body: JSON.stringify({ gate_status: g.gateStatus, linked_job_id: g.linkedJobId }) }).catch(() => undefined);
    }
  }, [data.gate]);

  return pull;
}
