import { z } from "zod";

/* ───────────────────────── GATE: Gather → Assess → Track → Execute ─────────────────────────
 * The agent (GATE Scout) returns structured opportunities. Job Hunt OS stores them as *discovered* items in the
 * GATE Inbox. Only after the user approves one does it become a Job in the Kanban pipeline.
 * `gate_status` (inbox lifecycle) is deliberately separate from the application stage (Saved → … → Offer).
 */

export const GATE_SCHEMA_VERSION = "1.0";

export const TRACKS = ["software_engineering", "frontend", "backend", "full_stack", "mobile", "cloud", "platform", "infrastructure", "developer_tools", "devops", "security", "ai", "machine_learning", "data_engineering", "analytics_engineering", "geospatial", "other"] as const;
export const WORK_ARRANGEMENTS = ["remote", "hybrid", "onsite", "unknown"] as const;
export const MATCH_LEVELS = ["strong", "moderate", "weak"] as const;
export const F1_STATUSES = ["eligible", "likely_eligible", "not_eligible", "unknown"] as const;
export const CPT_STATUSES = ["allowed", "likely_allowed", "not_allowed", "unknown"] as const;
export const SPONSORSHIP_STATUSES = ["available", "not_available", "not_required", "unknown"] as const;
export const SOURCE_PROVIDERS = ["company_careers", "linkedin", "indeed", "handshake", "simplify", "ripplematch", "greenhouse", "lever", "workday", "ashby", "ycombinator", "university_board", "other"] as const;
export const AGENT_DECISIONS = ["surface", "discard", "needs_review", "duplicate", "expired"] as const;
export const AGENT_FLAGS = ["strong_match", "visa_friendly", "cpt_confirmed", "sponsorship_available", "deadline_soon", "new_company", "high_compensation", "remote", "graduation_exact_match", "citizenship_required", "us_person_required", "possible_duplicate", "source_unverified"] as const;
export const GATE_STATUSES = ["discovered", "reviewing", "approved", "saved_for_later", "dismissed", "expired", "duplicate"] as const;
export const POSTING_STATUSES = ["open", "closed", "reposted", "unknown"] as const;

export type Track = (typeof TRACKS)[number];
export type GateStatus = (typeof GATE_STATUSES)[number];
export type AgentFlag = (typeof AGENT_FLAGS)[number];

const iso = z.string().datetime({ offset: true });
const url = z.string().url();
const text = (max: number) => z.string().max(max);

const search = z.object({
  watch_id: text(100),
  season: text(60).optional(),
  country: text(60).default("US"),
  searched_at: iso,
});

const opportunity = z.object({
  external_id: z.string().min(3).max(200),
  title: z.string().min(1).max(200),
  track: z.enum(TRACKS).default("other"),
  employment_type: z.enum(["internship", "co_op", "new_grad", "full_time", "part_time", "contract"]).default("internship"),
  season: text(60).optional(),
  location: z.object({ city: text(100).nullish(), state: text(100).nullish(), country: text(60).default("US") }).default({ country: "US" }),
  work_arrangement: z.enum(WORK_ARRANGEMENTS).default("unknown"),
  dates: z.object({ start: iso.nullish(), end: iso.nullish(), duration_weeks: z.number().int().positive().max(104).nullish() }).default({}),
  application: z.object({ status: z.enum(POSTING_STATUSES).default("open"), deadline: iso.nullish(), apply_url: url }),
  description_summary: text(5000).default(""),
});

const company = z.object({
  name: z.string().min(1).max(200),
  website: url.nullish(),
  careers_url: url.nullish(),
  logo_url: url.nullish(),
  industry: text(120).nullish(),
  headquarters: text(160).nullish(),
});

const match = z.object({
  score: z.number().min(0).max(100),
  level: z.enum(MATCH_LEVELS).optional(),
  matching_skills: z.array(text(100)).max(50).default([]),
  matching_experience: z.array(text(300)).max(50).default([]),
  matching_education: z.array(text(300)).max(20).default([]),
  missing_or_unclear: z.array(text(200)).max(50).default([]),
  reason: text(2000).default(""),
});

const eligibility = z.object({
  degree_match: z.boolean().nullish(),
  graduation_match: z.boolean().nullish(),
  student_status_match: z.boolean().nullish(),
  citizenship_required: z.boolean().default(false),
  us_person_required: z.boolean().default(false),
  f1: z.object({ status: z.enum(F1_STATUSES).default("unknown"), cpt_status: z.enum(CPT_STATUSES).default("unknown"), opt_status: z.enum(CPT_STATUSES).default("unknown") }).default({ status: "unknown", cpt_status: "unknown", opt_status: "unknown" }),
  sponsorship: z.object({ status: z.enum(SPONSORSHIP_STATUSES).default("unknown"), internship_sponsorship: z.enum(SPONSORSHIP_STATUSES).optional(), future_sponsorship: z.enum(SPONSORSHIP_STATUSES).optional() }).default({ status: "unknown" }),
  work_authorization_note: text(1000).optional(),
});

const compensation = z.object({
  available: z.boolean().default(false),
  min: z.number().nonnegative().nullish(),
  max: z.number().nonnegative().nullish(),
  currency: z.string().length(3).default("USD"),
  period: z.enum(["hour", "week", "month", "year"]).default("hour"),
});

const source = z.object({
  provider: z.enum(SOURCE_PROVIDERS).default("other"),
  name: text(200),
  url,
  official: z.boolean().default(false),
  first_seen_at: iso,
  last_verified_at: iso,
});

const agent = z.object({
  name: text(100).default("GATE Scout"),
  agent_type: text(60).default("job_discovery"),
  decision: z.enum(AGENT_DECISIONS).default("surface"),
  confidence: z.number().min(0).max(1).default(0.5),
  flags: z.array(z.enum(AGENT_FLAGS)).max(20).default([]),
});

const metadata = z.object({
  fingerprint: text(200).optional(),
  is_duplicate: z.boolean().default(false),
  discovered_at: iso,
  gate_status: z.enum(GATE_STATUSES).default("discovered"),
  user_action_required: z.boolean().default(true),
});

/** One discovered opportunity as returned by the agent. */
export const gateEnvelopeSchema = z.object({
  event: z.literal("gate.opportunity.discovered").default("gate.opportunity.discovered"),
  schema_version: z.string().default(GATE_SCHEMA_VERSION),
  search,
  opportunity,
  company,
  match,
  eligibility: eligibility.default(eligibility.parse({})),
  compensation: compensation.nullish(),
  source,
  agent: agent.default(agent.parse({})),
  metadata,
});
export type GateEnvelope = z.infer<typeof gateEnvelopeSchema>;

/** A batch from one hourly run: shared `search`, many results. */
export const gateResultSchema = gateEnvelopeSchema.omit({ event: true, schema_version: true, search: true });
export const gateBatchSchema = z.object({
  event: z.literal("gate.opportunity.batch").default("gate.opportunity.batch"),
  schema_version: z.string().default(GATE_SCHEMA_VERSION),
  search,
  results: z.array(gateResultSchema).min(1).max(100),
});
export type GateBatch = z.infer<typeof gateBatchSchema>;

/** Expand a batch into individual envelopes. */
export function expandBatch(batch: GateBatch): GateEnvelope[] {
  return batch.results.map((r) => ({ ...r, event: "gate.opportunity.discovered" as const, schema_version: batch.schema_version, search: batch.search }));
}

/** Accepts either a single envelope or a batch (used by the desktop JSON importer and the API). */
export function parseGatePayload(input: unknown): { ok: true; items: GateEnvelope[] } | { ok: false; error: string } {
  const isBatch = !!input && typeof input === "object" && Array.isArray((input as { results?: unknown }).results);
  const parsed = isBatch ? gateBatchSchema.safeParse(input) : gateEnvelopeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
  return { ok: true, items: isBatch ? expandBatch(parsed.data as GateBatch) : [parsed.data as GateEnvelope] };
}

/* ───────── duplicate detection ───────── */
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const STRIP_TITLE = /\b(summer|fall|winter|spring)\b|\b20\d\d\b|\b(intern|internship)\b/g;
/** Canonical URL: lower-case host without www, no query/hash, no trailing slash. Tracking params never affect identity. */
export function canonicalUrl(u: string): string {
  try {
    const p = new URL(u);
    return `${p.hostname.replace(/^www\./, "").toLowerCase()}${p.pathname.replace(/\/+$/, "")}`;
  } catch {
    return u.toLowerCase().trim();
  }
}
/** Stable identity string: company + normalized title + canonical apply URL. Hash it with SHA-256 where available. */
export function fingerprintInput(item: Pick<GateEnvelope, "company" | "opportunity">): string {
  return [norm(item.company.name), norm(item.opportunity.title).replace(STRIP_TITLE, "").replace(/\s+/g, " ").trim(), canonicalUrl(item.opportunity.application.apply_url)].join("|");
}
/** Looser key to catch the same role re-posted on another URL. */
export function softKey(item: Pick<GateEnvelope, "company" | "opportunity">): string {
  return [norm(item.company.name), norm(item.opportunity.title), norm(item.opportunity.location.city ?? "")].join("|");
}

/** Derive flags the agent may have omitted, so the UI is consistent. */
export function deriveFlags(item: GateEnvelope, now = Date.now()): AgentFlag[] {
  const f = new Set<AgentFlag>(item.agent.flags);
  if (item.match.score >= 85) f.add("strong_match");
  if (item.eligibility.f1.cpt_status === "allowed") f.add("cpt_confirmed");
  if (item.eligibility.sponsorship.status === "available") f.add("sponsorship_available");
  if (item.eligibility.citizenship_required) f.add("citizenship_required");
  if (item.eligibility.us_person_required) f.add("us_person_required");
  if (item.opportunity.work_arrangement === "remote") f.add("remote");
  const d = item.opportunity.application.deadline;
  if (d) {
    const ms = Date.parse(d) - now;
    if (ms > 0 && ms <= 4 * 86_400_000) f.add("deadline_soon");
  }
  if (!item.source.official) f.add("source_unverified");
  return [...f];
}
export function levelOf(score: number) {
  return score >= 85 ? "strong" : score >= 65 ? "moderate" : "weak";
}
