import { canonicalUrl, levelOf, parseGatePayload, type GateEnvelope, type Track } from "./gate.js";

/* ───────── Relay-era payloads → full GATE envelopes ─────────
 * The Railway worker / Vercel relay send a slimmer JSON than the GATE contract (no external_id, source, search, agent,
 * location is a string), and the 33 backfilled jobs also exist as Telegram text. Both are normalized here so the
 * backend stays the single source of truth and the desktop GATE Inbox can render them like any other discovery.
 */

export type LegacyGate = {
  company?: { name?: string; website?: string | null; careers_url?: string | null; logo_url?: string | null };
  opportunity?: { title?: string; location?: string | { city?: string; state?: string }; work_arrangement?: string; season?: string; application?: { apply_url?: string } };
  match?: { score?: number | string };
  eligibility?: { f1?: { cpt_status?: string }; sponsorship?: { status?: string } };
  metadata?: { fingerprint?: string };
};
export type LegacyOptions = { watchId?: string; at?: Date };

const ATS: Record<string, "ashby" | "greenhouse" | "lever" | "workday"> = { "ashbyhq.com": "ashby", "greenhouse.io": "greenhouse", "lever.co": "lever", "myworkdayjobs.com": "workday" };
const AGGREGATORS: Record<string, "linkedin" | "indeed" | "handshake" | "simplify" | "ripplematch"> = { "linkedin.com": "linkedin", "indeed.com": "indeed", "joinhandshake.com": "handshake", "simplify.jobs": "simplify", "ripplematch.com": "ripplematch" };
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const match = (host: string, table: Record<string, string>) => Object.entries(table).find(([d]) => host === d || host.endsWith(`.${d}`))?.[1];

export function providerFor(applyUrl: string): { provider: GateEnvelope["source"]["provider"]; official: boolean; name: string } {
  const host = hostOf(applyUrl);
  const ats = match(host, ATS); if (ats) return { provider: ats as never, official: true, name: host };
  const agg = match(host, AGGREGATORS); if (agg) return { provider: agg as never, official: false, name: host };
  return { provider: "company_careers", official: true, name: host || "unknown" };
}

export function trackFor(title: string): Track {
  const t = title.toLowerCase();
  const rules: [RegExp, Track][] = [[/front[\s-]?end/, "frontend"], [/back[\s-]?end/, "backend"], [/full[\s-]?stack/, "full_stack"], [/(ios|android|mobile)/, "mobile"], [/machine learning|\bml\b/, "machine_learning"], [/\bai\b|artificial/, "ai"], [/data engineer/, "data_engineering"], [/security/, "security"], [/devops|\bsre\b|reliability/, "devops"], [/infrastructure/, "infrastructure"], [/platform/, "platform"], [/cloud/, "cloud"], [/software|swe\b|engineer|developer/, "software_engineering"]];
  return rules.find(([r]) => r.test(t))?.[1] ?? "other";
}

const enumOf = <T extends string>(raw: unknown, allowed: readonly T[], aliases: Record<string, T> = {}): T | undefined => {
  const k = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (allowed as readonly string[]).includes(k) ? (k as T) : aliases[k];
};
const CPT = ["allowed", "likely_allowed", "not_allowed", "unknown"] as const;
const SPONSOR = ["available", "not_available", "not_required", "unknown"] as const;

function placeOf(loc: unknown): { city?: string; state?: string; remote: boolean; hybrid: boolean } {
  if (loc && typeof loc === "object") { const l = loc as { city?: string; state?: string }; return { city: l.city || undefined, state: l.state || undefined, remote: false, hybrid: false }; }
  const s = String(loc ?? "").trim();
  const remote = /\bremote\b/i.test(s), hybrid = /\bhybrid\b/i.test(s);
  const m = s.replace(/\(.*?\)/g, "").match(/^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\b/);
  return { city: m?.[1], state: m?.[2]?.toUpperCase(), remote, hybrid };
}

/** Small deterministic hash (two seeded 32-bit mixes). Identity only, not security; keeps this package browser-safe. */
function shortHash(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** Stable id that is identical whether the record arrived as JSON or as Telegram text. */
export function externalIdFor(l: LegacyGate): string {
  const fp = l.metadata?.fingerprint?.trim();
  if (fp) return `gate-${fp.replace(/^sha256:/, "").slice(0, 40)}`;
  const basis = [l.company?.name ?? "", l.opportunity?.title ?? "", canonicalUrl(l.opportunity?.application?.apply_url ?? "")].join("|").toLowerCase();
  return `gate-${shortHash(basis)}`;
}

/** Normalize one relay-shaped record. Returns an error string instead of throwing so a batch can report per-item problems. */
export function legacyToEnvelope(l: LegacyGate, opts: LegacyOptions = {}): { ok: true; envelope: GateEnvelope } | { ok: false; error: string } {
  const name = l.company?.name?.trim(), title = l.opportunity?.title?.trim(), applyUrl = l.opportunity?.application?.apply_url?.trim();
  if (!name || !title) return { ok: false, error: "company.name and opportunity.title are required" };
  if (!applyUrl || !/^https?:\/\//i.test(applyUrl)) return { ok: false, error: `${name}: missing or invalid apply_url` };
  const at = (opts.at ?? new Date()).toISOString();
  const place = placeOf(l.opportunity?.location);
  const arr = enumOf(l.opportunity?.work_arrangement, ["remote", "hybrid", "onsite", "unknown"] as const, { on_site: "onsite", in_person: "onsite" }) ?? (place.remote ? "remote" : place.hybrid ? "hybrid" : "unknown");
  const score = Math.min(100, Math.max(0, Number(String(l.match?.score ?? "0").replace(/[^\d.]/g, "")) || 0));
  const season = l.opportunity?.season ?? title.match(/\b(summer|fall|winter|spring)\s+20\d\d\b/i)?.[0];
  const src = providerFor(applyUrl);
  const cpt = enumOf(l.eligibility?.f1?.cpt_status, CPT, { yes: "allowed", no: "not_allowed", likely: "likely_allowed" }) ?? "unknown";
  const spon = enumOf(l.eligibility?.sponsorship?.status, SPONSOR, { yes: "available", no: "not_available" }) ?? "unknown";
  const raw = {
    search: { watch_id: opts.watchId ?? "gate-relay", ...(season ? { season } : {}), country: "US", searched_at: at },
    opportunity: {
      external_id: externalIdFor(l), title, track: trackFor(title), employment_type: /new[\s-]?grad/i.test(title) ? "new_grad" : /co-?op/i.test(title) ? "co_op" : "internship",
      ...(season ? { season } : {}), location: { ...(place.city ? { city: place.city } : {}), ...(place.state ? { state: place.state } : {}), country: "US" }, work_arrangement: arr,
      application: { status: "open", apply_url: applyUrl }, description_summary: "",
    },
    company: { name, ...(l.company?.website && /^https?:\/\//.test(l.company.website) ? { website: l.company.website } : {}), ...(l.company?.logo_url && /^https?:\/\//.test(l.company.logo_url) ? { logo_url: l.company.logo_url } : {}), ...(l.company?.careers_url && /^https?:\/\//.test(l.company.careers_url) ? { careers_url: l.company.careers_url } : {}) },
    match: { score, level: levelOf(score), reason: "Imported from the GATE relay; detailed assessment was not captured." },
    eligibility: { f1: { status: "unknown", cpt_status: cpt, opt_status: "unknown" }, sponsorship: { status: spon } },
    source: { provider: src.provider, name: src.name, url: applyUrl, official: src.official, first_seen_at: at, last_verified_at: at },
    agent: { name: "GATE Scout", agent_type: "job_discovery", decision: "surface", confidence: 0.5, flags: [] },
    metadata: { ...(l.metadata?.fingerprint ? { fingerprint: l.metadata.fingerprint } : {}), is_duplicate: false, discovered_at: at, gate_status: "discovered", user_action_required: true },
  };
  const parsed = parseGatePayload(raw);
  return parsed.ok ? { ok: true, envelope: parsed.items[0] } : { ok: false, error: `${name} — ${title}: ${parsed.error}` };
}

/* ───────── Telegram message text → relay-shaped record ───────── */

/** Telegram Desktop exports `text` as a string or an array of strings / {type,text,href} segments. */
export function flattenTelegramText(text: unknown): string {
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return text.map((seg) => (typeof seg === "string" ? seg : seg && typeof seg === "object" ? [(seg as { text?: string }).text ?? "", (seg as { type?: string; href?: string }).type === "text_link" ? ` ${(seg as { href?: string }).href ?? ""} ` : ""].join("") : "")).join("");
}

/** Parses the message format the relay sends. Returns null for anything that is not a GATE opportunity message. */
export function parseTelegramMessage(raw: string): LegacyGate | null {
  if (!/GATE Opportunity/i.test(raw)) return null;
  const lines = raw.split(/\r?\n/).map((s) => s.trim());
  const body = lines.slice(lines.findIndex((l) => /GATE Opportunity/i.test(l)) + 1).filter(Boolean);
  const plain = body.filter((l) => !/^(📍|🎯|🎓|🛂|💼|🕐|🔗|STACK MATCH|✓|GATE_ID)/u.test(l) && !/^https?:\/\//.test(l));
  const [company, title] = plain;
  if (!company || !title) return null;
  const field = (emoji: string) => body.find((l) => l.startsWith(emoji))?.replace(emoji, "").replace(/^[^:]*:\s*/, "").trim();
  const loc = body.find((l) => l.startsWith("📍"))?.replace("📍", "").trim();
  const apply = raw.match(/https?:\/\/[^\s)>\]]+/)?.[0];
  const gateIdRaw = raw.match(/GATE_ID:\s*([A-Za-z0-9:_-]+)/)?.[1];
  const gateId = gateIdRaw && gateIdRaw.toLowerCase() !== "unknown" ? gateIdRaw : undefined;
  return {
    company: { name: company }, opportunity: { title, location: loc, application: { apply_url: apply } }, match: { score: field("🎯") ?? "0" },
    eligibility: { f1: { cpt_status: field("🎓") }, sponsorship: { status: field("🛂") } }, metadata: gateId ? { fingerprint: gateId } : undefined,
  };
}

/** Accepts whatever the watcher sends: a complete GATE envelope is kept exactly as sent (skills, deadline, pay, reasoning all survive);
 *  only the slimmer relay-era shape goes through the adapter that fills in the missing required fields. */
export function normalizeIncoming(raw: unknown, opts: LegacyOptions = {}): { ok: true; envelope: GateEnvelope } | { ok: false; error: string } {
  const full = parseGatePayload(raw);
  if (full.ok && full.items.length === 1) return { ok: true, envelope: full.items[0] };
  return legacyToEnvelope((raw ?? {}) as LegacyGate, opts);
}
