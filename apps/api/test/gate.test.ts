import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveFlags, expandBatch, fingerprintInput, fitLevelOf, gateBatchSchema, gateEnvelopeSchema, levelOf, parseGatePayload, softKey, canonicalUrl, type GateEnvelope } from "@job-hunt-os/contracts";
import { classifyIncoming, fingerprintOf, mutableUpdate, notificationFor } from "../src/gate-ingest.js";
import { gateIngestView } from "../src/app.js";

const example = {"event":"gate.opportunity.discovered","schema_version":"1.0","search":{"watch_id":"summer-2027-software","season":"Summer 2027","country":"US","searched_at":"2026-10-02T17:30:00-05:00"},"opportunity":{"external_id":"doordash-3536354","title":"Software Engineer Intern - Summer 2027","track":"software_engineering","employment_type":"internship","season":"Summer 2027","location":{"city":"San Francisco","state":"CA","country":"US"},"work_arrangement":"hybrid","dates":{"start":null,"end":null,"duration_weeks":12},"application":{"status":"open","deadline":"2026-10-15T23:59:59-07:00","apply_url":"https://careers.example.com/jobs/3536354"},"description_summary":"Software engineering internship focused on production systems."},"company":{"name":"DoorDash","website":"https://www.doordash.com","careers_url":"https://careers.doordash.com","logo_url":"https://example.com/logo.png","industry":"Technology","headquarters":"San Francisco, CA"},"match":{"score":94,"level":"strong","matching_skills":["Python","Java","SQL"],"matching_experience":["Previous software engineering internship"],"matching_education":["Computer Science degree"],"missing_or_unclear":["Kubernetes production experience"],"reason":"Strong overlap."},"eligibility":{"degree_match":true,"graduation_match":true,"student_status_match":true,"citizenship_required":false,"us_person_required":false,"f1":{"status":"eligible","cpt_status":"allowed","opt_status":"unknown"},"sponsorship":{"status":"unknown","internship_sponsorship":"unknown","future_sponsorship":"unknown"},"work_authorization_note":"Posting explicitly states F-1 students may participate using CPT."},"compensation":{"available":true,"min":50,"max":60,"currency":"USD","period":"hour"},"source":{"provider":"company_careers","name":"DoorDash Careers","url":"https://careers.example.com/jobs/3536354","official":true,"first_seen_at":"2026-10-02T17:30:00-05:00","last_verified_at":"2026-10-02T17:30:00-05:00"},"agent":{"name":"GATE Scout","agent_type":"job_discovery","decision":"surface","confidence":0.96,"flags":["strong_match","cpt_confirmed","deadline_soon"]},"metadata":{"fingerprint":"sha256:abc","is_duplicate":false,"discovered_at":"2026-10-02T17:30:00-05:00","gate_status":"discovered","user_action_required":true}};
const clone = () => structuredClone(example) as any;
const parse = (x: unknown): GateEnvelope => { const r = parseGatePayload(x); if (!r.ok) throw new Error(r.error); return r.items[0]; };
const completeV2 = JSON.parse(readFileSync(new URL("./fixtures/gate-v2-complete.json", import.meta.url), "utf8"));
const v2 = {
  event: "gate.opportunity.discovered", schema_version: "2.0",
  identity: { fingerprint: "sha256:v2-example", external_job_id: "job-22", is_duplicate: false, record_type: "new" },
  search: { watch_id: "summer-2027", season: "Summer 2027", country: "United States", searched_at: "2026-10-03T18:40:00Z" },
  original_posting: { canonical_url: "https://example.com/jobs/22", source_url: "https://example.com/jobs/22", source_provider: "Official employer careers site", official_source: true, captured_at: "2026-10-03T18:40:00Z", posting_status: "open", content_hash: "sha256:content", raw_title: "Backend Intern", raw_description: "Build APIs with Python and PostgreSQL.", raw_location: "Austin, TX", snapshot_version: 1 },
  company: { name: "Example", website: "https://example.com" },
  opportunity: { title: "Backend Intern", track: "backend", employment_type: "internship", season: "Summer 2027", team: { product: "Platform" }, location: { cities: ["Austin"], states: ["TX"], country: "United States", work_arrangement: "hybrid", office_days_per_week: 2 }, internship: { start_date: "2027-06-01", duration_weeks: 12, weekly_hours: 40 }, application: { status: "open", deadline: "2026-10-20", apply_url: "https://example.com/jobs/22", materials: { resume: true } } },
  structured_facts: { responsibilities: [{ value: "Build production APIs", provenance: "stated", confidence: 1, evidence: "Build production APIs." }], required_skills: [{ skill: "Python", provenance: "stated", confidence: 1 }], preferred_skills: [{ skill: "AWS" }], technologies: ["Python", "PostgreSQL"], compensation: { available: true, min: 45, max: 55, currency: "USD", period: "hour" }, eligibility: { citizenship_required: { value: false, provenance: "stated" }, f1: { status: "eligible" }, cpt: { status: "allowed" }, opt: { status: "unknown" }, sponsorship: { internship: "unknown", future: "unknown" }, exact_work_authorization_language: ["F-1 students may participate using CPT."] } },
  gate_assessment: { match: { score: 96, level: "strong", technical_fit: 98 }, satisfies: [{ requirement: "Python", profile_evidence: "Python projects", confidence: 1 }], missing: [{ requirement: "Kubernetes", reason: "Not shown", severity: "low" }], unknown: [{ field: "future_sponsorship", reason: "Not stated", manual_confirmation_needed: true }], recommended_next_action: "Apply soon.", urgency: "high", assessment_confidence: .94 },
  source: { first_seen_at: "2026-10-03T18:40:00Z", last_verified_at: "2026-10-03T18:40:00Z", source_quality: "official", verification_status: "verified", evidence_urls: ["https://example.com/jobs/22"] },
  risk: { scam_score: 0 }, change_history: [{ detected_at: "2026-10-03T18:40:00Z", change_type: "initial_capture" }],
  agent: { name: "GATE Scout", agent_type: "job_discovery", decision: "surface", confidence: .96, flags: ["strong_match", "cpt_confirmed"] },
  metadata: { gate_status: "discovered", discovered_at: "2026-10-03T18:40:00Z", user_action_required: true, telegram_status: "pending" },
};

describe("gate payload parsing", () => {
  it("parses the full spec example", () => { const r = parseGatePayload(example); expect(r.ok).toBe(true); if (r.ok) { expect(r.items).toHaveLength(1); expect(r.items[0].company.name).toBe("DoorDash"); } });
  it("expands batches with shared search", () => {
    const { event, schema_version, search, ...rest } = clone(); const batch = { search, results: [rest, { ...rest, opportunity: { ...rest.opportunity, external_id: "other-1" } }] };
    expect(gateBatchSchema.safeParse(batch).success).toBe(true);
    const r = parseGatePayload(batch); expect(r.ok).toBe(true);
    if (r.ok) { expect(r.items).toHaveLength(2); expect(r.items[1].search.watch_id).toBe("summer-2027-software"); expect(r.items[1].event).toBe("gate.opportunity.discovered"); }
    expect(expandBatch(gateBatchSchema.parse(batch))).toHaveLength(2);
  });
  it("rejects invalid payloads with a useful message", () => {
    const bad = clone(); bad.match.score = 140; delete bad.company.name;
    const r = parseGatePayload(bad); expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("match.score"); expect(r.error).toContain("company.name"); }
    expect(parseGatePayload({ search: example.search, results: [] }).ok).toBe(false);
    expect(parseGatePayload(null).ok).toBe(false);
  });
  it("normalizes GATE 2.x for the current Inbox and preserves all rich layers", () => {
    const r = parseGatePayload(v2); expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.items[0];
    expect(e).toMatchObject({ schema_version: "2.0", opportunity: { external_id: "job-22", location: { city: "Austin", state: "TX" }, work_arrangement: "hybrid", application: { deadline: "2026-10-20T00:00:00.000Z", materials: { resume: true } } }, match: { score: 96, level: "strong", fit_level: "perfect", badge: "PERFECT MATCH", perfect_fit: true, missing_or_unclear: ["Kubernetes — Not shown"], unknown: [{ field: "future_sponsorship" }] }, eligibility: { f1: { status: "eligible", cpt_status: "allowed" } }, compensation: { min: 45, max: 55 }, source: { provider: "company_careers", official: true } });
    expect(e.original_posting?.raw_description).toContain("Python");
    expect(e.structured_facts?.required_skills[0].skill).toBe("Python");
    expect(e.gate_assessment?.recommended_next_action).toBe("Apply soon.");
    expect(e.risk).toEqual({ scam_score: 0 });
    expect(e.metadata.telegram_status).toBe("pending");
  });
  it("accepts the complete GATE Scout 2.0 payload unchanged", () => {
    const payload = { ...completeV2, watcher_extension: { retained: true } };
    const r = parseGatePayload(payload); expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.items[0];
    expect(e.opportunity).toMatchObject({ work_arrangement: "onsite", location: { work_arrangement: "onsite", travel_required: null, relocation_required: null } });
    expect(e.agent.flags).toContain("official_source");
    expect(e.match).toMatchObject({ score: 99, level: "strong", fit_level: "perfect", badge: "PERFECT MATCH", perfect_fit: true, eligibility_risk: { level: "low" } });
    expect(e.match.recommended_resume_emphasis).toContain("PostgreSQL");
    expect(e.match.supporting_evidence.join(" ")).toContain("Ghana National Addressing");
    expect(e.match.unknown.map((x) => x.field)).toEqual(["future_sponsorship", "application_deadline"]);
    expect(e.match.missing).toEqual([]);
    expect(e.original_posting?.raw_description).toBe("FULL ORIGINAL JOB POSTING TEXT HERE");
    expect(e.structured_facts?.eligibility).toHaveProperty("exact_work_authorization_language");
    expect(e.gate_assessment?.recommended_resume).toMatchObject({ version: "backend-software-engineering" });
    expect(e.change_history?.[0]).toMatchObject({ change_type: "initial_capture" });
    expect(e.watcher_extension).toEqual({ retained: true });
  });
  it("accepts a GATE 2.x batch with shared search", () => {
    const { event: _event, search: _search, ...item } = v2;
    const r = parseGatePayload({ event: "gate.opportunity.batch", schema_version: "2.0", search: v2.search, results: [item] });
    expect(r.ok).toBe(true); if (r.ok) expect(r.items[0].search.watch_id).toBe("summer-2027");
  });
  it("accepts discovery batches and reports invalid entries without losing valid ones", () => {
    const valid = structuredClone(completeV2); delete valid.event;
    const invalid = structuredClone(completeV2); delete invalid.event; delete invalid.company.name;
    const r = parseGatePayload({ event: "gate.discovery.batch", schema_version: "2.0", batch: { new_count: 2 }, opportunities: [valid, invalid] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ received: 2, isBatch: true });
    expect(r.indexedItems.map((x) => x.index)).toEqual([0]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ index: 1 });
    expect(r.errors[0].error).toContain("company.name");
  });
  it("rejects an all-invalid discovery batch with indexed details", () => {
    const invalid = structuredClone(completeV2); delete invalid.event; delete invalid.company.name;
    const r = parseGatePayload({ event: "gate.discovery.batch", schema_version: "2.0", opportunities: [invalid] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r).toMatchObject({ received: 1, isBatch: true, errors: [{ index: 0 }] });
  });
  it("normalizes the new match object while preserving the legacy level", () => {
    const next = clone();
    next.match = {
      score: 99, level: "perfect", perfect_fit: false, badge: "WRONG",
      already_satisfies: [{ requirement: "TypeScript", evidence: "Built production applications." }],
      missing: [], unknown: [{ field: "cpt", reason: "Not stated." }],
      supporting_evidence: ["Full-stack experience"], recommended_resume_emphasis: ["TypeScript"],
      eligibility_risk: { level: "unknown", reason: "CPT is not stated." },
    };
    next.eligibility = { f1: { status: "unknown" }, cpt: { status: "allowed" }, sponsorship: { status: "unknown" } };
    const e = parse(next);
    expect(e.match).toMatchObject({ level: "strong", fit_level: "perfect", perfect_fit: true, badge: "PERFECT MATCH", matching_skills: ["TypeScript"], missing_or_unclear: [] });
    expect(e.eligibility.f1.cpt_status).toBe("allowed");
    expect(e.match.unknown).toEqual([{ field: "cpt", reason: "Not stated." }]);
    expect(gateEnvelopeSchema.safeParse(e).success).toBe(true);
  });
  it("blocks perfect_fit only for an explicit unsatisfied hard requirement", () => {
    const next = clone(); next.match.score = 99; next.match.level = "perfect";
    next.match.missing_or_unclear = [];
    next.match.missing = [{ requirement: "U.S. citizenship", type: "hard_requirement", status: "not_satisfied", reason: "Candidate does not satisfy it." }];
    next.match.unknown = [{ field: "cpt", reason: "Not stated." }];
    const e = parse(next);
    expect(e.match).toMatchObject({ fit_level: "perfect", perfect_fit: false, badge: "PERFECT MATCH", missing_or_unclear: ["U.S. citizenship — Candidate does not satisfy it."] });
    expect(e.match.missing_or_unclear.join(" ")).not.toContain("cpt");
  });
});

describe("GATE ingest responses", () => {
  const opportunity = parse(completeV2);
  const result = {
    gate_opportunity_id: "gate-1", gate_status: "approved" as const, duplicate: true, created: false,
    fingerprint: "sha256:server", telegram: { status: "pending" as const, retry_count: 0 }, opportunity,
  };
  it("keeps legacy result fields while exposing authoritative storage and delivery", () => {
    const view = gateIngestView(result, true);
    expect(view.legacy).toEqual({ gate_opportunity_id: "gate-1", gate_status: "approved", duplicate: true });
    expect(view.stored).toMatchObject({ ok: true, fingerprint: "sha256:server", gate_status: "approved" });
    expect(view.delivery).toMatchObject({ telegram: { status: "pending" }, desktop: { status: "available" } });
    expect(view.opportunity?.match.fit_level).toBe("perfect");
  });
  it("keeps batch views compact", () => {
    expect(gateIngestView(result, false)).not.toHaveProperty("opportunity");
  });
});

describe("fingerprint and soft key", () => {
  it("is stable across tracking params, season words, case and www", () => {
    const a = clone(); const b = clone();
    b.company.name = "DOORDASH"; b.opportunity.title = "software engineer - 2027 Fall Internship"; b.opportunity.application.apply_url = "https://www.Careers.example.com/jobs/3536354/?utm_source=x&gh_src=1#top";
    expect(fingerprintInput(parse(a))).toBe(fingerprintInput(parse(b)));
    expect(fingerprintOf(parse(a))).toBe(fingerprintOf(parse(b)));
    expect(fingerprintOf(parse(a))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("differs for a different URL", () => { const b = clone(); b.opportunity.application.apply_url = "https://careers.example.com/jobs/999"; expect(fingerprintOf(parse(b))).not.toBe(fingerprintOf(parse(example))); });
  it("canonicalizes urls and builds a soft key", () => { expect(canonicalUrl("https://WWW.A.com/x/?q=1")).toBe("a.com/x"); expect(softKey(parse(example))).toBe("doordash|software engineer intern summer 2027|san francisco"); });
});

describe("deriveFlags and levelOf", () => {
  const now = Date.parse("2026-10-12T00:00:00-07:00");
  it("adds deadline_soon within 4 days only", () => {
    expect(deriveFlags(parse(example), Date.parse("2026-10-12T00:00:00-07:00"))).toContain("deadline_soon");
    const far = clone(); far.agent.flags = []; expect(deriveFlags(parse(far), Date.parse("2026-10-01T00:00:00-07:00"))).not.toContain("deadline_soon");
    expect(deriveFlags(parse(far), Date.parse("2026-10-20T00:00:00-07:00"))).not.toContain("deadline_soon");
  });
  it("flags unofficial sources and derives cpt/strong", () => { const b = clone(); b.source.official = false; b.agent.flags = []; const f = deriveFlags(parse(b), now); expect(f).toContain("source_unverified"); expect(f).toContain("cpt_confirmed"); expect(f).toContain("strong_match"); expect(deriveFlags(parse(example), now)).not.toContain("source_unverified"); });
  it("levelOf boundaries", () => { expect(levelOf(85)).toBe("strong"); expect(levelOf(84.9)).toBe("moderate"); expect(levelOf(65)).toBe("moderate"); expect(levelOf(64)).toBe("weak"); });
  it("uses deterministic five-level fit boundaries", () => {
    expect([0, 49, 50, 69, 70, 84, 85, 94, 95, 100].map(fitLevelOf)).toEqual(["low", "low", "partial", "partial", "good", "good", "strong", "strong", "perfect", "perfect"]);
  });
});

describe("classifyIncoming", () => {
  const item = parse(example);
  it("discards agent discard decisions", () => { const d = clone(); d.agent.decision = "discard"; expect(classifyIncoming(null, parse(d))).toEqual({ action: "discard" }); });
  it("inserts new as discovered, honoring only discovered/expired", () => {
    expect(classifyIncoming(null, item)).toEqual({ action: "insert", gate_status: "discovered" });
    const a = clone(); a.metadata.gate_status = "approved"; expect(classifyIncoming(null, parse(a))).toEqual({ action: "insert", gate_status: "discovered" });
    const e = clone(); e.metadata.gate_status = "expired"; expect(classifyIncoming(null, parse(e))).toEqual({ action: "insert", gate_status: "expired" });
  });
  it("does not discard a valid surfaced opportunity because its score is low", () => { const low = clone(); low.match.score = 20; low.agent.decision = "surface"; expect(classifyIncoming(null, parse(low))).toEqual({ action: "insert", gate_status: "discovered" }); });
  it("never downgrades user decisions", () => { for (const s of ["approved", "dismissed", "saved_for_later"] as const) expect(classifyIncoming({ gate_status: s }, item)).toEqual({ action: "update", gate_status: s }); });
  it("mutable update refreshes facts but never touches the server-owned gate status", () => { const u = mutableUpdate(item); expect(Object.keys(u).some((k) => k.includes("gate_status"))).toBe(false); expect(u).toHaveProperty("envelope.company"); expect(u).toHaveProperty("envelope.match"); expect(u).toHaveProperty("envelope.source"); expect(u).toHaveProperty("updatedAt"); });
  it("mutable update retains GATE 2.x layers", () => { const u = mutableUpdate(parse(v2)); expect(u).toHaveProperty("envelope.original_posting"); expect(u).toHaveProperty("envelope.structured_facts"); expect(u).toHaveProperty("envelope.gate_assessment"); });
  it("distinguishes perfect notifications and stays quiet for lower matches", () => { const p = clone(); p.match.score = 98; const perfect = notificationFor(parse(p), []); expect(perfect?.title).toContain("Perfect match"); expect(perfect?.urgency).toBe("high"); const n = notificationFor(item, ["cpt_confirmed", "deadline_soon"]); expect(n?.title).toContain("Strong match"); expect(n?.body).toContain("CPT confirmed"); const w = clone(); w.match.score = 70; expect(notificationFor(parse(w), [])).toBeNull(); });
});
