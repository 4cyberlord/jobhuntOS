// One-time upgrade path: earlier versions kept everything on this device (localStorage + IndexedDB). On first connect that data is
// merged into the server, then removed from the device. Nothing here is used once the device is clean.
import type { AppData } from "./types";
import { emptyData, seed, stripSampleData } from "./seed";
import { SAMPLE_GATE_IDS } from "./gate";
import { putFile } from "./filedb";

const DATA_KEY = "jhos.data.v2";
const VAULT_KEY = "jhos.vault.meta";
const IDB = "jhos-files";

export function readLegacyData(): AppData | null {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) { const v = JSON.parse(localStorage.getItem(VAULT_KEY) ?? "null"); return v?.salt ? { ...emptyData(), vault: v } : null; }
    const parsed = JSON.parse(raw) as AppData;
    if (!parsed.gate) parsed.jobs = (parsed.jobs ?? []).filter((j) => !(j.status === "pending_review" && /^j[1-5]$/.test(j.id)));
    const merged = { ...seed(), ...parsed, settings: { ...seed().settings, ...parsed.settings } } as AppData;
    merged.gate = (merged.gate ?? []).filter((g) => !(SAMPLE_GATE_IDS.includes(g.id) && g.gateStatus === "discovered" && !g.linkedJobId && !g.remoteId));
    try { const v = JSON.parse(localStorage.getItem(VAULT_KEY) ?? "null"); if (v?.salt && v?.verifier) merged.vault = v; } catch { /* no vault */ }
    return stripSampleData(merged);
  } catch { return null; }
}
export const hasLegacy = () => { try { return localStorage.getItem(DATA_KEY) !== null || localStorage.getItem(VAULT_KEY) !== null; } catch { return false; } };

function legacyBlob(key: string): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(undefined);
    const req = indexedDB.open(IDB, 1);
    req.onupgradeneeded = () => { req.transaction?.abort(); resolve(undefined); }; // database did not exist: nothing to migrate
    req.onerror = () => resolve(undefined);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const g = db.transaction("blobs", "readonly").objectStore("blobs").get(key);
        g.onsuccess = () => { db.close(); resolve(g.result as Blob | undefined); };
        g.onerror = () => { db.close(); resolve(undefined); };
      } catch { db.close(); resolve(undefined); }
    };
  });
}
/** Uploads every locally stored document file. Throws if one cannot be uploaded so the local copy is kept. */
export async function uploadLegacyFiles(d: AppData, skip: (key: string) => boolean = () => false) {
  for (const doc of d.documents) {
    if (!doc.hasFile) continue;
    for (const v of doc.versions) {
      const key = `${doc.id}:${v.id}`;
      if (skip(key)) continue;
      const blob = await legacyBlob(key);
      if (blob) await putFile(key, blob);
    }
  }
}
export function clearLegacy() {
  try { localStorage.removeItem(DATA_KEY); localStorage.removeItem(VAULT_KEY); localStorage.removeItem("jhos.ws.meta"); } catch { /* storage unavailable */ }
  try { if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(IDB); } catch { /* ignore */ }
}
