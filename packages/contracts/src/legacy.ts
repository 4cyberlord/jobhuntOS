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

/** The first Railway scout emitted a rich, but non-canonical, v1 shape.  It must not be
 * confused with the genuinely slim Telegram relay shape below: doing so discarded most
 * of a discovery record. */
type RichV1 = Record<string, any>;

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

const richString = (value: unknown, max = 5000) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
const richArray = (value: unknown, key: "value" | "skill") => Array.isArray(value) ? value.flatMap((entry) => {
  const text = richString(typeof entry === "string" ? entry : entry?.[key] ?? (key === "skill" ? entry?.name : undefined), key === "value" ? 5000 : 200);
  if (!text) return [];
  const source = typeof entry === "object" && entry ? entry : {};
  return [{ [key]: text, provenance: source.status === "stated" ? "stated" : "inferred", ...(typeof source.confidence === "number" ? { confidence: Math.max(0, Math.min(1, source.confidence)) } : {}) }];
}) : [];
const normalizedTrack = (value: unknown, title: string): Track => {
  const raw = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, Track> = { full_stack_engineering: "full_stack", software_engineering: "software_engineering", frontend_engineering: "frontend", backend_engineering: "backend" };
  return aliases[raw] ?? trackFor(title);
};
const normalizedArrangement = (value: unknown): "remote" | "hybrid" | "onsite" | "unknown" =>
  enumOf(value, ["remote", "hybrid", "onsite", "unknown"] as const, { in_person: "onsite", on_site: "onsite" }) ?? "unknown";
const normalizedStatus = (value: unknown) => value === "open" || value === "closed" || value === "reposted" ? value : "unknown";

/** Preserve the scout's former rich v1 dialect while agents migrate to GATE 2.x.
 * It intentionally runs before legacyToEnvelope; otherwise only name/title/url/score survive. */
export function richV1ToEnvelope(raw: RichV1, opts: LegacyOptions = {}): { ok: true; envelope: GateEnvelope } | { ok: false; error: string } {
  const snapshot = raw.original_posting_snapshot;
  const opp = raw.opportunity;
  if (!snapshot || !opp || typeof snapshot !== "object" || typeof opp !== "object") return { ok: false, error: "not a rich v1 opportunity" };
  const company = raw.company ?? {};
  const title = richString(opp.title, 200), name = richString(company.name, 200);
  const applyUrl = richString(opp.application?.apply_url ?? snapshot.canonical_url, 2000);
  if (!name || !title || !applyUrl || !/^https?:\/\//i.test(applyUrl)) return { ok: false, error: "rich v1 requires company.name, opportunity.title, and an official apply URL" };
  const captured = richString(snapshot.captured_at) ?? (opts.at ?? new Date()).toISOString();
  if (Number.isNaN(Date.parse(captured))) return { ok: false, error: "rich v1 original_posting_snapshot.captured_at must be an ISO timestamp" };
  const location = opp.location ?? {}, timing = opp.timing ?? {}, requirements = opp.requirements ?? {}, comp = opp.compensation ?? {}, eligibility = opp.eligibility ?? {}, match = raw.match ?? {};
  const summary = richString(opp.description_summary, 5000) ?? "";
  const external = richString(opp.external_id, 200) ?? externalIdFor(raw);
  const sourceProvider = richString(snapshot.provider, 200) ?? "Official employer posting";
  const rawDescription = richString(snapshot.raw_description, 100000) ?? summary;
  const fullSnapshot = Boolean(richString(snapshot.raw_description, 100000));
  const canonical = {
    event: "gate.opportunity.discovered", schema_version: "1.0",
    search: { watch_id: opts.watchId ?? "gate-rich-v1-migration", season: richString(opp.season, 60), country: richString(location.country, 60) ?? "US", searched_at: captured },
    opportunity: {
      external_id: external, title, normalized_title: richString(opp.normalized_title, 500), track: normalizedTrack(opp.track, title), employment_type: opp.employment_type === "co_op" || opp.employment_type === "new_grad" || opp.employment_type === "full_time" || opp.employment_type === "part_time" || opp.employment_type === "contract" ? opp.employment_type : "internship", season: richString(opp.season, 60),
      team: { name: richString(opp.team?.name), department: richString(opp.department ?? opp.team?.department), product: richString(opp.product ?? opp.team?.product), reports_to: richString(opp.reports_to ?? opp.team?.reports_to) },
      location: { city: richString(location.city, 100), state: richString(location.state, 100), country: richString(location.country, 60) ?? "US" }, work_arrangement: normalizedArrangement(location.work_arrangement),
      dates: { start: richString(timing.start_date), end: richString(timing.end_date), duration_weeks: typeof timing.duration_weeks === "number" ? timing.duration_weeks : undefined },
      application: { status: normalizedStatus(opp.application?.status), deadline: richString(opp.application?.deadline), apply_url: applyUrl, posted_at: richString(opp.application?.posted_at), materials: opp.application?.materials }, description_summary: summary,
    },
    company: { name, website: richString(company.website, 2000), careers_url: richString(company.careers_url, 2000), logo_url: richString(company.logo_url, 2000), industry: richString(company.industry, 120), headquarters: richString(company.headquarters, 160) },
    match: { score: Math.min(100, Math.max(0, Number(match.score) || 0)), already_satisfies: Array.isArray(match.already_satisfies) ? match.already_satisfies : [], missing: Array.isArray(match.missing) ? match.missing : [], unknown: Array.isArray(match.unknown) ? match.unknown : [], reason: richString(match.reason, 2000) ?? richString(match.technical_fit?.summary, 2000) ?? "", technical_fit: typeof match.technical_fit === "number" ? match.technical_fit : undefined },
    eligibility: { citizenship_required: eligibility.citizenship?.status === "required", us_person_required: eligibility.us_person?.status === "required", f1: { status: enumOf(eligibility.f1?.status, ["eligible", "likely_eligible", "not_eligible", "unknown"] as const) ?? "unknown", cpt_status: enumOf(eligibility.cpt?.status, CPT) ?? "unknown", opt_status: enumOf(eligibility.opt?.status, CPT) ?? "unknown" }, sponsorship: { status: enumOf(eligibility.sponsorship?.status, SPONSOR) ?? "unknown", future_sponsorship: enumOf(eligibility.future_sponsorship?.status, SPONSOR) ?? "unknown" } },
    compensation: { available: typeof comp.min === "number" || typeof comp.max === "number", min: typeof comp.min === "number" ? comp.min : null, max: typeof comp.max === "number" ? comp.max : null, currency: richString(comp.currency, 3) ?? "USD", period: enumOf(comp.period, ["hour", "week", "month", "year"] as const) ?? "hour" },
    source: { provider: providerFor(applyUrl).provider, name: sourceProvider, url: applyUrl, official: snapshot.official_employer_ats === true, first_seen_at: captured, last_verified_at: captured },
    agent: { name: richString(raw.agent?.name, 100) ?? "GATE Scout", agent_type: richString(raw.agent?.agent_type, 60) ?? "job_discovery", decision: "surface", confidence: typeof raw.structured_facts?.confidence === "number" ? raw.structured_facts.confidence : 0.5, flags: [] },
    metadata: { fingerprint: richString(raw.metadata?.fingerprint, 200), is_duplicate: raw.structured_facts?.duplicate_scam_signals?.duplicate === true, discovered_at: captured, gate_status: "discovered", user_action_required: true },
    original_posting: { canonical_url: applyUrl, source_url: applyUrl, source_provider: sourceProvider, official_source: snapshot.official_employer_ats === true, captured_at: captured, posting_status: normalizedStatus(snapshot.posting_status), content_hash: richString(snapshot.content_hash, 200) ?? `migration:${external}`, raw_title: title, raw_description: rawDescription, raw_location: [richString(location.city), richString(location.state)].filter(Boolean).join(", ") || null, snapshot_version: 1, capture_completeness: fullSnapshot ? "full" : "summary_only", recovery_required: !fullSnapshot },
    structured_facts: { responsibilities: richArray(opp.responsibilities, "value"), expected_outcomes: richArray(opp.expected_outcomes, "value"), required_skills: richArray(requirements.required_skills, "skill"), preferred_skills: richArray(requirements.preferred_skills, "skill"), technologies: Array.isArray(requirements.technologies) ? requirements.technologies.filter((x: unknown) => typeof x === "string").slice(0, 200) : [], experience_requirements: { years_of_experience: requirements.years_of_experience }, education: { degree: requirements.degree, major: requirements.major, graduation_range: requirements.graduation_range, enrollment_status: requirements.enrollment_status }, compensation: comp, eligibility, hiring_process: opp.hiring_process ?? {}, contacts: [] },
    gate_assessment: { match: { score: Math.min(100, Math.max(0, Number(match.score) || 0)), reason: richString(match.technical_fit?.summary, 2000) ?? "" }, satisfies: Array.isArray(match.already_satisfies) ? match.already_satisfies : [], missing: Array.isArray(match.missing) ? match.missing : [], unknown: Array.isArray(match.unknown) ? match.unknown : [], supporting_resume_experience: [], recommended_resume: {}, assessment_confidence: typeof raw.structured_facts?.confidence === "number" ? raw.structured_facts.confidence : undefined },
  };
  const parsed = parseGatePayload(canonical);
  return parsed.ok ? { ok: true, envelope: parsed.items[0] } : { ok: false, error: `rich v1 invalid: ${parsed.error}` };
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
  const rich = richV1ToEnvelope((raw ?? {}) as RichV1, opts);
  if (rich.ok) return rich;
  if ("original_posting_snapshot" in ((raw ?? {}) as Record<string, unknown>)) return rich;
  return legacyToEnvelope((raw ?? {}) as LegacyGate, opts);
}
