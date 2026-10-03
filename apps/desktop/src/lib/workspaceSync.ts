// Your server is the home of all your data. At start the app downloads the whole workspace, then keeps it in step: every edit is
// uploaded within a moment and changes from other devices arrive on a timer and when the window regains focus. Nothing is stored
// on the device except the connection (API URL + sync key).
//
// Change tracking: each item is fingerprinted; when a fingerprint changes (or an item disappears) it is stamped with the edit time
// and queued. The server keeps the newest edit per item (last writer wins). Deletions travel as tombstones.
// The credential vault stays encrypted end to end: the server only ever holds AES-GCM ciphertext, salt and verifier.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useData } from "./store";
import { apiBase, authHeaders, isConfigured, persistSyncConfig, readSyncConfig } from "./syncConfig";
import { applyRemote, mergeLegacy, newMeta, scan, snapshot, type Meta, type WsChange } from "./workspaceCore";
import { clearLegacy, hasLegacy, readLegacyData, uploadLegacyFiles } from "./legacy";

export type Phase = { phase: "loading" | "needs-config" | "ready" | "error"; error?: string; migrating?: boolean };
type Status = { state: "off" | "idle" | "syncing" | "error"; lastAt?: number; error?: string; pending?: number };
let phase: Phase = { phase: "loading" };
let status: Status = { state: "off" };
const subs = new Set<() => void>();
const setPhase = (p: Phase) => { phase = p; subs.forEach((f) => f()); };
const setStatus = (s: Status) => { status = s; subs.forEach((f) => f()); };
const sub = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const useWorkspacePhase = () => useSyncExternalStore(sub, () => phase);
export const useWorkspaceStatus = () => useSyncExternalStore(sub, () => status);
let current: ((auto?: boolean) => Promise<void>) | null = null;
export const workspaceSyncNow = () => current?.(false);

const BATCH = 300;
/** The server refused our credentials (401) or is throttling this address (429); retrying the same request would only make it worse. */
class AuthError extends Error {}
class ThrottleError extends Error {}
const message = (e: unknown) => (e instanceof Error ? e.message : "Sync failed.");

/** Mounted once, above the app shell: loads the workspace, then keeps it synced. */
export function useWorkspaceSyncRunner() {
  const { data, act } = useData();
  const dataRef = useRef(data); dataRef.current = data;
  const busy = useRef(false);
  const again = useRef(false);
  const loaded = useRef(false);
  const meta = useRef<Meta>(newMeta());
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);

  const post = useCallback(async (changes: WsChange[]) => {
    const c = readSyncConfig();
    const res = await fetch(`${apiBase(c)}/v1/desktop/workspace/sync`, { method: "POST", headers: { ...authHeaders(c), "Content-Type": "application/json" }, body: JSON.stringify({ since: meta.current.since, changes }) });
    if (res.status === 401) throw new AuthError("Your session has expired. Please sign in again.");
    if (res.status === 429) throw new ThrottleError("Too many attempts from this network. Waiting a minute before trying again.");
    if (!res.ok) throw new Error(`Server returned ${res.status}.`);
    return (await res.json()) as { next: string; more: boolean; changes: WsChange[] };
  }, []);

  /** Merges what the server sent. The edit scan runs first so a change you just made is never overwritten by an older remote copy. */
  const take = useCallback((body: { next: string; changes: WsChange[] }, scanFirst = true) => {
    act.replaceWorkspace((d) => { if (scanFirst) scan(d, meta.current); return applyRemote(d, body.changes, meta.current).data; });
    dataRef.current = act.snapshot();
    meta.current.since = body.next;
  }, [act]);

  /** Uploads pending edits and downloads anything new, until both are drained. */
  const exchange = useCallback(async () => {
    for (let round = 0; round < 60; round++) {
      scan(dataRef.current, meta.current);
      const pending = Object.entries(meta.current.items).filter(([, e]) => e.p).slice(0, BATCH);
      const snap = snapshot(dataRef.current);
      const changes: WsChange[] = pending.map(([key, e]) => {
        const [col, ...rest] = key.split(":"); const id = rest.join(":");
        return e.d ? { c: col as WsChange["c"], id, u: e.u, deleted: true } : { c: col as WsChange["c"], id, u: e.u, doc: snap.get(key)!.doc };
      });
      const body = await post(changes);
      // an item edited while the request was in flight keeps its pending flag (its stamp moved on)
      for (const [key, e] of pending) { const now = meta.current.items[key]; if (now && now.u === e.u && now.h === e.h) now.p = false; }
      take(body);
      if (!body.more && !Object.values(meta.current.items).some((e) => e.p)) return;
    }
  }, [post, take]);

  /** First run on this device: download everything, fold in any old on-device copy, and only then show the app. */
  const initialLoad = useCallback(async () => {
    for (let page = 0; page < 400; page++) { const body = await post([]); take(body, false); if (!body.more) break; }
    if (hasLegacy()) {
      const legacy = readLegacyData();
      if (legacy) {
        setPhase({ phase: "loading", migrating: true });
        act.replaceWorkspace((d) => mergeLegacy(d, legacy, meta.current));
        dataRef.current = act.snapshot();
        // files first: if one fails the on-device copy is kept and the whole step is retried
        await uploadLegacyFiles(legacy);
        await exchange();
        clearLegacy();
      }
    }
    await exchange();
  }, [post, take, act, exchange]);

  /** `auto` marks timer-driven retries, which must not flash the launch screen over whatever is showing. */
  const run = useCallback(async (auto = false) => {
    const c = readSyncConfig();
    if (!isConfigured(c)) { setStatus({ state: "off" }); if (phase.phase !== "needs-config") setPhase({ phase: "needs-config" }); return; }
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    clearTimeout(retry.current);
    setStatus({ ...status, state: "syncing", error: undefined });
    try {
      if (!loaded.current) { if (!auto && phase.phase !== "loading") setPhase({ phase: "loading" }); await initialLoad(); loaded.current = true; setPhase({ phase: "ready" }); }
      else await exchange();
      setStatus({ state: "idle", lastAt: Date.now(), pending: Object.values(meta.current.items).filter((e) => e.p).length });
    } catch (e) {
      if (e instanceof AuthError) {
        // the saved sign-in is no longer valid: forget it and ask for a fresh one, without retrying
        persistSyncConfig({ ...readSyncConfig(), syncKey: "" });
        loaded.current = false; meta.current = newMeta();
        setStatus({ state: "off" });
        setPhase({ phase: "needs-config", error: message(e) });
      } else {
        setStatus({ state: "error", lastAt: status.lastAt, error: message(e) });
        if (!loaded.current) { meta.current = newMeta(); setPhase({ phase: "error", error: message(e) }); }
        retry.current = setTimeout(() => void run(true), e instanceof ThrottleError ? 60_000 : 15_000); // unsaved edits stay in memory and are retried
      }
    } finally {
      busy.current = false;
      if (again.current) { again.current = false; void run(); }
    }
  }, [initialLoad, exchange]);

  useEffect(() => { current = run; void run(); return () => { current = null; clearTimeout(retry.current); }; }, [run]);
  // upload shortly after any edit (only once the workspace has been loaded)
  useEffect(() => { if (!loaded.current) return; const t = setTimeout(() => void run(), 600); return () => clearTimeout(t); }, [data, run]);
  // pick up changes made on other devices
  useEffect(() => { const id = setInterval(() => void run(), Math.max(30, readSyncConfig().intervalSec) * 1000); const on = () => void run(); window.addEventListener("focus", on); return () => { clearInterval(id); window.removeEventListener("focus", on); }; }, [run]);
}

