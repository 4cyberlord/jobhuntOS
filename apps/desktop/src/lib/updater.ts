// In-app updates. The app asks your own API (signed in) for a newer build, which the API reads from your private GitHub Releases; "Get update" downloads it, verifies its
// signature against the public key baked into this build, installs it and restarts into the new version.
import { useSyncExternalStore } from "react";
import { isTauri } from "./tauri";
import { isConfigured, readSyncConfig } from "./syncConfig";

export type UpdatePhase = "unsupported" | "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";
export type UpdateState = { phase: UpdatePhase; current?: string; version?: string; notes?: string; progress?: number; error?: string; checkedAt?: number };

let state: UpdateState = { phase: isTauri() ? "idle" : "unsupported" };
const subs = new Set<() => void>();
const set = (s: Partial<UpdateState>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const useUpdate = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => state);

type Pending = { version: string; body?: string; downloadAndInstall: (cb?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void> };
let pending: Pending | null = null;
let busy = false;

/** `quiet` (automatic checks) never shows an error or a "you're up to date" message. */
export async function checkForUpdate(quiet = false) {
  if (!isTauri() || busy || state.phase === "downloading" || state.phase === "ready") return;
  busy = true;
  if (!quiet) set({ phase: "checking", error: undefined });
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    const current = await getVersion();
    const { check } = await import("@tauri-apps/plugin-updater");
    const cfg = readSyncConfig();
    if (!isConfigured(cfg)) { if (!quiet) set({ phase: "error", error: "Sign in first." }); return; }
    // the update service is your own API, so the check carries your session; the build's public key still verifies the download
    const update = (await check({ headers: { Authorization: `Bearer ${cfg.syncKey}` } })) as unknown as Pending | null;
    if (update) { pending = update; set({ phase: "available", current, version: update.version, notes: update.body ?? undefined, checkedAt: Date.now() }); }
    else { pending = null; set({ phase: quiet && state.phase !== "checking" ? state.phase : "uptodate", current, checkedAt: Date.now() }); }
  } catch (e) {
    if (!quiet) set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  } finally { busy = false; }
}

/** Downloads, verifies and installs the update found by checkForUpdate, then restarts the app. */
export async function installUpdate() {
  if (!pending || state.phase === "downloading") return;
  set({ phase: "downloading", progress: 0, error: undefined });
  try {
    let total = 0, got = 0;
    await pending.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data?.contentLength ?? 0;
      else if (e.event === "Progress") { got += e.data?.chunkLength ?? 0; if (total) set({ progress: Math.min(99, Math.round((got / total) * 100)) }); }
      else if (e.event === "Finished") set({ progress: 100 });
    });
    set({ phase: "ready", progress: 100 });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
