import type { GateOpportunity } from "../../lib/types";
import { DAY, startOfDay } from "../../lib/format";
import { deadlineOf, fitLevelFor } from "../../lib/gate";

export type Filters = { found: string; deadline: string; location: string; mode: string; sponsor: string; cpt: string; match: string; source: string };
export const NO_FILTERS: Filters = { found: "any", deadline: "any", location: "any", mode: "any", sponsor: "any", cpt: "any", match: "any", source: "any" };
export const activeCount = (f: Filters) => Object.values(f).filter((v) => v !== "any").length;

/** Every filter is a plain predicate so the list, the tab counts and tests all agree. Tolerates sparse historical records. */
export function passes(g: GateOpportunity, f: Filters, now = Date.now()): boolean {
  try {
    const e = g.envelope as unknown as Record<string, unknown>;
    const opp = (e.opportunity ?? {}) as Record<string, unknown>;
    const loc = (opp.location ?? {}) as Record<string, unknown>;
    const elig = (e.eligibility ?? {}) as Record<string, unknown>;
    const sponsorship = (elig.sponsorship ?? {}) as Record<string, unknown>;
    const f1 = (elig.f1 ?? {}) as Record<string, unknown>;
    const source = (e.source ?? {}) as Record<string, unknown>;
    const dl = (() => { try { return deadlineOf(g.envelope); } catch { return undefined; } })();
    if (f.found === "today" && (typeof g.receivedAt !== "number" || g.receivedAt < startOfDay(now))) return false;
    if (f.found === "7d" && (typeof g.receivedAt !== "number" || g.receivedAt < now - 7 * DAY)) return false;
    if (f.found === "30d" && (typeof g.receivedAt !== "number" || g.receivedAt < now - 30 * DAY)) return false;
    if (f.deadline === "week" && !(dl && dl >= now && dl <= now + 7 * DAY)) return false;
    if (f.deadline === "has" && !dl) return false;
    if (f.deadline === "none" && dl) return false;
    if (f.location === "remote" ? opp.work_arrangement !== "remote" : f.location !== "any" && loc.state !== f.location) return false;
    if (f.mode !== "any" && opp.work_arrangement !== f.mode) return false;
    if (f.sponsor !== "any" && sponsorship.status !== f.sponsor) return false;
    const cpt = f1.cpt_status as string | undefined;
    if (f.cpt === "allowed" && cpt !== "allowed" && cpt !== "likely_allowed") return false;
    if (f.cpt === "not_allowed" && cpt !== "not_allowed") return false;
    if (f.cpt === "unknown" && cpt !== "unknown") return false;
    if (f.match !== "any") {
      const lvl = (() => { try { return fitLevelFor(g.envelope); } catch { return "low"; } })();
      if (lvl !== f.match) return false;
    }
    if (f.source === "official" ? !source.official : f.source === "unverified" ? !!source.official : f.source !== "any" && source.provider !== f.source) return false;
    return true;
  } catch {
    return f.found === "any" && f.deadline === "any" && f.location === "any" && f.mode === "any" && f.sponsor === "any" && f.cpt === "any" && f.match === "any" && f.source === "any";
  }
}

/** 0-4 completeness score for how much we know about a posting; drives the "Posting quality" meter. */
export function postingQuality(g: GateOpportunity): { level: "High" | "Medium" | "Low"; bars: number } {
  try {
    const e = g?.envelope as unknown as Record<string, unknown> | undefined;
    const opportunity = (e?.opportunity ?? {}) as Record<string, unknown>;
    const application = (opportunity.application ?? {}) as Record<string, unknown>;
    const location = (opportunity.location ?? {}) as Record<string, unknown>;
    const match = (e?.match ?? {}) as Record<string, unknown>;
    const source = (e?.source ?? {}) as Record<string, unknown>;
    const compensation = e?.compensation as Record<string, unknown> | undefined;
    const desc = typeof opportunity.description_summary === "string" ? opportunity.description_summary : "";
    const matchingSkills: unknown = match.matching_skills;
    const points = [
      !!source.official,
      typeof application.deadline === "string" && !!application.deadline,
      !!compensation?.available,
      desc.length > 40,
      typeof location.city === "string" && !!location.city,
      Array.isArray(matchingSkills) && matchingSkills.length > 0,
    ].filter(Boolean).length;
    return points >= 4 ? { level: "High", bars: 4 } : points >= 2 ? { level: "Medium", bars: 2 } : { level: "Low", bars: 1 };
  } catch {
    return { level: "Low", bars: 1 };
  }
}
