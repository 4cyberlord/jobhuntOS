// The connection to your server. This is the only thing kept on the device: the app needs it to find and unlock your data.
const KEY = "jhos.gate.sync";
export type SyncConfig = { apiUrl: string; syncKey: string; intervalSec: number };
// The hosted API plus the desktop session token received at sign-in are stored on this device.
export const DEFAULT_SYNC: SyncConfig = { apiUrl: "https://job-hunt-os-api.vercel.app", syncKey: "", intervalSec: 120 };
const parse = (store: Storage) => { try { return JSON.parse(store.getItem(KEY) ?? "{}"); } catch { return {}; } };
export function readSyncConfig(): SyncConfig {
  try { return { ...DEFAULT_SYNC, ...parse(localStorage), ...parse(sessionStorage) }; } catch { return DEFAULT_SYNC; }
}
/** `keep` true stores the sign-in on this device; false keeps it only until the app is closed. Omitted: keep whichever mode is in use. */
export function persistSyncConfig(c: SyncConfig, keep?: boolean) {
  try {
    const session = keep === undefined ? !!sessionStorage.getItem(KEY) : !keep;
    (session ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(c));
    (session ? localStorage : sessionStorage).removeItem(KEY);
  } catch { /* storage unavailable */ }
}
export const isConfigured = (c: SyncConfig) => /^https?:\/\//.test(c.apiUrl) && c.syncKey.length > 0;
export const apiBase = (c: SyncConfig) => c.apiUrl.replace(/\/+$/, "");
export const authHeaders = (c: SyncConfig) => ({ Authorization: `Bearer ${c.syncKey}` });
