// Document file storage on your server (chunked: each request stays under the hosting body cap). Metadata lives in the workspace.
// A per-session cache avoids re-downloading a file you just opened; nothing is written to the device.
import { apiBase, authHeaders, isConfigured, readSyncConfig } from "./syncConfig";

const CHUNK = 3 * 1024 * 1024;
const cache = new Map<string, Blob>();

async function call(path: string, init: RequestInit = {}) {
  const c = readSyncConfig();
  if (!isConfigured(c)) throw new Error("Not connected to your server.");
  const res = await fetch(`${apiBase(c)}/v1/desktop/files/${path}`, { ...init, headers: { ...authHeaders(c), ...(init.headers as Record<string, string> | undefined) } });
  if (!res.ok && res.status !== 404) throw new Error(res.status === 401 ? "The sync key was rejected (401)." : `Server returned ${res.status}.`);
  return res;
}
const id = (key: string) => encodeURIComponent(key);

export async function putFile(key: string, blob: Blob) {
  const chunks = Math.max(1, Math.ceil(blob.size / CHUNK));
  for (let n = 0; n < chunks; n++) {
    await call(`${id(key)}/${n}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: blob.slice(n * CHUNK, (n + 1) * CHUNK) });
  }
  await call(`${id(key)}/commit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chunks, size: blob.size, mime: blob.type || "application/octet-stream" }) });
  cache.set(key, blob);
}
export async function getFile(key: string): Promise<Blob | undefined> {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = await call(id(key));
  if (m.status === 404) return undefined;
  const meta = (await m.json()) as { chunks: number; mime: string };
  const parts: ArrayBuffer[] = [];
  for (let n = 0; n < meta.chunks; n++) {
    const r = await call(`${id(key)}/${n}`);
    if (r.status === 404) return undefined;
    parts.push(await r.arrayBuffer());
  }
  const blob = new Blob(parts, { type: meta.mime });
  cache.set(key, blob);
  return blob;
}
export async function deleteFile(key: string) {
  cache.delete(key);
  await call(id(key), { method: "DELETE" });
}
