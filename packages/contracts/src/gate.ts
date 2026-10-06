import { z } from "zod";

/* ───────────────────────── GATE: Gather → Assess → Track → Execute ─────────────────────────
 * The agent (GATE Scout) returns structured opportunities. Job Hunt OS stores them as *discovered* items in the
 * GATE Inbox. Only after the user approves one does it become a Job in the Kanban pipeline.
 * `gate_status` (inbox lifecycle) is deliberately separate from the application stage (Saved → … → Offer).
 */

export const GATE_SCHEMA_VERSION = "1.0";
export const GATE_SCHEMA_V2 = "2.0";

export const TRACKS = ["software_engineering", "frontend", "backend", "full_stack", "mobile", "cloud", "platform", "infrastructure", "developer_tools", "devops", "security", "ai", "machine_learning", "data_engineering", "analytics_engineering", "geospatial", "other"] as const;
export const WORK_ARRANGEMENTS = ["remote", "hybrid", "onsite", "unknown"] as const;
export const MATCH_LEVELS = ["strong", "moderate", "weak"] as const;
export const FIT_LEVELS = ["perfect", "strong", "good", "partial", "low"] as const;
export const F1_STATUSES = ["eligible", "likely_eligible", "not_eligible", "unknown"] as const;
export const CPT_STATUSES = ["allowed", "likely_allowed", "not_allowed", "unknown"] as const;
export const SPONSORSHIP_STATUSES = ["available", "not_available", "not_required", "unknown"] as const;
export const SOURCE_PROVIDERS = ["company_careers", "linkedin", "indeed", "handshake", "simplify", "ripplematch", "greenhouse", "lever", "workday", "ashby", "ycombinator", "university_board", "other"] as const;
export const AGENT_DECISIONS = ["surface", "discard", "needs_review", "duplicate", "expired"] as const;
export const AGENT_FLAGS = ["strong_match", "visa_friendly", "cpt_confirmed", "sponsorship_available", "deadline_soon", "new_company", "high_compensation", "remote", "graduation_exact_match", "citizenship_required", "us_person_required", "possible_duplicate", "source_unverified", "official_source"] as const;
export const GATE_STATUSES = ["discovered", "reviewing", "approved", "saved_for_later", "dismissed", "expired", "duplicate"] as const;
export const POSTING_STATUSES = ["open", "closed", "reposted", "unknown"] as const;

export type Track = (typeof TRACKS)[number];
export type GateStatus = (typeof GATE_STATUSES)[number];
export type AgentFlag = (typeof AGENT_FLAGS)[number];
export type FitLevel = (typeof FIT_LEVELS)[number];

export function levelOf(score: number): (typeof MATCH_LEVELS)[number] {
  return score >= 85 ? "strong" : score >= 65 ? "moderate" : "weak";
}
export function fitLevelOf(score: number): FitLevel {
  return score >= 95 ? "perfect" : score >= 85 ? "strong" : score >= 70 ? "good" : score >= 50 ? "partial" : "low";
}
export const FIT_BADGES: Record<FitLevel, string> = { perfect: "PERFECT MATCH", strong: "STRONG MATCH", good: "GOOD MATCH", partial: "PARTIAL MATCH", low: "LOW MATCH" };

const iso = z.string().datetime({ offset: true });
const url = z.string().url();
const text = (max: number) => z.string().max(max);

const search = z.object({
  watch_id: text(100),
  season: text(60).optional(),
  country: text(60).default("US"),
  searched_at: iso,
}).passthrough();

const opportunity = z.object({
  external_id: z.string().min(3).max(200),
  title: z.string().min(1).max(200),
  track: z.enum(TRACKS).default("other"),
  employment_type: z.enum(["internship", "co_op", "new_grad", "full_time", "part_time", "contract"]).default("internship"),
  season: text(60).optional(),
  location: z.object({ city: text(100).nullish(), state: text(100).nullish(), country: text(60).default("US") }).passthrough().default({ country: "US" }),
  work_arrangement: z.enum(WORK_ARRANGEMENTS).default("unknown"),
  dates: z.object({ start: iso.nullish(), end: iso.nullish(), duration_weeks: z.number().int().positive().max(104).nullish() }).passthrough().default({}),
  application: z.object({ status: z.enum(POSTING_STATUSES).default("open"), deadline: iso.nullish(), apply_url: url }).passthrough(),
  description_summary: text(5000).default(""),
}).passthrough();

const company = z.object({
  name: z.string().min(1).max(200),
  website: url.nullish(),
  careers_url: url.nullish(),
  logo_url: url.nullish(),
  industry: text(120).nullish(),
  headquarters: text(160).nullish(),
}).passthrough();

const satisfiedRequirement = z.object({ requirement: text(500), evidence: text(2000).nullish(), profile_evidence: text(2000).nullish(), confidence: z.number().min(0).max(1).optional() }).passthrough();
const missingRequirement = z.object({ requirement: text(500), type: text(80).optional(), status: text(80).optional(), reason: text(2000).nullish(), severity: text(50).optional() }).passthrough();
const unknownRequirement = z.object({ field: text(200), reason: text(2000).nullish(), manual_confirmation_needed: z.boolean().optional() }).passthrough();
const eligibilityRisk = z.object({ level: text(50).default("unknown"), reason: text(2000).nullish() }).passthrough();

const matchInput = z.object({
  score: z.number().min(0).max(100),
  level: z.enum([...MATCH_LEVELS, ...FIT_LEVELS]).optional(),
  fit_level: z.enum(FIT_LEVELS).optional(),
  perfect_fit: z.boolean().optional(),
  badge: text(50).optional(),
  already_satisfies: z.array(satisfiedRequirement).max(100).default([]),
  missing: z.array(missingRequirement).max(100).default([]),
  unknown: z.array(unknownRequirement).max(100).default([]),
  supporting_evidence: z.array(text(2000)).max(100).default([]),
  recommended_resume_emphasis: z.array(text(500)).max(100).default([]),
  eligibility_risk: eligibilityRisk.default({ level: "unknown", reason: null }),
  matching_skills: z.array(text(100)).max(50).default([]),
  matching_experience: z.array(text(300)).max(50).default([]),
  matching_education: z.array(text(300)).max(20).default([]),
  missing_or_unclear: z.array(text(200)).max(50).default([]),
  reason: text(2000).default(""),
}).passthrough();

const match = matchInput.transform((m) => {
  const fit_level = fitLevelOf(m.score);
  const hardMismatch = m.missing.some((x) => x.type === "hard_requirement" && x.status === "not_satisfied");
  const satisfies = m.already_satisfies.map((x) => x.requirement);
  return {
    ...m,
    level: levelOf(m.score),
    fit_level,
    badge: FIT_BADGES[fit_level],
    perfect_fit: m.score >= 95 && !hardMismatch,
    matching_skills: m.matching_skills.length ? m.matching_skills : satisfies.slice(0, 50).map((x) => x.slice(0, 100)),
    matching_experience: m.matching_experience.length ? m.matching_experience : m.supporting_evidence.slice(0, 50).map((x) => x.slice(0, 300)),
    missing_or_unclear: m.missing_or_unclear.length ? m.missing_or_unclear : m.missing.slice(0, 50).map((x) => [x.requirement, x.reason].filter(Boolean).join(" — ").slice(0, 200)),
  };
});

const eligibility = z.object({
  degree_match: z.boolean().nullish(),
  graduation_match: z.boolean().nullish(),
  student_status_match: z.boolean().nullish(),
  citizenship_required: z.boolean().default(false),
  us_person_required: z.boolean().default(false),
  f1: z.object({ status: z.enum(F1_STATUSES).default("unknown"), cpt_status: z.enum(CPT_STATUSES).default("unknown"), opt_status: z.enum(CPT_STATUSES).default("unknown") }).default({ status: "unknown", cpt_status: "unknown", opt_status: "unknown" }),
  cpt: z.object({ status: z.enum(CPT_STATUSES).default("unknown") }).passthrough().optional(),
  opt: z.object({ status: z.enum(CPT_STATUSES).default("unknown") }).passthrough().optional(),
  sponsorship: z.object({ status: z.enum(SPONSORSHIP_STATUSES).default("unknown"), internship_sponsorship: z.enum(SPONSORSHIP_STATUSES).optional(), future_sponsorship: z.enum(SPONSORSHIP_STATUSES).optional() }).default({ status: "unknown" }),
  // Unknown/not-stated source facts are represented as null by GATE 2.x producers.
  work_authorization_note: text(1000).nullish(),
}).passthrough().transform((e) => ({ ...e, f1: { ...e.f1, cpt_status: e.cpt?.status ?? e.f1.cpt_status, opt_status: e.opt?.status ?? e.f1.opt_status } }));

const compensation = z.object({
  available: z.boolean().default(false),
  min: z.number().nonnegative().nullish(),
  max: z.number().nonnegative().nullish(),
  currency: z.string().length(3).default("USD"),
  period: z.enum(["hour", "week", "month", "year"]).default("hour"),
}).passthrough();

const source = z.object({
  provider: z.enum(SOURCE_PROVIDERS).default("other"),
  name: text(200),
  url,
  official: z.boolean().default(false),
  first_seen_at: iso,
  last_verified_at: iso,
}).passthrough();

const agent = z.object({
  name: text(100).default("GATE Scout"),
  agent_type: text(60).default("job_discovery"),
  decision: z.enum(AGENT_DECISIONS).default("surface"),
  confidence: z.number().min(0).max(1).default(0.5),
  flags: z.array(z.enum(AGENT_FLAGS)).max(20).default([]),
}).passthrough();

const metadata = z.object({
  fingerprint: text(200).optional(),
  is_duplicate: z.boolean().default(false),
  discovered_at: iso,
  gate_status: z.enum(GATE_STATUSES).default("discovered"),
  user_action_required: z.boolean().default(true),
}).passthrough();

/* GATE 2.x keeps the source posting, extracted facts and personalized assessment separate.
 * These schemas validate the fields the app consumes and deliberately retain additional watcher fields so a newer
 * watcher can add facts without an older desktop silently deleting them during sync. */
const provenance = z.enum(["stated", "inferred", "unknown"]);
const evidence = z.object({ provenance: provenance.optional(), confidence: z.number().min(0).max(1).optional(), evidence: text(5000).nullish() }).passthrough();
const responsibility = evidence.extend({ value: text(5000) }).passthrough();
// Some official postings express a requirement as a full sentence. Preserve it
// as source-derived evidence instead of rejecting the entire opportunity.
const skillFact = evidence.extend({ skill: text(5000) }).passthrough();

export const originalPostingSchema = z.object({
  canonical_url: url,
  source_url: url,
  source_provider: text(200),
  official_source: z.boolean().default(false),
  captured_at: iso,
  posting_status: z.enum(POSTING_STATUSES).default("unknown"),
  content_hash: text(200),
  raw_title: text(500),
  raw_description: text(100_000),
  raw_location: text(500).nullish(),
  snapshot_version: z.number().int().positive().default(1),
}).passthrough();

export const structuredFactsSchema = z.object({
  responsibilities: z.array(responsibility).max(100).default([]),
  expected_outcomes: z.array(responsibility).max(100).default([]),
  required_skills: z.array(skillFact).max(100).default([]),
  preferred_skills: z.array(skillFact).max(100).default([]),
  technologies: z.array(text(200)).max(200).default([]),
  experience_requirements: z.record(z.string(), z.unknown()).default({}),
  education: z.record(z.string(), z.unknown()).default({}),
  compensation: z.record(z.string(), z.unknown()).default({}),
  eligibility: z.record(z.string(), z.unknown()).default({}),
  hiring_process: z.record(z.string(), z.unknown()).default({}),
  contacts: z.array(z.record(z.string(), z.unknown())).max(50).default([]),
}).passthrough();

export const gateAssessmentSchema = z.object({
  match: matchInput.extend({
    technical_fit: z.number().min(0).max(100).optional(), eligibility_fit: z.number().min(0).max(100).optional(),
    experience_fit: z.number().min(0).max(100).optional(), education_fit: z.number().min(0).max(100).optional(),
  }),
  satisfies: z.array(satisfiedRequirement).max(100).default([]),
  missing: z.array(missingRequirement).max(100).default([]),
  unknown: z.array(unknownRequirement).max(100).default([]),
  supporting_resume_experience: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
  recommended_resume: z.record(z.string(), z.unknown()).default({}),
  recommended_next_action: text(2000).nullish(),
  urgency: z.string().max(50).nullish(), urgency_reason: text(2000).nullish(),
  eligibility_risk: z.string().max(50).nullish(), eligibility_risk_reason: text(2000).nullish(),
  assessment_confidence: z.number().min(0).max(1).optional(),
}).passthrough();

const identityV2 = z.object({
  gate_opportunity_id: z.string().max(200).nullish(), fingerprint: text(500), external_job_id: text(300).nullish(),
  is_duplicate: z.boolean().default(false), duplicate_of: z.string().max(500).nullish(), record_type: z.string().max(100).default("new"),
}).passthrough();
const postingVersion = z.object({
  version: z.number().int().positive(), captured_at: iso, content_hash: text(200), raw_description: text(100_000),
  changes: z.array(text(1000)).max(100).optional(),
}).passthrough();

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
  identity: identityV2.optional(),
  original_posting: originalPostingSchema.optional(),
  posting_versions: z.array(postingVersion).max(20).optional(),
  structured_facts: structuredFactsSchema.optional(),
  gate_assessment: gateAssessmentSchema.optional(),
  risk: z.record(z.string(), z.unknown()).optional(),
  change_history: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
}).passthrough();
export type GateEnvelope = z.infer<typeof gateEnvelopeSchema>;
export type OriginalPosting = z.infer<typeof originalPostingSchema>;
export type StructuredFacts = z.infer<typeof structuredFactsSchema>;
export type GateAssessment = z.infer<typeof gateAssessmentSchema>;

const opportunityV2 = z.object({
  title: z.string().min(1).max(500), normalized_title: text(500).optional(), track: z.enum(TRACKS).default("other"),
  employment_type: z.enum(["internship", "co_op", "new_grad", "full_time", "part_time", "contract"]).default("internship"), season: text(100).optional(),
  team: z.record(z.string(), z.unknown()).optional(),
  location: z.object({
    cities: z.array(text(200)).max(20).default([]), states: z.array(text(100)).max(20).default([]), country: text(100).default("US"),
    work_arrangement: z.enum([...WORK_ARRANGEMENTS, "in_person"]).default("unknown"), office_days_per_week: z.number().min(0).max(7).nullish(),
    timezone_requirements: z.unknown().optional(), location_restrictions: z.array(text(500)).max(50).default([]),
    travel_required: z.boolean().nullish(), travel_percent: z.number().min(0).max(100).nullish(), relocation_required: z.boolean().nullish(),
  }).passthrough(),
  internship: z.object({ start_date: z.string().nullish(), end_date: z.string().nullish(), duration_weeks: z.number().int().positive().max(104).nullish(), weekly_hours: z.number().positive().max(168).nullish() }).passthrough().optional(),
  application: z.object({
    status: z.enum(POSTING_STATUSES).default("open"), posted_at: z.string().nullish(), deadline: z.string().nullish(),
    apply_url: url, materials: z.record(z.string(), z.unknown()).optional(), questions_or_instructions: z.array(z.unknown()).max(100).optional(),
  }).passthrough(),
  description_summary: text(5000).optional(),
}).passthrough();

const gateEnvelopeV2Schema = z.object({
  event: z.literal("gate.opportunity.discovered").default("gate.opportunity.discovered"), schema_version: z.string().regex(/^2\./),
  identity: identityV2,
  search,
  original_posting: originalPostingSchema,
  posting_versions: z.array(postingVersion).max(20).optional(),
  company,
  opportunity: opportunityV2,
  structured_facts: structuredFactsSchema,
  gate_assessment: gateAssessmentSchema,
  match: matchInput.optional(),
  source: z.object({ first_seen_at: iso, last_verified_at: iso, source_quality: z.string().max(100).optional(), verification_status: z.string().max(100).optional(), evidence_urls: z.array(url).max(50).default([]) }).passthrough(),
  risk: z.record(z.string(), z.unknown()).default({}),
  change_history: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
  agent: agent.default(agent.parse({})),
  metadata: z.object({ gate_status: z.enum(GATE_STATUSES).default("discovered"), discovered_at: iso, user_action_required: z.boolean().default(true) }).passthrough(),
}).passthrough();

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

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const scalar = (v: unknown): unknown => { const o = object(v); return o.value ?? o.status ?? v; };
const bool = (v: unknown): boolean | null => typeof scalar(v) === "boolean" ? scalar(v) as boolean : null;
const string = (v: unknown): string | undefined => typeof scalar(v) === "string" ? scalar(v) as string : undefined;
const enumValue = <T extends readonly string[]>(v: unknown, values: T, fallback: T[number]): T[number] => values.includes(string(v) ?? "") ? string(v) as T[number] : fallback;
const dateTime = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const ms = Date.parse(v); return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
};
const providerOf = (label: string, sourceUrl: string, official: boolean): (typeof SOURCE_PROVIDERS)[number] => {
  const haystack = `${label} ${sourceUrl}`.toLowerCase();
  const named = SOURCE_PROVIDERS.find((p) => p !== "other" && haystack.includes(p.replace("company_careers", "company")));
  return named ?? (official ? "company_careers" : "other");
};

/** Convert the richer 2.x wire shape into the stable fields used by the current app, while retaining every 2.x layer. */
function normalizeV2(v: z.infer<typeof gateEnvelopeV2Schema>): GateEnvelope {
  const facts = v.structured_facts;
  const assessment = v.gate_assessment;
  const assessedMatch = v.match ?? assessment.match;
  const rawEligibility = object(facts.eligibility);
  const rawF1 = object(rawEligibility.f1);
  const rawCpt = object(rawEligibility.cpt);
  const rawOpt = object(rawEligibility.opt);
  const rawSponsorship = object(rawEligibility.sponsorship);
  const rawCompensation = object(facts.compensation);
  const education = object(facts.education);
  const exactAuthorization = Array.isArray(rawEligibility.exact_work_authorization_language)
    ? rawEligibility.exact_work_authorization_language.filter((x): x is string => typeof x === "string").join(" ").slice(0, 1000)
    : undefined;
  const matchingEducation = assessment.satisfies.filter((x) => /degree|graduat|student|education|university|college/i.test(x.requirement));
  const matchingOther = assessment.satisfies.filter((x) => !matchingEducation.includes(x));
  const resumeEvidence = assessment.supporting_resume_experience.flatMap((entry) => {
    const role = typeof entry.project_or_role === "string" ? entry.project_or_role : "Résumé evidence";
    const supports = Array.isArray(entry.supports) ? entry.supports.filter((x): x is string => typeof x === "string") : [];
    return supports.length ? [`${role}: ${supports.join(", ")}`.slice(0, 2000)] : [];
  }).slice(0, 100);
  const recommendedResume = object(assessment.recommended_resume);
  const resumeEmphasis = Array.isArray(recommendedResume.emphasis)
    ? recommendedResume.emphasis.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 500)).slice(0, 100)
    : [];
  const sourceUrl = v.original_posting.source_url;
  const firstSeen = v.source.first_seen_at ?? v.original_posting.captured_at;
  const deadline = dateTime(v.opportunity.application.deadline);
  const start = dateTime(v.opportunity.internship?.start_date);
  const end = dateTime(v.opportunity.internship?.end_date);
  const description = v.opportunity.description_summary
    ?? facts.responsibilities.slice(0, 8).map((x) => x.value).join(" ").slice(0, 5000);
  const reason = string((assessedMatch as Record<string, unknown>).reason)
    ?? `GATE assessed this as a ${fitLevelOf(assessedMatch.score)} match.`;
  const external = (v.identity.external_job_id || v.identity.fingerprint || v.original_posting.content_hash).slice(0, 200);
  const sponsorship = enumValue(rawSponsorship.status ?? rawSponsorship.internship, SPONSORSHIP_STATUSES, "unknown");
  const period = enumValue(rawCompensation.period, ["hour", "week", "month", "year"] as const, "hour");
  const amount = (x: unknown) => typeof scalar(x) === "number" && Number(scalar(x)) >= 0 ? Number(scalar(x)) : null;
  const currency = string(rawCompensation.currency)?.toUpperCase();
  const workArrangement = v.opportunity.location.work_arrangement === "in_person" ? "onsite" : v.opportunity.location.work_arrangement;
  return gateEnvelopeSchema.parse({
    ...v,
    event: "gate.opportunity.discovered",
    schema_version: v.schema_version,
    search: v.search,
    opportunity: {
      ...v.opportunity,
      external_id: external.length >= 3 ? external : `v2-${external}`,
      title: v.opportunity.title.slice(0, 200), track: v.opportunity.track, employment_type: v.opportunity.employment_type,
      season: v.opportunity.season?.slice(0, 60),
      location: { ...v.opportunity.location, work_arrangement: workArrangement, city: v.opportunity.location.cities[0]?.slice(0, 100), state: v.opportunity.location.states[0]?.slice(0, 100), country: v.opportunity.location.country.slice(0, 60) },
      work_arrangement: workArrangement,
      dates: { ...v.opportunity.internship, start, end, duration_weeks: v.opportunity.internship?.duration_weeks },
      application: { ...v.opportunity.application, status: v.opportunity.application.status, deadline, apply_url: v.opportunity.application.apply_url },
      description_summary: description,
    },
    company: v.company,
    match: {
      ...assessedMatch,
      score: assessedMatch.score, level: assessedMatch.level,
      already_satisfies: assessedMatch.already_satisfies.length ? assessedMatch.already_satisfies : assessment.satisfies,
      missing: assessedMatch.missing.length ? assessedMatch.missing : assessment.missing,
      unknown: assessedMatch.unknown.length ? assessedMatch.unknown : assessment.unknown,
      supporting_evidence: assessedMatch.supporting_evidence.length ? assessedMatch.supporting_evidence : resumeEvidence,
      recommended_resume_emphasis: assessedMatch.recommended_resume_emphasis.length ? assessedMatch.recommended_resume_emphasis : resumeEmphasis,
      eligibility_risk: assessedMatch.eligibility_risk.level !== "unknown" || assessedMatch.eligibility_risk.reason
        ? assessedMatch.eligibility_risk
        : { level: assessment.eligibility_risk ?? "unknown", reason: assessment.eligibility_risk_reason ?? null },
      matching_skills: assessedMatch.matching_skills,
      matching_experience: assessedMatch.matching_experience.length ? assessedMatch.matching_experience : [
        ...matchingOther.map((x) => [x.requirement, x.profile_evidence].filter(Boolean).join(" — ").slice(0, 300)),
        ...resumeEvidence.map((x) => x.slice(0, 300)),
      ].slice(0, 50),
      matching_education: matchingEducation.map((x) => [x.requirement, x.profile_evidence].filter(Boolean).join(" — ").slice(0, 300)),
      missing_or_unclear: assessment.missing.map((x) => [x.requirement, x.reason].filter(Boolean).join(" — ").slice(0, 200)).slice(0, 50),
      reason: reason.slice(0, 2000),
    },
    eligibility: {
      degree_match: bool(education.degree_match), graduation_match: bool(education.graduation_match), student_status_match: bool(education.student_status_match),
      citizenship_required: bool(rawEligibility.citizenship_required) ?? false, us_person_required: bool(rawEligibility.us_person_required) ?? false,
      f1: {
        status: enumValue(rawF1.status ?? rawEligibility.f1, F1_STATUSES, "unknown"),
        cpt_status: enumValue(rawCpt.status ?? rawEligibility.cpt, CPT_STATUSES, "unknown"),
        opt_status: enumValue(rawOpt.status ?? rawEligibility.opt, CPT_STATUSES, "unknown"),
      },
      sponsorship: { status: sponsorship, internship_sponsorship: enumValue(rawSponsorship.internship, SPONSORSHIP_STATUSES, sponsorship), future_sponsorship: enumValue(rawSponsorship.future, SPONSORSHIP_STATUSES, "unknown") },
      work_authorization_note: exactAuthorization,
    },
    compensation: {
      available: bool(rawCompensation.available) ?? (amount(rawCompensation.min) !== null || amount(rawCompensation.max) !== null),
      min: amount(rawCompensation.min), max: amount(rawCompensation.max), currency: currency?.length === 3 ? currency : "USD", period,
    },
    source: {
      ...v.source,
      provider: providerOf(v.original_posting.source_provider, sourceUrl, v.original_posting.official_source),
      name: v.original_posting.source_provider.slice(0, 200), url: sourceUrl, official: v.original_posting.official_source,
      first_seen_at: firstSeen, last_verified_at: v.source.last_verified_at,
    },
    agent: v.agent,
    metadata: {
      ...v.metadata, fingerprint: v.identity.fingerprint.slice(0, 200), is_duplicate: v.identity.is_duplicate,
      discovered_at: v.metadata.discovered_at, gate_status: v.metadata.gate_status, user_action_required: v.metadata.user_action_required,
    },
  });
}

/** Accepts either a single envelope or a batch (used by the desktop JSON importer and the API). */
export type GatePayloadError = { index: number; error: string };
export type ParsedGatePayload = {
  ok: true;
  items: GateEnvelope[];
  indexedItems: { index: number; item: GateEnvelope }[];
  errors: GatePayloadError[];
  received: number;
  isBatch: boolean;
} | {
  ok: false;
  error: string;
  errors?: GatePayloadError[];
  received?: number;
  isBatch?: boolean;
};

export function parseGatePayload(input: unknown): ParsedGatePayload {
  const issue = (e: z.ZodError) => e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  const one = (raw: unknown): { ok: true; item: GateEnvelope } | { ok: false; error: string } => {
    const version = object(raw).schema_version;
    if (typeof version === "string" && version.startsWith("2.")) {
      const parsed = gateEnvelopeV2Schema.safeParse(raw);
      if (parsed.success) return { ok: true, item: normalizeV2(parsed.data) };
      const stable = gateEnvelopeSchema.safeParse(raw);
      return stable.success ? { ok: true, item: stable.data } : { ok: false, error: issue(parsed.error) };
    }
    const parsed = gateEnvelopeSchema.safeParse(raw);
    return parsed.success ? { ok: true, item: parsed.data } : { ok: false, error: issue(parsed.error) };
  };
  const root = object(input);
  const hasResults = Array.isArray(root.results);
  const hasOpportunities = Array.isArray(root.opportunities);
  if (hasResults && hasOpportunities) return { ok: false, error: "batch: send either results or opportunities, not both", isBatch: true };
  if (hasResults || hasOpportunities) {
    const field = hasOpportunities ? "opportunities" : "results";
    const records = (hasOpportunities ? root.opportunities : root.results) as unknown[];
    if (records.length < 1 || records.length > 100) return { ok: false, error: `${field}: send 1-100 opportunities`, received: records.length, isBatch: true };
    const indexedItems: { index: number; item: GateEnvelope }[] = [];
    const errors: GatePayloadError[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = object(records[i]);
      const parsed = one({
        ...record,
        event: record.event ?? "gate.opportunity.discovered",
        schema_version: record.schema_version ?? root.schema_version ?? GATE_SCHEMA_VERSION,
        search: record.search ?? root.search,
      });
      if (parsed.ok) indexedItems.push({ index: i, item: parsed.item });
      else errors.push({ index: i, error: parsed.error });
    }
    if (!indexedItems.length) return { ok: false, error: errors.map((e) => `${field}.${e.index}: ${e.error}`).join("; "), errors, received: records.length, isBatch: true };
    return { ok: true, items: indexedItems.map((x) => x.item), indexedItems, errors, received: records.length, isBatch: true };
  }
  const parsed = one(input);
  return parsed.ok
    ? { ok: true, items: [parsed.item], indexedItems: [{ index: 0, item: parsed.item }], errors: [], received: 1, isBatch: false }
    : parsed;
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

/** Derive flags the agent may have omitted, so the UI is consistent. Tolerates partial historical envelopes. */
export function deriveFlags(item: GateEnvelope, now = Date.now()): AgentFlag[] {
  try {
    const rawFlags: unknown = (item as unknown as { agent?: { flags?: unknown } })?.agent?.flags;
    const f = new Set<AgentFlag>(Array.isArray(rawFlags) ? (rawFlags as AgentFlag[]) : []);
    const score = typeof (item as unknown as { match?: { score?: unknown } })?.match?.score === "number" ? (item as unknown as { match: { score: number } }).match.score : 0;
    if (score >= 85) f.add("strong_match");
    const cpt = (item as unknown as { eligibility?: { f1?: { cpt_status?: unknown } } })?.eligibility?.f1?.cpt_status;
    if (cpt === "allowed") f.add("cpt_confirmed");
    const sponsorship = (item as unknown as { eligibility?: { sponsorship?: { status?: unknown } } })?.eligibility?.sponsorship?.status;
    if (sponsorship === "available") f.add("sponsorship_available");
    if ((item as unknown as { eligibility?: { citizenship_required?: unknown } })?.eligibility?.citizenship_required) f.add("citizenship_required");
    if ((item as unknown as { eligibility?: { us_person_required?: unknown } })?.eligibility?.us_person_required) f.add("us_person_required");
    if ((item as unknown as { opportunity?: { work_arrangement?: unknown } })?.opportunity?.work_arrangement === "remote") f.add("remote");
    const d: unknown = (item as unknown as { opportunity?: { application?: { deadline?: unknown } } })?.opportunity?.application?.deadline;
    if (typeof d === "string" && d) {
      const ms = Date.parse(d) - now;
      if (!Number.isNaN(ms) && ms > 0 && ms <= 4 * 86_400_000) f.add("deadline_soon");
    }
    if (!(item as unknown as { source?: { official?: unknown } })?.source?.official) f.add("source_unverified");
    return [...f];
  } catch {
    return ["source_unverified"];
  }
}
