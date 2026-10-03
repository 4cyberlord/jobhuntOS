// Company logos, in priority order:
//   1. the logo URL that came with the record (GATE Scout's `company.logo_url`), used directly;
//   2. the icon of the company's verified website (saved by the server, typed in, or on an apply link at the company's own domain);
//   3. an initial tile.
// A guessed domain is never used here, so a namesake's brand cannot appear. Everything loads through <img> and is cached.
import { useEffect, useState, useSyncExternalStore } from "react";
import { companyKey, evidencedDomains, logoSources, type LogoHints } from "@job-hunt-os/contracts";

/* ───────── what we know about each company ───────── */
const websites = new Map<string, string>();
const logoUrls = new Map<string, string>();
const listeners = new Set<() => void>();
const register = (map: Map<string, string>) => (pairs: [string, string | null | undefined][]) => {
  let changed = false;
  for (const [name, value] of pairs) {
    if (!name || !value) continue;
    const k = companyKey(name);
    if (k && map.get(k) !== value) { map.set(k, value); changed = true; }
  }
  if (changed) listeners.forEach((f) => f());
};
/** Called by the store whenever records change, so every Logo in the app benefits from what any record knows. */
export const registerWebsites = register(websites);
export const registerLogoUrls = register(logoUrls);
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/* ───────── cache: domain -> working icon URL, or a recent miss ───────── */
const KEY = "jhos.logo.v2";
const MISS_MS = 3 * 86_400_000;
type Hit = { url: string } | { miss: number };
let cache: Record<string, Hit> | undefined;
const load = () => (cache ??= (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } })());
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const remember = (domain: string, hit: Hit) => {
  load()[domain] = hit;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ } }, 400);
};

/** True only if the image loads AND is a real icon (>= 32px); Google answers unknown sites with a 16px globe. */
const probe = (url: string) => new Promise<boolean>((resolve) => {
  const img = new Image();
  const done = (ok: boolean) => { clearTimeout(timer); img.onload = img.onerror = null; resolve(ok); };
  const timer = setTimeout(() => done(false), 7000);
  img.referrerPolicy = "no-referrer";
  img.onload = () => done(img.naturalWidth >= 32);
  img.onerror = () => done(false);
  img.src = url;
});

const inflight = new Map<string, Promise<string | null>>();
async function resolveDomain(domain: string): Promise<string | null> {
  const known = load()[domain];
  if (known && "url" in known) return known.url;
  if (known && Date.now() - known.miss < MISS_MS) return null;
  let p = inflight.get(domain);
  if (!p) {
    p = (async () => {
      for (const src of logoSources(domain)) if (await probe(src)) { remember(domain, { url: src }); return src; }
      remember(domain, { miss: Date.now() });
      return null;
    })().finally(() => inflight.delete(domain));
    inflight.set(domain, p);
  }
  return p;
}

const isImageUrl = (u?: string | null): u is string => !!u && /^https:\/\//i.test(u);

/** Candidate logo URLs for a company, best first. The first is available immediately when the record supplied one. */
export function useLogoCandidates(name: string, hints: (LogoHints & { logoUrl?: string | null }) | undefined, enabled: boolean): string[] {
  const supplied = useSyncExternalStore(subscribe, () => logoUrls.get(companyKey(name)));
  const known = useSyncExternalStore(subscribe, () => websites.get(companyKey(name)));
  const direct = enabled && isImageUrl(hints?.logoUrl || supplied) ? (hints?.logoUrl || supplied)! : undefined;
  const domains = enabled ? evidencedDomains(name, { website: hints?.website || known, applyUrl: hints?.applyUrl }) : [];
  const sig = domains.join(",");
  const [probed, setProbed] = useState<string | undefined>(() => { const d = domains[0] && load()[domains[0]]; return d && "url" in d ? d.url : undefined; });
  useEffect(() => {
    let live = true;
    setProbed(undefined);
    (async () => { for (const d of sig ? sig.split(",") : []) { const u = await resolveDomain(d); if (!live) return; if (u) return setProbed(u); } })();
    return () => { live = false; };
  }, [sig]);
  return [direct, probed].filter((u, i, a): u is string => !!u && a.indexOf(u) === i);
}
