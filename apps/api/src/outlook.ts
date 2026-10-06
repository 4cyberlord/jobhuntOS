/** Server-owned Microsoft Graph mailbox connection. No OAuth credential reaches the desktop. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { database } from "./repository.js";

const CONNECTION = "owner";
const SCOPES = "openid profile offline_access User.Read Mail.Read Files.ReadWrite";
type Token = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
export type OutlookMessage = { id: string; internetMessageId?: string; conversationId?: string; subject: string; from?: { emailAddress: { address: string; name?: string } }; sender?: { emailAddress: { address: string; name?: string } }; receivedDateTime: string; bodyPreview?: string; body?: { contentType: string; content: string }; headers?: { name: string; value: string }[] };

function config() {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI;
  const key = process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !key) throw new Error("Outlook integration is not configured on the server.");
  const raw = /^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
  if (raw.length !== 32) throw new Error("OUTLOOK_TOKEN_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex characters.");
  return { clientId, clientSecret, redirectUri, key: raw };
}
function seal(value: string) { const c = config(); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", c.key, iv); const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`; }
function unseal(value: string) { const c = config(); const [iv, tag, body] = value.split("."); if (!iv || !tag || !body) throw new Error("Stored Outlook token is invalid."); const d = createDecipheriv("aes-256-gcm", c.key, Buffer.from(iv, "base64url")); d.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8"); }
const microsoft = (path: string) => `https://login.microsoftonline.com/common/oauth2/v2.0/${path}`;

export async function outlookStatus() {
  const row = await (await database()).collection<any>("outlook_connections").findOne({ _id: CONNECTION });
  return { configured: configured(), connected: !!row?.refreshToken, email: row?.email as string | undefined, lastSyncAt: row?.lastSyncAt instanceof Date ? row.lastSyncAt.toISOString() : undefined, lastSyncError: row?.lastSyncError as string | undefined, pending: await (await database()).collection<any>("outlook_queue").countDocuments({ connection: CONNECTION, acknowledgedAt: null }) };
}
const configured = () => !!(process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET && process.env.OUTLOOK_REDIRECT_URI && process.env.OUTLOOK_TOKEN_ENCRYPTION_KEY);

export async function beginOutlookAuthorization() {
  const c = config(); const state = randomBytes(32).toString("base64url");
  const d = await database();
  await d.collection<any>("outlook_oauth_states").insertOne({ _id: state, expiresAt: new Date(Date.now() + 10 * 60_000) });
  const q = new URLSearchParams({ client_id: c.clientId, response_type: "code", redirect_uri: c.redirectUri, response_mode: "query", scope: SCOPES, state, prompt: "select_account" });
  return { url: `${microsoft("authorize")}?${q}` };
}

async function exchange(params: URLSearchParams) {
  const c = config(); params.set("client_id", c.clientId); params.set("client_secret", c.clientSecret); params.set("redirect_uri", c.redirectUri);
  const r = await fetch(microsoft("token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
  const j = await r.json().catch(() => ({})) as Token & { error_description?: string };
  if (!r.ok) throw new Error(j.error_description ?? `Microsoft token exchange failed (${r.status}).`);
  return j;
}
export async function graphAccess() {
  const d = await database(); const c = d.collection<any>("outlook_connections"); const row = await c.findOne({ _id: CONNECTION });
  if (!row?.refreshToken) throw new Error("Outlook is not connected.");
  if (row.accessToken && row.accessExpiresAt instanceof Date && row.accessExpiresAt.getTime() > Date.now() + 60_000) return { token: unseal(row.accessToken), row };
  const fresh = await exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: unseal(row.refreshToken), scope: SCOPES }));
  await c.updateOne({ _id: CONNECTION }, { $set: { accessToken: seal(fresh.access_token), accessExpiresAt: new Date(Date.now() + Math.max(60, fresh.expires_in - 60) * 1000), ...(fresh.refresh_token ? { refreshToken: seal(fresh.refresh_token) } : {}), updatedAt: new Date() } });
  return { token: fresh.access_token, row: await c.findOne({ _id: CONNECTION }) };
}
export async function completeOutlookAuthorization(code: string, state: string) {
  const d = await database(); const stateRow = await d.collection<any>("outlook_oauth_states").findOneAndDelete({ _id: state, expiresAt: { $gt: new Date() } });
  if (!stateRow) throw new Error("The Outlook connection link expired. Return to Settings and try again.");
  const t = await exchange(new URLSearchParams({ grant_type: "authorization_code", code }));
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${t.access_token}` } });
  const profile = await me.json().catch(() => ({})) as { mail?: string; userPrincipalName?: string };
  await d.collection<any>("outlook_connections").updateOne({ _id: CONNECTION }, { $set: { refreshToken: seal(t.refresh_token ?? ""), accessToken: seal(t.access_token), accessExpiresAt: new Date(Date.now() + Math.max(60, t.expires_in - 60) * 1000), email: profile.mail ?? profile.userPrincipalName, connectedAt: new Date(), lastSyncError: null, updatedAt: new Date() } }, { upsert: true });
}
export async function disconnectOutlook() { const d = await database(); await Promise.all([d.collection<any>("outlook_connections").deleteOne({ _id: CONNECTION }), d.collection<any>("outlook_queue").deleteMany({ connection: CONNECTION })]); }

/** Poll one Graph delta page; transient queue stores text until processed, then immediately deleted. */
export async function pollOutlookInbox() {
  const { token, row } = await graphAccess(); const cursor = row?.deltaLink as string | undefined;
  const path = cursor ?? "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=50&$select=id,internetMessageId,conversationId,subject,from,sender,receivedDateTime,bodyPreview,body";
  const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(r.status === 429 ? "Microsoft is rate limiting mailbox sync. Try again shortly." : `Microsoft Graph returned ${r.status}.`);
  const page = await r.json() as { value?: (OutlookMessage & { "@removed"?: unknown })[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
  const d = await database(); const q = d.collection<any>("outlook_queue"); let added = 0;
  for (const m of page.value ?? []) {
    if (!m.id || m["@removed"]) continue;
    try { await q.insertOne({ _id: `${CONNECTION}:${m.id}`, connection: CONNECTION, message: m, fetchedAt: new Date(), acknowledgedAt: null, expiresAt: new Date(Date.now() + 24 * 3600_000) }); added++; } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; }
  }
  await d.collection<any>("outlook_connections").updateOne({ _id: CONNECTION }, { $set: { deltaLink: page["@odata.deltaLink"] ?? page["@odata.nextLink"] ?? cursor, lastSyncAt: new Date(), lastSyncError: null } });
  return { fetched: (page.value ?? []).length, added };
}
export async function markOutlookSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await (await database()).collection<any>("outlook_connections").updateOne({ _id: CONNECTION }, { $set: { lastSyncError: message, lastSyncAt: new Date() } });
}
export async function queuedOutlookMessages() { return (await (await database()).collection<any>("outlook_queue").find({ connection: CONNECTION, acknowledgedAt: null }).sort({ fetchedAt: 1 }).limit(100).toArray()).map((x) => x.message as OutlookMessage); }
export async function acknowledgeOutlookMessages(ids: string[]) {
  if (!ids.length) return;
  // Option 1: Immediately delete acknowledged messages from DB so raw emails are never permanently stored
  await (await database()).collection<any>("outlook_queue").deleteMany({ _id: { $in: ids.map((id) => `${CONNECTION}:${id}`) } });
}
