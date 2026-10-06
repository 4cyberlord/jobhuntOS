// GATE (Gather → Assess → Track → Execute) logic for the desktop app. Pure functions over AppData so they are easy to test.
import { deriveFlags, FIT_BADGES, fitLevelOf, fingerprintInput, levelOf, softKey, type FitLevel, type GateEnvelope, type GateStatus } from "@job-hunt-os/contracts";
import type { AppData, CalEvent, GateOpportunity, Job } from "./types";
import { DAY, uid } from "./format";

/* ───────── labels used by the UI ───────── */
export const FLAG_LABEL: Record<string, string> = {
  strong_match: "Strong match", visa_friendly: "Visa friendly", cpt_confirmed: "CPT confirmed", sponsorship_available: "Sponsorship available",
  deadline_soon: "Deadline soon", new_company: "New company", high_compensation: "High pay", remote: "Remote", graduation_exact_match: "Graduation match",
  citizenship_required: "Citizenship required", us_person_required: "US person required", possible_duplicate: "Possible duplicate", source_unverified: "Unverified source", official_source: "Official source",
};
/** flags that are warnings (rendered amber/red) rather than positives */
export const WARN_FLAGS = new Set(["citizenship_required", "us_person_required", "possible_duplicate", "source_unverified", "deadline_soon"]);
export const STATUS_LABEL: Record<GateStatus, string> = { discovered: "New", reviewing: "Reviewing", approved: "Approved", saved_for_later: "Saved for later", dismissed: "Dismissed", expired: "Expired", duplicate: "Duplicate" };
export const PROVIDER_LABEL: Record<string, string> = { company_careers: "Company careers", linkedin: "LinkedIn", indeed: "Indeed", handshake: "Handshake", simplify: "Simplify", ripplematch: "RippleMatch", greenhouse: "Greenhouse", lever: "Lever", workday: "Workday", ashby: "Ashby", ycombinator: "Y Combinator", university_board: "University board", other: "Other" };
export const TRACK_LABEL = (t: string) => {
  if (typeof t !== "string" || !t.trim()) return "Not captured";
  return t.split("_").map((w) => w[0] ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
};
/** needs a decision from the user */
export const isOpen = (g: GateOpportunity) => {
  try {
    return g.gateStatus === "discovered" || g.gateStatus === "reviewing";
  } catch {
    return false;
  }
};

/* ───────── formatting helpers ───────── */
export function locationText(e: GateEnvelope) {
  try {
    const loc: unknown = (e as unknown as { opportunity?: { location?: unknown } })?.opportunity?.location;
    const locObj = (loc && typeof loc === "object" ? loc as Record<string, unknown> : {}) as Record<string, unknown>;
    const city = typeof locObj.city === "string" ? locObj.city : undefined;
    const state = typeof locObj.state === "string" ? locObj.state : undefined;
    const country = typeof locObj.country === "string" ? locObj.country : "";
    const place = [city, state].filter(Boolean).join(", ");
    const work = (e as unknown as { opportunity?: { work_arrangement?: unknown } })?.opportunity?.work_arrangement;
    return place || (work === "remote" ? "Remote · US" : country || "—");
  } catch {
    return "—";
  }
}
export function payText(e: GateEnvelope) {
  try {
    const c: unknown = (e as unknown as { compensation?: unknown })?.compensation;
    const comp = c && typeof c === "object" ? c as Record<string, unknown> : null;
    if (!comp || comp.available !== true) return "—";
    const min = typeof comp.min === "number" && Number.isFinite(comp.min) ? comp.min : null;
    const max = typeof comp.max === "number" && Number.isFinite(comp.max) ? comp.max : null;
    if (min == null && max == null) return "—";
    const period = comp.period as string;
    const money = (n: number) => (period === "year" && n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);
    const unit = ({ hour: "/hr", week: "/wk", month: "/mo", year: "/yr" } as Record<string, string>)[period] ?? `/${period ?? "hr"}`;
    const sym = comp.currency === "USD" ? "$" : `${typeof comp.currency === "string" && comp.currency ? comp.currency : "USD"} `;
    const lo = min ?? max!;
    const hi = max ?? min!;
    return lo === hi ? `${sym}${money(lo)}${unit}` : `${sym}${money(lo)}–${money(hi)}${unit}`;
  } catch {
    return "—";
  }
}
export const deadlineOf = (e: GateEnvelope) => {
  try {
    const raw: unknown = (e as unknown as { opportunity?: { application?: { deadline?: unknown } } })?.opportunity?.application?.deadline;
    if (typeof raw !== "string" || !raw.trim()) return undefined;
    const n = Date.parse(raw);
    return Number.isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
};
export const levelFor = (e: GateEnvelope) => {
  try {
    const score = typeof (e as unknown as { match?: { score?: unknown } })?.match?.score === "number" ? (e as unknown as { match: { score: number } }).match.score : 0;
    return (e as unknown as { match?: { level?: unknown } })?.match?.level as ReturnType<typeof levelOf> ?? levelOf(score);
  } catch {
    return levelOf(0);
  }
};
export const fitLevelFor = (e: GateEnvelope): FitLevel => {
  try {
    const m = (e as unknown as { match?: Record<string, unknown> })?.match;
    if (m && typeof m.fit_level === "string" && (FIT_BADGES as Record<string, unknown>)[m.fit_level]) return m.fit_level as FitLevel;
    const score = typeof m?.score === "number" ? m.score as number : 0;
    return fitLevelOf(score);
  } catch {
    return fitLevelOf(0);
  }
};
export const badgeFor = (e: GateEnvelope) => {
  try {
    const m = (e as unknown as { match?: { badge?: unknown } })?.match;
    if (typeof m?.badge === "string" && m.badge.trim()) return m.badge;
    return FIT_BADGES[fitLevelFor(e)];
  } catch {
    return FIT_BADGES.low;
  }
};
export const isPerfectFit = (e: GateEnvelope) => {
  try {
    const m = (e as unknown as { match?: Record<string, unknown> })?.match;
    if (typeof m?.perfect_fit === "boolean") return m.perfect_fit as boolean;
    const score = typeof m?.score === "number" ? m.score as number : 0;
    const missing: unknown = m?.missing;
    if (!Array.isArray(missing)) return score >= 95;
    return score >= 95 && !missing.some((x: unknown) => (x as Record<string, unknown>)?.type === "hard_requirement" && (x as Record<string, unknown>)?.status === "not_satisfied");
  } catch {
    return false;
  }
};
export const flagsFor = (g: GateOpportunity) => {
  try {
    return deriveFlags(g.envelope, g.receivedAt);
  } catch {
    return ["source_unverified"] as ReturnType<typeof deriveFlags>;
  }
};

const similarityWords = (g: GateOpportunity) => {
  try {
    const e = g.envelope as unknown as Record<string, unknown>;
    const facts = e.structured_facts as { technologies?: unknown; required_skills?: unknown; preferred_skills?: unknown } | undefined;
    const tech: string[] = Array.isArray(facts?.technologies) ? (facts!.technologies as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const req: unknown[] = Array.isArray(facts?.required_skills) ? facts!.required_skills as unknown[] : [];
    const pref: unknown[] = Array.isArray(facts?.preferred_skills) ? facts!.preferred_skills as unknown[] : [];
    const matchSkills: unknown = (e.match as Record<string, unknown> | undefined)?.matching_skills;
    const matchList: string[] = Array.isArray(matchSkills) ? (matchSkills as unknown[]).filter((x): x is string => typeof x === "string") : [];
    return new Set([
      ...tech,
      ...req.map((x) => (x as Record<string, unknown>).skill).filter((x): x is string => typeof x === "string"),
      ...pref.map((x) => (x as Record<string, unknown>).skill).filter((x): x is string => typeof x === "string"),
      ...matchList,
    ].map((x) => x.trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set<string>();
  }
};

/** Rank other actionable GATE records using only locally captured facts. */
export function similarGateOpportunities(current: GateOpportunity, all: GateOpportunity[], limit = 5): GateOpportunity[] {
  try {
    const base = similarityWords(current);
    const terminal = new Set<GateStatus>(["dismissed", "expired", "duplicate"]);
    return all.flatMap((candidate) => {
      try {
        if (candidate.id === current.id || terminal.has(candidate.gateStatus)) return [];
        const a = current.envelope as unknown as Record<string, unknown>;
        const b = candidate.envelope as unknown as Record<string, unknown>;
        const aOpp = a.opportunity as Record<string, unknown> | undefined;
        const bOpp = b.opportunity as Record<string, unknown> | undefined;
        const aLoc = aOpp?.location as Record<string, unknown> | undefined;
        const bLoc = bOpp?.location as Record<string, unknown> | undefined;
        const aCompany = a.company as Record<string, unknown> | undefined;
        const bCompany = b.company as Record<string, unknown> | undefined;
        const words = similarityWords(candidate);
        let relevance = aOpp?.track && aOpp.track === bOpp?.track ? 8 : 0;
        const aName = typeof aCompany?.name === "string" ? aCompany.name.toLowerCase() : "";
        const bName = typeof bCompany?.name === "string" ? bCompany.name.toLowerCase() : "";
        if (aName && aName === bName) relevance += 4;
        if (typeof aLoc?.state === "string" && aLoc.state && aLoc.state === bLoc?.state) relevance += 2;
        if (aOpp?.work_arrangement && aOpp.work_arrangement === bOpp?.work_arrangement) relevance += 1;
        relevance += Math.min(6, [...base].filter((x) => words.has(x)).length * 2);
        return relevance > 0 ? [{ candidate, relevance }] : [];
      } catch {
        return [];
      }
    }).sort((a, b) => {
      const aScore = typeof (a.candidate.envelope as unknown as { match?: { score?: unknown } })?.match?.score === "number" ? (a.candidate.envelope as unknown as { match: { score: number } }).match.score : 0;
      const bScore = typeof (b.candidate.envelope as unknown as { match?: { score?: unknown } })?.match?.score === "number" ? (b.candidate.envelope as unknown as { match: { score: number } }).match.score : 0;
      return b.relevance - a.relevance || bScore - aScore || b.candidate.receivedAt - a.candidate.receivedAt;
    }).slice(0, Math.max(0, limit)).map((x) => x.candidate);
  } catch {
    return [];
  }
}

/** Presence checks for optional GATE 2.x layers. Defaults such as `false` and `unknown` are not treated as captured facts. */
export function gateDataAvailability(e: GateEnvelope) {
  try {
    const facts = (e as unknown as { structured_facts?: unknown })?.structured_facts as Record<string, unknown> | undefined;
    const el = (e as unknown as { eligibility?: unknown })?.eligibility as Record<string, unknown> | undefined;
    const f1 = (el?.f1 ?? {}) as Record<string, unknown>;
    const sponsorship = (el?.sponsorship ?? {}) as Record<string, unknown>;
    const match = (e as unknown as { match?: unknown })?.match as Record<string, unknown> | undefined;
    const factBoolean = (value: unknown) => typeof value === "boolean" || (!!value && typeof value === "object" && typeof (value as { value?: unknown }).value === "boolean");
    const elCitizenship = el?.citizenship_required === true;
    const elUsPerson = el?.us_person_required === true;
    const factsEl = (facts?.eligibility ?? {}) as Record<string, unknown>;
    const citizenship = elCitizenship || factBoolean(factsEl.citizenship_required);
    const usPerson = elUsPerson || factBoolean(factsEl.us_person_required);
    const matchSkills = Array.isArray(match?.matching_skills) ? match!.matching_skills as unknown[] : [];
    const matchExp = Array.isArray(match?.matching_experience) ? match!.matching_experience as unknown[] : [];
    const matchEdu = Array.isArray(match?.matching_education) ? match!.matching_education as unknown[] : [];
    const oppDeadline: unknown = (e as unknown as { opportunity?: { application?: { deadline?: unknown } } })?.opportunity?.application?.deadline;
    const hasDeadline = typeof oppDeadline === "string" && !!oppDeadline.trim();
    const hasPosting = typeof (e as unknown as { original_posting?: { raw_description?: unknown } })?.original_posting?.raw_description === "string" && !!(e as unknown as { original_posting: { raw_description: string } }).original_posting.raw_description.trim();
    const hasComp = !!(e as unknown as { compensation?: unknown })?.compensation;
    return {
      assessment: matchSkills.length + matchExp.length + matchEdu.length > 0,
      requiredSkills: Array.isArray(facts?.required_skills) && (facts!.required_skills as unknown[]).length > 0,
      preferredSkills: Array.isArray(facts?.preferred_skills) && (facts!.preferred_skills as unknown[]).length > 0,
      technologies: Array.isArray(facts?.technologies) && (facts!.technologies as unknown[]).length > 0,
      responsibilities: Array.isArray(facts?.responsibilities) && (facts!.responsibilities as unknown[]).length > 0,
      expectedOutcomes: Array.isArray(facts?.expected_outcomes) && (facts!.expected_outcomes as unknown[]).length > 0,
      fullDescription: hasPosting,
      deadline: hasDeadline,
      compensation: hasComp,
      citizenship,
      usPerson,
      eligibility: (el?.degree_match != null) || (el?.graduation_match != null) || (el?.student_status_match != null)
        || citizenship || usPerson || f1.status !== "unknown" || f1.cpt_status !== "unknown"
        || f1.opt_status !== "unknown" || sponsorship.status !== "unknown" || !!(el?.work_authorization_note as string),
    };
  } catch {
    return { assessment: false, requiredSkills: false, preferredSkills: false, technologies: false, responsibilities: false, expectedOutcomes: false, fullDescription: false, deadline: false, compensation: false, citizenship: false, usPerson: false, eligibility: false };
  }
}

/* ───────── hashing (non-cryptographic; only for local identity) ───────── */
function hash(str: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
export const localFingerprint = (e: GateEnvelope) => `local:${hash(fingerprintInput(e))}`;

/* ───────── ingestion with duplicate detection ───────── */
export type IngestItem = GateEnvelope | { envelope: GateEnvelope; remoteId?: string };
export type IngestSummary = { received: number; created: number; duplicates: number; updated: number; discarded: number; existingJobs: number; createdIds: string[] };
const isWrappedIngestItem = (item: IngestItem): item is { envelope: GateEnvelope; remoteId?: string } => {
  const envelope = (item as { envelope?: unknown }).envelope;
  return !!envelope && typeof envelope === "object" && "opportunity" in envelope && "metadata" in envelope;
};

const jobKey = (company: string, title: string) => softKey({ company: { name: company }, opportunity: { title, location: {} } } as never).replace(/\|$/, "");

function findExisting(gate: GateOpportunity[], e: GateEnvelope, fp: string) {
  const soft = softKey(e);
  return gate.find((g) => g.fingerprint === fp
    || (!!e.metadata.fingerprint && g.envelope.metadata.fingerprint === e.metadata.fingerprint)
    || (g.envelope.source.provider === e.source.provider && g.envelope.opportunity.external_id === e.opportunity.external_id)
    || softKey(g.envelope) === soft);
}

/** Facts that may change between sightings. A user's decision (approved/dismissed/saved_for_later) is never downgraded. */
function refresh(old: GateOpportunity, e: GateEnvelope, now: number): GateOpportunity {
  const merged: GateEnvelope = {
    ...old.envelope,
    ...e,
    company: { ...old.envelope.company, website: e.company.website ?? old.envelope.company.website, logo_url: e.company.logo_url ?? old.envelope.company.logo_url },
    opportunity: { ...old.envelope.opportunity, application: e.opportunity.application, description_summary: e.opportunity.description_summary || old.envelope.opportunity.description_summary },
    compensation: e.compensation ?? old.envelope.compensation,
    eligibility: e.eligibility,
    match: e.match,
    source: { ...e.source, first_seen_at: old.envelope.source.first_seen_at },
    metadata: { ...e.metadata, gate_status: old.gateStatus },
  };
  const closed = e.opportunity.application.status === "closed";
  return { ...old, envelope: merged, updatedAt: now, gateStatus: closed && isOpen(old) ? "expired" : old.gateStatus };
}

export function ingest(d: AppData, items: IngestItem[], now = Date.now()): { data: AppData; summary: IngestSummary } {
  const summary: IngestSummary = { received: items.length, created: 0, duplicates: 0, updated: 0, discarded: 0, existingJobs: 0, createdIds: [] };
  let gate = [...d.gate];
  let jobs = d.jobs;
  const fresh: GateOpportunity[] = [];
  for (const it of items) {
    const wrapped = isWrappedIngestItem(it);
    const env = wrapped ? it.envelope : it;
    const remoteId = wrapped ? it.remoteId : undefined;
    if (env.agent.decision === "discard") { summary.discarded++; continue; }
    const fp = env.metadata.fingerprint || localFingerprint(env);
    const known = findExisting(gate, env, fp) ?? findExisting(fresh, env, fp);
    if (known) {
      summary.duplicates++;
      const next = refresh(known, env, now);
      const apply = (list: GateOpportunity[]) => list.map((g) => (g.id === known.id ? { ...next, remoteId: g.remoteId ?? remoteId } : g));
      if (gate.some((g) => g.id === known.id)) gate = apply(gate); else fresh.splice(0, fresh.length, ...apply(fresh));
      summary.updated++;
      if (known.linkedJobId) {
        const dl = deadlineOf(env);
        jobs = jobs.map((j) => (j.id === known.linkedJobId ? { ...j, pay: payText(env) !== "—" ? payText(env) : j.pay, dueAt: dl ?? j.dueAt, gate: j.gate ? { ...j.gate, envelope: next.envelope } : j.gate } : j));
      }
      continue;
    }
    // the same role may already be tracked manually
    const key = jobKey(env.company.name, env.opportunity.title);
    if (jobs.some((j) => jobKey(j.company, j.role) === key)) { summary.existingJobs++; summary.duplicates++; continue; }
    const g: GateOpportunity = { id: uid(), gateStatus: env.metadata.gate_status === "expired" ? "expired" : "discovered", fingerprint: fp, receivedAt: now, updatedAt: now, seen: false, envelope: env, remoteId };
    fresh.push(g);
    summary.created++;
    summary.createdIds.push(g.id);
  }
  let next: AppData = { ...d, gate: [...fresh, ...gate], jobs };
  if (summary.created > 0) next = announce(next, fresh, summary, now);
  return { data: next, summary };
}

/** §18/§19: one summary message in the Agent Inbox plus notifications for urgent findings. */
function announce(d: AppData, fresh: GateOpportunity[], s: IngestSummary, now: number): AppData {
  const perfect = fresh.filter((g) => isPerfectFit(g.envelope)).length;
  const strong = fresh.filter((g) => fitLevelFor(g.envelope) === "strong").length;
  const cpt = fresh.filter((g) => g.envelope.eligibility.f1.cpt_status === "allowed").length;
  const spons = fresh.filter((g) => g.envelope.eligibility.sponsorship.status === "available").length;
  const review = fresh.filter((g) => g.envelope.agent.decision === "needs_review").length;
  const lines = [`I found ${s.created} new ${s.created === 1 ? "opportunity" : "opportunities"}.`, "", perfect && `• ${perfect} perfect ${perfect === 1 ? "fit" : "fits"}`, strong && `• ${strong} strong ${strong === 1 ? "match" : "matches"}`, cpt && `• ${cpt} CPT-compatible`, spons && `• ${spons} with sponsorship available`, review && `• ${review} need eligibility review`].filter((x): x is string => typeof x === "string" && x !== "");
  const top = [...fresh].sort((a, b) => b.envelope.match.score - a.envelope.match.score).slice(0, 5);
  let out: AppData = {
    ...d,
    inbox: [{ id: uid(), kind: "research", icon: "sparkle", title: "GATE Scout found new opportunities", preview: `${s.created} new · ${perfect ? `${perfect} perfect fit${perfect === 1 ? "" : "s"}` : `${strong} strong ${strong === 1 ? "match" : "matches"}`} — review them in the GATE Inbox`, body: lines.join("\n"), at: now, read: false, starred: false, gateMatches: top.map((g) => g.id), cta: { label: "Open GATE Inbox", route: "gate" } }, ...d.inbox],
    activity: [{ id: uid(), at: now, icon: "spark", title: "New job matches", subtitle: `${s.created} from GATE Scout` }, ...d.activity].slice(0, 60),
  };
  if (d.settings.notify.agent) {
    const alerts = fresh.flatMap((g) => {
      const e = g.envelope;
      const f = flagsFor(g);
      const out: { title: string; body: string; chip: string }[] = [];
      if (isPerfectFit(e)) out.push({ title: "Perfect match discovered", body: `${e.company.name} · ${e.opportunity.title} (${e.match.score}% match)`, chip: "Perfect" });
      else if (fitLevelFor(e) === "strong") out.push({ title: "Strong match discovered", body: `${e.company.name} · ${e.opportunity.title} (${e.match.score}% match)`, chip: "New" });
      else if (f.includes("cpt_confirmed")) out.push({ title: "CPT-compatible opportunity discovered", body: `${e.company.name} · ${e.opportunity.title}`, chip: "New" });
      if (f.includes("deadline_soon")) out.push({ title: "Application deadline soon", body: `${e.company.name} closes ${new Date(deadlineOf(e)!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, chip: "Deadline" });
      return out;
    }).slice(0, 4);
    out = { ...out, notifications: [...alerts.map((a) => ({ id: uid(), kind: "match" as const, title: a.title, body: a.body, at: now, read: false, chip: a.chip })), ...out.notifications] };
  }
  return out;
}

/* ───────── decisions ───────── */
export function setStatus(d: AppData, id: string, status: GateStatus, now = Date.now()): AppData {
  return { ...d, gate: d.gate.map((g) => (g.id === id ? { ...g, gateStatus: status, updatedAt: now, seen: true } : g)) };
}

const TRACK_TO_JOB: Record<string, string> = { data_engineering: "Data", analytics_engineering: "Data", ai: "Research", machine_learning: "Research" };
const F1: Record<string, string> = { eligible: "Eligible", likely_eligible: "Likely eligible", not_eligible: "Not eligible", unknown: "Review" };
const CPT: Record<string, string> = { allowed: "Allowed", likely_allowed: "Possible", not_allowed: "Not allowed", unknown: "Unknown" };
const SPONS: Record<string, string> = { available: "Available", not_available: "Not available", not_required: "Not required", unknown: "Not stated" };

export function toJob(g: GateOpportunity, now = Date.now()): Job {
  const rawE = (g.envelope ?? {}) as unknown as Record<string, unknown>;
  const e = rawE as unknown as GateEnvelope;
  const dl = (() => { try { return deadlineOf(e); } catch { return undefined; } })();
  const opp = (rawE.opportunity ?? {}) as Record<string, unknown>;
  const company = (rawE.company ?? {}) as Record<string, unknown>;
  const match = (rawE.match ?? {}) as Record<string, unknown>;
  const elig = (rawE.eligibility ?? {}) as Record<string, unknown>;
  const f1 = (elig.f1 ?? {}) as Record<string, unknown>;
  const spons = (elig.sponsorship ?? {}) as Record<string, unknown>;
  const app = (opp.application ?? {}) as Record<string, unknown>;
  const scoreRaw: unknown = match.score;
  const scoreNum = typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : 0;
  const companyName = typeof company.name === "string" && company.name.trim() ? company.name : "Unknown company";
  const roleTitle = typeof opp.title === "string" && opp.title.trim() ? opp.title : "Untitled opportunity";
  const workArr = typeof opp.work_arrangement === "string" ? opp.work_arrangement : "unknown";
  const track = typeof opp.track === "string" ? opp.track : "other";
  const url = typeof app.apply_url === "string" && app.apply_url.trim() ? app.apply_url : (typeof (rawE.source as Record<string, unknown> | undefined)?.url === "string" ? (rawE.source as Record<string, unknown>).url as string : "");
  const about = typeof opp.description_summary === "string" ? opp.description_summary : "";
  const f1Status = typeof f1.status === "string" ? f1.status : "unknown";
  const cptStatus = typeof f1.cpt_status === "string" ? f1.cpt_status : "unknown";
  const sponsStatus = typeof spons.status === "string" ? spons.status : "unknown";
  return {
    id: uid(), company: companyName, role: roleTitle, location: (() => { try { return locationText(e); } catch { return "—"; } })(),
    workMode: ({ remote: "Remote", hybrid: "Hybrid", onsite: "Onsite", unknown: "Onsite" } as const)[workArr as string] ?? "Onsite",
    pay: (() => { try { return payText(e); } catch { return "—"; } })(), track: TRACK_TO_JOB[track] ?? "Engineering", score: Math.round(scoreNum), status: "saved",
    url, addedAt: now, dueAt: dl, dueLabel: dl ? "Due" : undefined, about, notes: "", source: "agent",
    eligibility: { f1: F1[f1Status] ?? F1.unknown, cpt: CPT[cptStatus] ?? CPT.unknown, citizen: !!elig.citizenship_required, usPerson: !!elig.us_person_required, sponsorship: SPONS[sponsStatus] ?? SPONS.unknown },
    gate: { opportunityId: g.id, envelope: e },
  };
}

/** Approve → Job in Saved, company upsert, deadline event; all discovery metadata stays attached to the job. */
export function approve(d: AppData, id: string, now = Date.now()): { data: AppData; job?: Job; event?: CalEvent } {
  const g = d.gate.find((x) => x.id === id);
  if (!g) return { data: d };
  if (g.linkedJobId && d.jobs.some((j) => j.id === g.linkedJobId)) return { data: setStatus(d, id, "approved", now), job: d.jobs.find((j) => j.id === g.linkedJobId) };
  const job = toJob(g, now);
  const e = g.envelope;
  let companies = d.companies;
  const existing = companies.find((c) => c.name.toLowerCase() === e.company.name.toLowerCase());
  if (existing) {
    companies = companies.map((c) => (c.id === existing.id ? { ...c, website: c.website || e.company.website || e.company.careers_url || "", industry: c.industry || e.company.industry || "", hq: c.hq || e.company.headquarters || "", intelligenceId: c.intelligenceId || e.company.intelligence_id || undefined } : c));
  } else {
    companies = [...companies, { id: uid(), name: e.company.name, website: e.company.website ?? e.company.careers_url ?? "", industry: e.company.industry ?? "", size: "", hq: e.company.headquarters ?? "", notes: "", intelligenceId: e.company.intelligence_id ?? undefined }];
  }
  const dl = deadlineOf(e);
  const event: CalEvent | undefined = dl && dl > now
    ? { id: uid(), title: "Application Deadline", company: e.company.name, kind: "deadline", start: dl - 30 * 60000, end: dl, format: "None", description: `Apply for ${e.opportunity.title}`, notes: "", jobId: job.id, attendees: [], prep: [], link: e.opportunity.application.apply_url }
    : undefined;
  let next: AppData = {
    ...d, companies, jobs: [job, ...d.jobs], events: event ? [...d.events, event] : d.events,
    gate: d.gate.map((x) => (x.id === id ? { ...x, gateStatus: "approved", linkedJobId: job.id, updatedAt: now, seen: true } : x)),
    activity: [{ id: uid(), at: now, icon: "spark", title: "Approved to pipeline", subtitle: `${job.company} · ${job.role}` }, ...d.activity].slice(0, 60),
  };
  return { data: next, job, event };
}

/* ───────── sample data ───────── */
/** The GATE Inbox no longer ships demo discoveries; real ones arrive from the server. These ids belonged to the old first-run
 *  samples, so a one-time cleanup in the store can remove them from installs that already have them. */
export const SAMPLE_GATE_IDS: readonly string[] = ["gate-doordash-3536354", "gate-northstar-4411", "gate-atlas-9921", "gate-fjord-2208", "gate-spotify-7710", "gate-arcade-1304"];
export const seedGate = (): GateOpportunity[] => [];
