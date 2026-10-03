// GATE (Gather → Assess → Track → Execute) logic for the desktop app. Pure functions over AppData so they are easy to test.
import { deriveFlags, fingerprintInput, levelOf, softKey, type GateEnvelope, type GateStatus } from "@job-hunt-os/contracts";
import type { AppData, CalEvent, GateOpportunity, Job } from "./types";
import { DAY, uid } from "./format";

/* ───────── labels used by the UI ───────── */
export const FLAG_LABEL: Record<string, string> = {
  strong_match: "Strong match", visa_friendly: "Visa friendly", cpt_confirmed: "CPT confirmed", sponsorship_available: "Sponsorship available",
  deadline_soon: "Deadline soon", new_company: "New company", high_compensation: "High pay", remote: "Remote", graduation_exact_match: "Graduation match",
  citizenship_required: "Citizenship required", us_person_required: "US person required", possible_duplicate: "Possible duplicate", source_unverified: "Unverified source",
};
/** flags that are warnings (rendered amber/red) rather than positives */
export const WARN_FLAGS = new Set(["citizenship_required", "us_person_required", "possible_duplicate", "source_unverified", "deadline_soon"]);
export const STATUS_LABEL: Record<GateStatus, string> = { discovered: "New", reviewing: "Reviewing", approved: "Approved", saved_for_later: "Saved for later", dismissed: "Dismissed", expired: "Expired", duplicate: "Duplicate" };
export const PROVIDER_LABEL: Record<string, string> = { company_careers: "Company careers", linkedin: "LinkedIn", indeed: "Indeed", handshake: "Handshake", simplify: "Simplify", ripplematch: "RippleMatch", greenhouse: "Greenhouse", lever: "Lever", workday: "Workday", ashby: "Ashby", ycombinator: "Y Combinator", university_board: "University board", other: "Other" };
export const TRACK_LABEL = (t: string) => t.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
/** needs a decision from the user */
export const isOpen = (g: GateOpportunity) => g.gateStatus === "discovered" || g.gateStatus === "reviewing";

/* ───────── formatting helpers ───────── */
export function locationText(e: GateEnvelope) {
  const { city, state } = e.opportunity.location;
  const place = [city, state].filter(Boolean).join(", ");
  return place || (e.opportunity.work_arrangement === "remote" ? "Remote · US" : e.opportunity.location.country);
}
export function payText(e: GateEnvelope) {
  const c = e.compensation;
  if (!c?.available || (c.min == null && c.max == null)) return "—";
  const money = (n: number) => (c.period === "year" && n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);
  const unit = { hour: "/hr", week: "/wk", month: "/mo", year: "/yr" }[c.period];
  const sym = c.currency === "USD" ? "$" : `${c.currency} `;
  const lo = c.min ?? c.max!;
  const hi = c.max ?? c.min!;
  return lo === hi ? `${sym}${money(lo)}${unit}` : `${sym}${money(lo)}–${money(hi)}${unit}`;
}
export const deadlineOf = (e: GateEnvelope) => (e.opportunity.application.deadline ? Date.parse(e.opportunity.application.deadline) : undefined);
export const levelFor = (e: GateEnvelope) => e.match.level ?? levelOf(e.match.score);
export const flagsFor = (g: GateOpportunity) => deriveFlags(g.envelope, g.receivedAt);

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
    opportunity: { ...old.envelope.opportunity, application: e.opportunity.application, description_summary: e.opportunity.description_summary || old.envelope.opportunity.description_summary },
    compensation: e.compensation ?? old.envelope.compensation,
    eligibility: e.eligibility,
    match: e.match.score ? e.match : old.envelope.match,
    source: { ...e.source, first_seen_at: old.envelope.source.first_seen_at },
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
    const env = "envelope" in it ? it.envelope : it;
    const remoteId = "envelope" in it ? it.remoteId : undefined;
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
  const strong = fresh.filter((g) => levelFor(g.envelope) === "strong").length;
  const cpt = fresh.filter((g) => g.envelope.eligibility.f1.cpt_status === "allowed").length;
  const spons = fresh.filter((g) => g.envelope.eligibility.sponsorship.status === "available").length;
  const review = fresh.filter((g) => g.envelope.agent.decision === "needs_review").length;
  const lines = [`I found ${s.created} new ${s.created === 1 ? "opportunity" : "opportunities"}.`, "", strong && `• ${strong} strong ${strong === 1 ? "match" : "matches"}`, cpt && `• ${cpt} CPT-compatible`, spons && `• ${spons} with sponsorship available`, review && `• ${review} need eligibility review`].filter((x): x is string => typeof x === "string" && x !== "");
  const top = [...fresh].sort((a, b) => b.envelope.match.score - a.envelope.match.score).slice(0, 5);
  let out: AppData = {
    ...d,
    inbox: [{ id: uid(), kind: "research", icon: "sparkle", title: "GATE Scout found new opportunities", preview: `${s.created} new · ${strong} strong ${strong === 1 ? "match" : "matches"} — review them in the GATE Inbox`, body: lines.join("\n"), at: now, read: false, starred: false, gateMatches: top.map((g) => g.id), cta: { label: "Open GATE Inbox", route: "gate" } }, ...d.inbox],
    activity: [{ id: uid(), at: now, icon: "spark", title: "New job matches", subtitle: `${s.created} from GATE Scout` }, ...d.activity].slice(0, 60),
  };
  if (d.settings.notify.agent) {
    const alerts = fresh.flatMap((g) => {
      const e = g.envelope;
      const f = flagsFor(g);
      const out: { title: string; body: string; chip: string }[] = [];
      if (levelFor(e) === "strong") out.push({ title: "Strong match discovered", body: `${e.company.name} · ${e.opportunity.title} (${e.match.score}% match)`, chip: "New" });
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
  const e = g.envelope;
  const dl = deadlineOf(e);
  return {
    id: uid(), company: e.company.name, role: e.opportunity.title, location: locationText(e),
    workMode: ({ remote: "Remote", hybrid: "Hybrid", onsite: "Onsite", unknown: "Onsite" } as const)[e.opportunity.work_arrangement],
    pay: payText(e), track: TRACK_TO_JOB[e.opportunity.track] ?? "Engineering", score: Math.round(e.match.score), status: "saved",
    url: e.opportunity.application.apply_url, addedAt: now, dueAt: dl, dueLabel: dl ? "Due" : undefined, about: e.opportunity.description_summary, notes: "", source: "agent",
    eligibility: { f1: F1[e.eligibility.f1.status], cpt: CPT[e.eligibility.f1.cpt_status], citizen: e.eligibility.citizenship_required, usPerson: e.eligibility.us_person_required, sponsorship: SPONS[e.eligibility.sponsorship.status] },
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
    companies = companies.map((c) => (c.id === existing.id ? { ...c, website: c.website || e.company.website || e.company.careers_url || "", industry: c.industry || e.company.industry || "", hq: c.hq || e.company.headquarters || "" } : c));
  } else {
    companies = [...companies, { id: uid(), name: e.company.name, website: e.company.website ?? e.company.careers_url ?? "", industry: e.company.industry ?? "", size: "", hq: e.company.headquarters ?? "", notes: "" }];
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

/* ───────── seed (sample discoveries so the GATE Inbox is populated on first run) ───────── */
const iso = (ms: number) => new Date(ms).toISOString();
type Sample = { id: string; company: string; site: string; title: string; track: GateEnvelope["opportunity"]["track"]; city: string; state: string; mode: GateEnvelope["opportunity"]["work_arrangement"]; pay?: [number, number]; score: number; deadlineDays?: number; cpt: "allowed" | "likely_allowed" | "unknown" | "not_allowed"; spons: "available" | "unknown" | "not_available"; official: boolean; provider: GateEnvelope["source"]["provider"]; skills: string[]; gaps: string[]; summary: string; foundMinsAgo: number; us?: boolean; citizen?: boolean };
const SAMPLES: Sample[] = [
  { id: "doordash-3536354", company: "DoorDash", site: "doordash.com", title: "Software Engineer Intern - Summer 2027", track: "software_engineering", city: "San Francisco", state: "CA", mode: "hybrid", pay: [50, 60], score: 94, deadlineDays: 13, cpt: "allowed", spons: "unknown", official: true, provider: "company_careers", skills: ["Python", "Java", "SQL", "AWS", "REST APIs", "Git"], gaps: ["Kubernetes production experience"], summary: "Software engineering internship focused on production systems, scalable backend services, APIs, and customer-facing products.", foundMinsAgo: 12 },
  { id: "northstar-4411", company: "Northstar Labs", site: "northstar.dev", title: "Software Engineering Intern", track: "developer_tools", city: "San Francisco", state: "CA", mode: "hybrid", score: 91, deadlineDays: 3, cpt: "likely_allowed", spons: "unknown", official: true, provider: "greenhouse", skills: ["TypeScript", "React", "Node.js", "PostgreSQL"], gaps: ["Distributed tracing"], summary: "Build developer infrastructure used by product teams working across distributed systems.", foundMinsAgo: 40 },
  { id: "atlas-9921", company: "Atlas Cloud", site: "atlascloud.io", title: "Platform Engineering Intern", track: "platform", city: "", state: "", mode: "remote", pay: [42, 48], score: 86, deadlineDays: 20, cpt: "unknown", spons: "available", official: true, provider: "lever", skills: ["AWS", "Python", "Docker", "CI/CD"], gaps: ["Terraform", "Go"], summary: "Work on cloud platform primitives and internal developer experience.", foundMinsAgo: 95 },
  { id: "fjord-2208", company: "Fjord Analytics", site: "fjord.ai", title: "Data Engineering Intern", track: "data_engineering", city: "New York", state: "NY", mode: "hybrid", pay: [38, 44], score: 83, cpt: "allowed", spons: "unknown", official: false, provider: "linkedin", skills: ["SQL", "Python", "ETL"], gaps: ["Airflow", "Spark"], summary: "Shape reliable pipelines for analytics and machine-learning workflows.", foundMinsAgo: 180 },
  { id: "spotify-7710", company: "Spotify", site: "spotify.com", title: "Software Engineering Intern", track: "backend", city: "New York", state: "NY", mode: "hybrid", pay: [44, 52], score: 79, deadlineDays: 9, cpt: "unknown", spons: "unknown", official: true, provider: "company_careers", skills: ["Java", "Python", "SQL"], gaps: ["Kafka", "Scala"], summary: "Build backend features that connect millions of listeners with the music they love.", foundMinsAgo: 260 },
  { id: "arcade-1304", company: "Arcade Systems", site: "arcadesystems.com", title: "Backend Engineering Intern", track: "backend", city: "Austin", state: "TX", mode: "onsite", pay: [36, 42], score: 62, cpt: "not_allowed", spons: "not_available", official: false, provider: "indeed", skills: ["Java", "SQL"], gaps: ["Security clearance", "Citizenship requirement"], summary: "Help build reliable services at the core of a fast-growing defense platform. US persons only.", foundMinsAgo: 400, us: true, citizen: true },
];
export function seedGate(now = Date.now()): GateOpportunity[] {
  return SAMPLES.map((s): GateOpportunity => {
    const found = now - s.foundMinsAgo * 60000;
    const url = `https://careers.${s.site}/jobs/${s.id}`;
    const env: GateEnvelope = {
      event: "gate.opportunity.discovered", schema_version: "1.0",
      search: { watch_id: "summer-2027-software", season: "Summer 2027", country: "US", searched_at: iso(found) },
      opportunity: { external_id: s.id, title: s.title, track: s.track, employment_type: "internship", season: "Summer 2027", location: { city: s.city || null, state: s.state || null, country: "US" }, work_arrangement: s.mode, dates: { duration_weeks: 12 }, application: { status: "open", deadline: s.deadlineDays ? iso(now + s.deadlineDays * DAY) : null, apply_url: url }, description_summary: s.summary },
      company: { name: s.company, website: `https://www.${s.site}`, careers_url: `https://careers.${s.site}`, industry: "Technology", headquarters: s.city ? `${s.city}, ${s.state}` : null },
      match: { score: s.score, level: levelOf(s.score), matching_skills: s.skills, matching_experience: ["Previous software engineering internship", "Full-stack application development"].slice(0, s.score > 80 ? 2 : 1), matching_education: ["Computer Science degree", "Expected May 2028 graduation"], missing_or_unclear: s.gaps, reason: s.score >= 85 ? "Strong overlap across required skills, prior internship experience, and the graduation window." : s.score >= 65 ? "Good skill overlap with a few gaps in the listed requirements." : "Limited overlap and eligibility restrictions that need your review." },
      eligibility: { degree_match: true, graduation_match: s.score >= 65, student_status_match: true, citizenship_required: !!s.citizen, us_person_required: !!s.us, f1: { status: s.cpt === "allowed" ? "eligible" : s.cpt === "not_allowed" ? "not_eligible" : "unknown", cpt_status: s.cpt, opt_status: "unknown" }, sponsorship: { status: s.spons, internship_sponsorship: s.spons, future_sponsorship: "unknown" }, work_authorization_note: s.cpt === "allowed" ? "Posting explicitly states F-1 students may participate using CPT." : undefined },
      compensation: s.pay ? { available: true, min: s.pay[0], max: s.pay[1], currency: "USD", period: "hour" } : { available: false, currency: "USD", period: "hour" },
      source: { provider: s.provider, name: s.official ? `${s.company} Careers` : s.provider === "linkedin" ? "LinkedIn" : "Indeed", url, official: s.official, first_seen_at: iso(found), last_verified_at: iso(found) },
      agent: { name: "GATE Scout", agent_type: "job_discovery", decision: s.us || s.citizen ? "needs_review" : "surface", confidence: Math.min(0.99, s.score / 100 + 0.02), flags: [] },
      metadata: { is_duplicate: false, discovered_at: iso(found), gate_status: "discovered", user_action_required: true },
    };
    return { id: `gate-${s.id}`, gateStatus: "discovered", fingerprint: localFingerprint(env), receivedAt: found, updatedAt: found, seen: s.foundMinsAgo > 200, envelope: env };
  });
}
