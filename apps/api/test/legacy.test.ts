import { describe, expect, it } from "vitest";
import { normalizeIncoming, parseGatePayload, externalIdFor, flattenTelegramText, legacyToEnvelope, parseTelegramMessage, providerFor } from "@job-hunt-os/contracts";
import { fingerprintOf, initialDelivery, MAX_DELIVERY_ATTEMPTS, nextDelivery } from "../src/gate-ingest.js";

const relay = { company: { name: "Commure" }, opportunity: { title: "Software Engineering Intern, Summer 2027", location: "Mountain View, CA", work_arrangement: "Onsite", application: { apply_url: "https://jobs.ashbyhq.com/Commure/abc?utm_source=x" } }, match: { score: 99 }, eligibility: { f1: { cpt_status: "unknown" }, sponsorship: { status: "unknown" } }, metadata: { fingerprint: "992feee883a515f4fff5" } };
const message = ["🟢 GATE Opportunity", "", "Commure", "Software Engineering Intern, Summer 2027", "", "📍 Mountain View, CA", "🎯 Match: 99%", "🎓 CPT: Unknown", "🛂 Sponsorship: Unknown", "", "🔗 Apply: https://jobs.ashbyhq.com/Commure/abc?utm_source=x", "GATE_ID: 992feee883a515f4fff5"].join("\n");

describe("legacyToEnvelope", () => {
  it("fills every required GATE field from the slim relay payload", () => {
    const r = legacyToEnvelope(relay, { at: new Date("2026-10-02T12:00:00Z") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.envelope;
    expect(e.opportunity.location).toEqual({ city: "Mountain View", state: "CA", country: "US" });
    expect(e.opportunity.work_arrangement).toBe("onsite");
    expect(e.opportunity.season).toBe("Summer 2027");
    expect(e.opportunity.track).toBe("software_engineering");
    expect(e.match).toMatchObject({ score: 99, level: "strong" });
    expect(e.source).toMatchObject({ provider: "ashby", official: true });
    expect(e.metadata.fingerprint).toBe("992feee883a515f4fff5");
  });
  it("rejects records without an apply url or title instead of throwing", () => {
    expect(legacyToEnvelope({ company: { name: "X" }, opportunity: { title: "T" } }).ok).toBe(false);
    expect(legacyToEnvelope({}).ok).toBe(false);
  });
  it("classifies sources", () => {
    expect(providerFor("https://boards.greenhouse.io/x/1")).toMatchObject({ provider: "greenhouse", official: true });
    expect(providerFor("https://www.linkedin.com/jobs/view/1")).toMatchObject({ provider: "linkedin", official: false });
    expect(providerFor("https://careers.acme.com/1").provider).toBe("company_careers");
  });
});

describe("telegram text", () => {
  it("parses the deployed relay format (Apply and URL on separate lines, unknown GATE_ID)", () => {
    const real = "🟢 GATE Opportunity\n\nZip\nSoftware Engineer Intern\n\n📍 New York, NY\n🎯 Match: 88%\n🎓 CPT: unknown\n🛂 Sponsorship: unknown\n\n🔗 Apply:\nhttps://jobs.ashbyhq.com/zip/1\n\nGATE_ID: unknown";
    const p = parseTelegramMessage(real)!;
    expect(p).toMatchObject({ company: { name: "Zip" }, opportunity: { title: "Software Engineer Intern", location: "New York, NY", application: { apply_url: "https://jobs.ashbyhq.com/zip/1" } }, match: { score: "88%" } });
    expect(p.metadata).toBeUndefined();
    expect(legacyToEnvelope(p).ok).toBe(true);
  });
  it("parses the relay message format", () => {
    expect(parseTelegramMessage(message)).toMatchObject({ company: { name: "Commure" }, opportunity: { title: "Software Engineering Intern, Summer 2027", location: "Mountain View, CA", application: { apply_url: "https://jobs.ashbyhq.com/Commure/abc?utm_source=x" } }, match: { score: "99%" }, metadata: { fingerprint: "992feee883a515f4fff5" } });
    expect(parseTelegramMessage("hello world")).toBeNull();
  });
  it("flattens exported text segments and keeps hidden link targets", () => {
    const text = flattenTelegramText(["🟢 GATE Opportunity\n\nCommure\nSWE Intern\n\n🎯 Match: 90%\n🔗 ", { type: "text_link", text: "Apply", href: "https://jobs.lever.co/commure/1" }]);
    expect(parseTelegramMessage(text)?.opportunity?.application?.apply_url).toBe("https://jobs.lever.co/commure/1");
  });
  it("yields the same identity whether it came from JSON or Telegram text", () => {
    const a = legacyToEnvelope(relay), b = legacyToEnvelope(parseTelegramMessage(message)!);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) { expect(externalIdFor(relay)).toBe(a.envelope.opportunity.external_id); expect(fingerprintOf(a.envelope)).toBe(fingerprintOf(b.envelope)); }
  });
  it("derives a stable id when there is no GATE_ID", () => {
    const { metadata, ...noFp } = relay;
    const variant = { ...noFp, opportunity: { ...noFp.opportunity, application: { apply_url: "https://www.jobs.ashbyhq.com/Commure/abc/?gh_src=1#top" } } };
    expect(externalIdFor(variant)).toBe(externalIdFor(noFp));
  });
});

describe("refreshed records", () => {
  it("still parse after a server refresh stored compensation as null", () => {
    const r = legacyToEnvelope(relay);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const refreshed = { ...r.envelope, compensation: null };
    expect(parseGatePayload(refreshed).ok).toBe(true);
  });
});

describe("telegram delivery lifecycle", () => {
  const t0 = new Date("2026-10-03T00:00:00Z");
  it("new records start pending with a first-send grace period; backfills start as sent", () => {
    expect(initialDelivery(false, t0)).toMatchObject({ status: "pending", retry_count: 0, next_retry_at: new Date(t0.getTime() + 60_000) });
    expect(initialDelivery(true, t0)).toMatchObject({ status: "sent", next_retry_at: null });
  });
  it("records the message id on success", () => {
    expect(nextDelivery({ retry_count: 2 }, { status: "sent", message_id: 81 }, t0)).toMatchObject({ status: "sent", message_id: 81, retry_count: 2, next_retry_at: null });
  });
  it("honours Telegram's retry_after on a rate limit", () => {
    const d = nextDelivery({ retry_count: 0 }, { status: "rate_limited", retry_after: 32 }, t0);
    expect(d).toMatchObject({ status: "rate_limited", retry_count: 1, retry_after: 32 });
    expect(d.next_retry_at?.getTime()).toBe(t0.getTime() + 32_000);
  });
  it("backs off exponentially on other failures and gives up after the maximum attempts", () => {
    const first = nextDelivery(undefined, { status: "failed", error: "boom" }, t0);
    expect(first.next_retry_at?.getTime()).toBe(t0.getTime() + 60_000);
    const second = nextDelivery(first, { status: "failed" }, t0);
    expect(second.next_retry_at?.getTime()).toBe(t0.getTime() + 120_000);
    const last = nextDelivery({ retry_count: MAX_DELIVERY_ATTEMPTS - 1 }, { status: "failed" }, t0);
    expect(last).toMatchObject({ status: "failed", retry_count: MAX_DELIVERY_ATTEMPTS, next_retry_at: null });
  });
});

describe("normalizeIncoming", () => {
  const full = { event: "gate.opportunity.discovered", schema_version: "1.0", search: { watch_id: "w", searched_at: "2026-10-03T00:00:00Z" },
    opportunity: { external_id: "acme-1", title: "SWE Intern", location: { city: "Austin", state: "TX", country: "US" }, application: { apply_url: "https://jobs.lever.co/acme/1", deadline: "2026-10-20T00:00:00Z" }, description_summary: "Build things." },
    company: { name: "Acme" }, match: { score: 91, matching_skills: ["Python", "SQL"], reason: "Strong overlap." }, compensation: { available: true, min: 40, max: 50, period: "hour" },
    source: { provider: "lever", name: "Acme Careers", url: "https://jobs.lever.co/acme/1", official: true, first_seen_at: "2026-10-03T00:00:00Z", last_verified_at: "2026-10-03T00:00:00Z" }, metadata: { discovered_at: "2026-10-03T00:00:00Z" } };
  it("keeps every detail of a full GATE envelope", () => {
    const r = normalizeIncoming(full);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope).toMatchObject({ match: { matching_skills: ["Python", "SQL"], reason: "Strong overlap." }, compensation: { min: 40, max: 50 }, opportunity: { external_id: "acme-1", application: { deadline: "2026-10-20T00:00:00Z" } } });
  });
  it("still adapts the slim relay shape", () => {
    const r = normalizeIncoming(relay);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.envelope.source.provider).toBe("ashby");
  });
  it("rejects garbage without throwing", () => {
    expect(normalizeIncoming(null).ok).toBe(false);
    expect(normalizeIncoming({ hello: "world" }).ok).toBe(false);
  });
});
