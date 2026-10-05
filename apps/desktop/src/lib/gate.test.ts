import { describe, expect, it } from "vitest";
import type { GateEnvelope } from "@job-hunt-os/contracts";
import type { GateOpportunity } from "./types";
import { fitLevelFor, gateDataAvailability, isPerfectFit, similarGateOpportunities } from "./gate";
import { NO_FILTERS, passes } from "../pages/gate/filters";

const legacy = (): GateEnvelope => ({
  match: { matching_skills: [], matching_experience: [], matching_education: [] },
  opportunity: { application: { deadline: null }, location: { state: null }, work_arrangement: "unknown" },
  eligibility: {
    degree_match: null,
    graduation_match: null,
    student_status_match: null,
    citizenship_required: false,
    us_person_required: false,
    f1: { status: "unknown", cpt_status: "unknown", opt_status: "unknown" },
    sponsorship: { status: "unknown" },
  },
  source: { official: true, provider: "company_careers" },
} as unknown as GateEnvelope);

describe("gateDataAvailability", () => {
  it("treats absent rich layers and schema defaults as not captured", () => {
    expect(gateDataAvailability(legacy())).toEqual({
      assessment: false,
      requiredSkills: false,
      preferredSkills: false,
      technologies: false,
      responsibilities: false,
      expectedOutcomes: false,
      fullDescription: false,
      deadline: false,
      compensation: false,
      citizenship: false,
      usPerson: false,
      eligibility: false,
    });
  });

  it("reports only the sections present on a partially enriched record", () => {
    const e = legacy();
    e.structured_facts = {
      required_skills: [{ skill: "TypeScript" }],
      preferred_skills: [], technologies: ["React"], responsibilities: [], expected_outcomes: [],
      experience_requirements: {}, education: {}, compensation: {}, eligibility: {}, hiring_process: {}, contacts: [],
    };
    e.compensation = { available: false, min: null, max: null, currency: "USD", period: "hour" };
    e.structured_facts.eligibility = { citizenship_required: { value: false, provenance: "stated" } };
    expect(gateDataAvailability(e)).toMatchObject({ requiredSkills: true, technologies: true, responsibilities: false, compensation: true, citizenship: true, eligibility: true });
  });

  it("recognizes complete assessment, posting, deadline and eligibility data", () => {
    const e = legacy();
    e.match.matching_skills = ["TypeScript"];
    e.original_posting = { raw_description: "Build accessible software." } as GateEnvelope["original_posting"];
    e.opportunity.application.deadline = "2026-11-01T00:00:00.000Z";
    e.eligibility.f1.cpt_status = "allowed";
    expect(gateDataAvailability(e)).toMatchObject({ assessment: true, fullDescription: true, deadline: true, eligibility: true });
  });

  it("derives five-level fits for legacy records and filters low matches without hiding them from All", () => {
    const e = legacy(); e.match.score = 35;
    const g = { envelope: e, receivedAt: Date.now(), gateStatus: "discovered" } as never;
    expect(fitLevelFor(e)).toBe("low");
    expect(isPerfectFit(e)).toBe(false);
    expect(passes(g, NO_FILTERS)).toBe(true);
    expect(passes(g, { ...NO_FILTERS, match: "low" })).toBe(true);
    expect(passes(g, { ...NO_FILTERS, match: "perfect" })).toBe(false);
  });

  it("requires no hard mismatch for the perfect-fit highlight", () => {
    const e = legacy(); e.match.score = 99; e.match.fit_level = "perfect"; e.match.perfect_fit = true;
    const g = { envelope: e, receivedAt: Date.now(), gateStatus: "discovered" } as never;
    expect(fitLevelFor(e)).toBe("perfect");
    expect(isPerfectFit(e)).toBe(true);
    expect(passes(g, { ...NO_FILTERS, match: "perfect" })).toBe(true);
    e.match.perfect_fit = false;
    expect(isPerfectFit(e)).toBe(false);
  });
});

describe("similarGateOpportunities", () => {
  const item = (id: string, track: string, score: number, status = "discovered", technologies: string[] = [], state = "CA") => {
    const envelope = legacy();
    envelope.company = { name: id === "same-company" ? "Current" : id } as GateEnvelope["company"];
    envelope.opportunity = { ...envelope.opportunity, title: `${id} Intern`, track, location: { ...envelope.opportunity.location, state } } as GateEnvelope["opportunity"];
    envelope.match.score = score;
    envelope.structured_facts = { responsibilities: [], expected_outcomes: [], required_skills: [], preferred_skills: [], technologies, experience_requirements: {}, education: {}, compensation: {}, eligibility: {}, hiring_process: {}, contacts: [] };
    return { id, envelope, receivedAt: score, gateStatus: status } as GateOpportunity;
  };

  it("ranks shared track and technologies while excluding terminal records and enforcing the limit", () => {
    const current = item("current", "backend", 90, "discovered", ["Python", "AWS"]); current.envelope.company = { name: "Current" } as GateEnvelope["company"];
    const close = item("close", "backend", 70, "discovered", ["Python"]);
    const company = item("same-company", "frontend", 99, "approved", ["React"], "NY");
    const weak = item("weak", "frontend", 100, "discovered", [], "TX");
    const dismissed = item("dismissed", "backend", 100, "dismissed", ["Python", "AWS"]);
    expect(similarGateOpportunities(current, [current, weak, company, close, dismissed], 2).map((g) => g.id)).toEqual(["close", "same-company"]);
  });
});
