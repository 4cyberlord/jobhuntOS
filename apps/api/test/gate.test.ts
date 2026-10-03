import { describe, expect, it } from "vitest";
import { deriveFlags, expandBatch, fingerprintInput, gateBatchSchema, levelOf, parseGatePayload, softKey, canonicalUrl, type GateEnvelope } from "@job-hunt-os/contracts";
import { classifyIncoming, fingerprintOf, mutableUpdate, notificationFor } from "../src/gate-ingest.js";

const example = {"event":"gate.opportunity.discovered","schema_version":"1.0","search":{"watch_id":"summer-2027-software","season":"Summer 2027","country":"US","searched_at":"2026-10-02T17:30:00-05:00"},"opportunity":{"external_id":"doordash-3536354","title":"Software Engineer Intern - Summer 2027","track":"software_engineering","employment_type":"internship","season":"Summer 2027","location":{"city":"San Francisco","state":"CA","country":"US"},"work_arrangement":"hybrid","dates":{"start":null,"end":null,"duration_weeks":12},"application":{"status":"open","deadline":"2026-10-15T23:59:59-07:00","apply_url":"https://careers.example.com/jobs/3536354"},"description_summary":"Software engineering internship focused on production systems."},"company":{"name":"DoorDash","website":"https://www.doordash.com","careers_url":"https://careers.doordash.com","logo_url":"https://example.com/logo.png","industry":"Technology","headquarters":"San Francisco, CA"},"match":{"score":94,"level":"strong","matching_skills":["Python","Java","SQL"],"matching_experience":["Previous software engineering internship"],"matching_education":["Computer Science degree"],"missing_or_unclear":["Kubernetes production experience"],"reason":"Strong overlap."},"eligibility":{"degree_match":true,"graduation_match":true,"student_status_match":true,"citizenship_required":false,"us_person_required":false,"f1":{"status":"eligible","cpt_status":"allowed","opt_status":"unknown"},"sponsorship":{"status":"unknown","internship_sponsorship":"unknown","future_sponsorship":"unknown"},"work_authorization_note":"Posting explicitly states F-1 students may participate using CPT."},"compensation":{"available":true,"min":50,"max":60,"currency":"USD","period":"hour"},"source":{"provider":"company_careers","name":"DoorDash Careers","url":"https://careers.example.com/jobs/3536354","official":true,"first_seen_at":"2026-10-02T17:30:00-05:00","last_verified_at":"2026-10-02T17:30:00-05:00"},"agent":{"name":"GATE Scout","agent_type":"job_discovery","decision":"surface","confidence":0.96,"flags":["strong_match","cpt_confirmed","deadline_soon"]},"metadata":{"fingerprint":"sha256:abc","is_duplicate":false,"discovered_at":"2026-10-02T17:30:00-05:00","gate_status":"discovered","user_action_required":true}};
const clone = () => structuredClone(example) as any;
const parse = (x: unknown): GateEnvelope => { const r = parseGatePayload(x); if (!r.ok) throw new Error(r.error); return r.items[0]; };

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
});

describe("classifyIncoming", () => {
  const item = parse(example);
  it("discards agent discard decisions", () => { const d = clone(); d.agent.decision = "discard"; expect(classifyIncoming(null, parse(d))).toEqual({ action: "discard" }); });
  it("inserts new as discovered, honoring only discovered/expired", () => {
    expect(classifyIncoming(null, item)).toEqual({ action: "insert", gate_status: "discovered" });
    const a = clone(); a.metadata.gate_status = "approved"; expect(classifyIncoming(null, parse(a))).toEqual({ action: "insert", gate_status: "discovered" });
    const e = clone(); e.metadata.gate_status = "expired"; expect(classifyIncoming(null, parse(e))).toEqual({ action: "insert", gate_status: "expired" });
  });
  it("never downgrades user decisions", () => { for (const s of ["approved", "dismissed", "saved_for_later"] as const) expect(classifyIncoming({ gate_status: s }, item)).toEqual({ action: "update", gate_status: s }); });
  it("mutable update touches only allowed facts", () => { const u = mutableUpdate(item); expect(Object.keys(u).some((k) => k.includes("gate_status") || k.includes("company") || k.includes("match"))).toBe(false); expect(u).toHaveProperty("envelope.source"); expect(u).toHaveProperty("updatedAt"); });
  it("builds notifications only for strong matches", () => { const n = notificationFor(item, ["cpt_confirmed", "deadline_soon"]); expect(n?.urgency).toBe("high"); expect(n?.body).toContain("CPT confirmed"); const w = clone(); w.match.score = 70; expect(notificationFor(parse(w), [])).toBeNull(); });
});
