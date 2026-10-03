import { companyDomains, evidencedDomains, homepageMatchesCompany, type LogoHints } from "@job-hunt-os/contracts";

const UA = "Mozilla/5.0 (compatible; JobHuntOS/1.0; company-site-verifier)";
const MAX_BYTES = 150_000;
const MAX_CANDIDATES = 6;
/** Only ordinary public hostnames are ever fetched: no IP literals, no internal-looking names. */
const publicHost = (d: string) => !/^\d+(\.\d+){3}$/.test(d) && !/\.(local|internal|localhost|lan|home)$/.test(d) && d !== "localhost";

/** First ~150 KB of a homepage, or null if it is unreachable, not HTML, or errors. Never throws. */
async function homepage(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://${domain}/`, { redirect: "follow", signal: AbortSignal.timeout(4500), headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" } });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "") || !res.body) return null;
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (size < MAX_BYTES) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); size += value.length; }
    await reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks).toString("utf8");
  } catch { return null; }
}

/** The company's real website, or undefined when no candidate's homepage verifiably names the company. */
export async function resolveWebsite(name: string, hints: LogoHints = {}): Promise<string | undefined> {
  // The data itself vouches for this domain (a given website, or an apply link on the company's own domain): no fetch needed.
  // This also covers sites that return 403 to scripts (Coinbase, DoorDash...).
  const evidenced = evidencedDomains(name, hints).filter(publicHost)[0];
  if (evidenced) return `https://${evidenced}`;
  const candidates = companyDomains(name, hints).filter(publicHost).slice(0, MAX_CANDIDATES);
  const pages = await Promise.all(candidates.map(homepage)); // in parallel, but the earliest (most trustworthy) verified domain wins
  const hit = candidates.find((_, i) => pages[i] !== null && homepageMatchesCompany(pages[i]!, name));
  return hit ? `https://${hit}` : undefined;
}
