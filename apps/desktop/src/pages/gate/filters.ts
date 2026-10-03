import type { GateOpportunity } from "../../lib/types";
import { DAY, startOfDay } from "../../lib/format";
import { deadlineOf, levelFor } from "../../lib/gate";

export type Filters = { found: string; deadline: string; location: string; mode: string; sponsor: string; cpt: string; match: string; source: string };
export const NO_FILTERS: Filters = { found: "any", deadline: "any", location: "any", mode: "any", sponsor: "any", cpt: "any", match: "any", source: "any" };
export const activeCount = (f: Filters) => Object.values(f).filter((v) => v !== "any").length;

/** Every filter is a plain predicate so the list, the tab counts and tests all agree. */
export function passes(g: GateOpportunity, f: Filters, now = Date.now()): boolean {
  const e = g.envelope;
  const dl = deadlineOf(e);
  if (f.found === "today" && g.receivedAt < startOfDay(now)) return false;
  if (f.found === "7d" && g.receivedAt < now - 7 * DAY) return false;
  if (f.found === "30d" && g.receivedAt < now - 30 * DAY) return false;
  if (f.deadline === "week" && !(dl && dl >= now && dl <= now + 7 * DAY)) return false;
  if (f.deadline === "has" && !dl) return false;
  if (f.deadline === "none" && dl) return false;
  if (f.location === "remote" ? e.opportunity.work_arrangement !== "remote" : f.location !== "any" && e.opportunity.location.state !== f.location) return false;
  if (f.mode !== "any" && e.opportunity.work_arrangement !== f.mode) return false;
  if (f.sponsor !== "any" && e.eligibility.sponsorship.status !== f.sponsor) return false;
  const cpt = e.eligibility.f1.cpt_status;
  if (f.cpt === "allowed" && cpt !== "allowed" && cpt !== "likely_allowed") return false;
  if (f.cpt === "not_allowed" && cpt !== "not_allowed") return false;
  if (f.cpt === "unknown" && cpt !== "unknown") return false;
  if (f.match !== "any" && levelFor(e) !== f.match) return false;
  if (f.source === "official" ? !e.source.official : f.source === "unverified" ? e.source.official : f.source !== "any" && e.source.provider !== f.source) return false;
  return true;
}

/** 0-4 completeness score for how much we know about a posting; drives the "Posting quality" meter. */
export function postingQuality(g: GateOpportunity): { level: "High" | "Medium" | "Low"; bars: number } {
  const e = g.envelope;
  const points = [e.source.official, !!e.opportunity.application.deadline, !!e.compensation?.available, e.opportunity.description_summary.length > 40, !!e.opportunity.location.city, e.match.matching_skills.length > 0].filter(Boolean).length;
  return points >= 4 ? { level: "High", bars: 4 } : points >= 2 ? { level: "Medium", bars: 2 } : { level: "Low", bars: 1 };
}
