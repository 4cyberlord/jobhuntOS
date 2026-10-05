/** Client for the server-owned Outlook integration. No Microsoft token is stored in this app. */
import { apiBase, authHeaders, isConfigured, readSyncConfig } from "./syncConfig";
import type { EmailMessage } from "./emailSync";

export type OutlookConnection = { configured: boolean; connected: boolean; email?: string; lastSyncAt?: string; lastSyncError?: string; pending: number };
const request = async (path: string, init: RequestInit = {}) => {
  const cfg = readSyncConfig();
  if (!isConfigured(cfg)) throw new Error("Sign in to your Job Hunt OS server first.");
  const r = await fetch(`${apiBase(cfg)}${path}`, { ...init, headers: { ...authHeaders(cfg), "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await r.json().catch(() => ({})) as { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Server returned ${r.status}.`);
  return body;
};
export const getOutlookStatus = () => request("/v1/desktop/outlook/status") as Promise<OutlookConnection>;
export const beginOutlookConnect = async () => (await request("/v1/desktop/outlook/authorize", { method: "POST" }) as { url: string }).url;
export const disconnectOutlook = () => request("/v1/desktop/outlook", { method: "DELETE" });
export const syncOutlookMailbox = async () => request("/v1/desktop/outlook/sync", { method: "POST" }) as Promise<{ fetched: number; added: number; messages: EmailMessage[] }>;
export const acknowledgeOutlook = (ids: string[]) => request("/v1/desktop/outlook/ack", { method: "POST", body: JSON.stringify({ ids }) });
