// Pure change-tracking and merge logic for workspace sync (no browser or React dependencies, so it is unit-tested directly).
import type { AppData } from "./types.js";

export const LIST_COLLECTIONS = ["jobs", "companies", "contacts", "events", "tasks", "notifications", "inbox", "activity", "documents", "credentials", "gate"] as const;
export const SINGLETONS = ["settings", "folders", "vault"] as const;
export const WS_COLLECTIONS = [...LIST_COLLECTIONS, ...SINGLETONS] as const;
export type ListKey = (typeof LIST_COLLECTIONS)[number];
export type WsCollection = (typeof WS_COLLECTIONS)[number];
export type WsChange = { c: WsCollection; id: string; u: number; deleted?: boolean; doc?: Record<string, unknown> };
export type Entry = { h: string; u: number; p: boolean; d?: boolean };
export type Meta = { since: string; items: Record<string, Entry> };
export const EPOCH = "1970-01-01T00:00:00.000Z";
export const newMeta = (): Meta => ({ since: EPOCH, items: {} });

/** JSON with sorted keys and no undefined, so the same item always hashes the same even after a round trip through the server. */
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => stable(x === undefined ? null : x)).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export function hash(s: string) { // cyrb53: tiny, fast, plenty for change detection
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

type Item = { id: string };
type Snap = Map<string, { c: WsCollection; id: string; doc: Record<string, unknown> }>;
/** Every syncable item in the workspace, keyed `collection:id`. */
export function snapshot(d: AppData): Snap {
  const out: Snap = new Map();
  for (const c of LIST_COLLECTIONS) for (const it of (d[c] as unknown as Item[]) ?? []) out.set(`${c}:${it.id}`, { c, id: it.id, doc: it as unknown as Record<string, unknown> });
  out.set("settings:main", { c: "settings", id: "main", doc: d.settings as unknown as Record<string, unknown> });
  out.set("folders:main", { c: "folders", id: "main", doc: { list: d.folders ?? [] } });
  if (d.vault) out.set("vault:meta", { c: "vault", id: "meta", doc: d.vault as unknown as Record<string, unknown> });
  return out;
}

/** Compares the workspace with what we last synced and marks changed/new/removed items as pending. Mutates and returns `meta`. */
export function scan(d: AppData, meta: Meta, now = Date.now()): Meta {
  const snap = snapshot(d);
  for (const [key, it] of snap) {
    const h = hash(stable(it.doc)); const e = meta.items[key];
    if (!e || e.d) meta.items[key] = { h, u: now, p: true };
    else if (e.h !== h) meta.items[key] = { h, u: now, p: true };
  }
  for (const [key, e] of Object.entries(meta.items)) if (!snap.has(key) && !e.d) meta.items[key] = { h: "", u: now, p: true, d: true };
  return meta;
}

/** Merges remote changes into the workspace and records their fingerprints in `meta` so they are not echoed back. */
export function applyRemote(d: AppData, changes: WsChange[], meta: Meta): { data: AppData; applied: number } {
  let data = d; let applied = 0;
  const lists: Partial<Record<ListKey, Item[]>> = {};
  const list = (c: ListKey) => (lists[c] ??= [...((data[c] as unknown as Item[]) ?? [])]);
  for (const ch of changes) {
    const key = `${ch.c}:${ch.id}`; const e = meta.items[key];
    if (e && e.u >= ch.u) continue; // ours is newer or identical
    applied++;
    if (ch.c === "settings" || ch.c === "folders" || ch.c === "vault") {
      if (ch.deleted || !ch.doc) { if (ch.c === "vault") data = { ...data, vault: undefined }; meta.items[key] = { h: "", u: ch.u, p: false, d: true }; continue; }
      if (ch.c === "settings") data = { ...data, settings: { ...data.settings, ...(ch.doc as object) } as AppData["settings"] };
      else if (ch.c === "folders") data = { ...data, folders: (ch.doc.list as string[]) ?? [] };
      else data = { ...data, vault: ch.doc as unknown as AppData["vault"] };
      meta.items[key] = { h: hash(stable(snapshot(data).get(key)!.doc)), u: ch.u, p: false };
      continue;
    }
    const l = list(ch.c); const idx = l.findIndex((x) => x.id === ch.id);
    if (ch.deleted) { if (idx >= 0) l.splice(idx, 1); meta.items[key] = { h: "", u: ch.u, p: false, d: true }; continue; }
    const doc = ch.doc as unknown as Item;
    if (idx >= 0) l[idx] = doc; else l.unshift(doc);
    meta.items[key] = { h: hash(stable(doc)), u: ch.u, p: false };
  }
  if (applied) for (const c of Object.keys(lists) as ListKey[]) data = { ...data, [c]: lists[c] };
  return { data, applied };
}

/** Adds anything an old on-device copy holds that the server has never heard of (including deletions it already knows about stay deleted). */
export function mergeLegacy(d: AppData, legacy: AppData, meta: Meta): AppData {
  let out = d;
  for (const c of LIST_COLLECTIONS) {
    const have = new Set(((out[c] as unknown as Item[]) ?? []).map((x) => x.id));
    const extra = ((legacy[c] as unknown as Item[]) ?? []).filter((x) => !have.has(x.id) && !meta.items[`${c}:${x.id}`]);
    if (extra.length) out = { ...out, [c]: [...((out[c] as unknown as Item[]) ?? []), ...extra] } as AppData;
  }
  if (!meta.items["settings:main"]) out = { ...out, settings: legacy.settings };
  if (!meta.items["folders:main"] && legacy.folders?.length) out = { ...out, folders: legacy.folders };
  if (!meta.items["vault:meta"] && legacy.vault) out = { ...out, vault: legacy.vault };
  return out;
}
