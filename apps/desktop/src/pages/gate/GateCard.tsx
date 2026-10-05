import { CalendarDaysIcon, CheckBadgeIcon, ClockIcon, SparklesIcon } from "@heroicons/react/20/solid";
import { DAY, fmtAgo, fmtShort } from "../../lib/format";
import { deadlineOf, fitLevelFor, isPerfectFit, locationText, payText } from "../../lib/gate";
import type { GateOpportunity } from "../../lib/types";
import { Logo } from "../../components/Logo";

const MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const degreeLabel = (education: Record<string, unknown>) => {
  const direct = text(education.degree_required) ?? text((education.degree as Record<string, unknown> | undefined)?.value);
  if (direct) return direct;
  const degrees = Array.isArray(education.degrees) ? education.degrees.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  return degrees.length ? degrees.slice(0, 2).join(" / ") : undefined;
};

/** The canonical record stores skills as rich evidence objects. Older records
 * often only contain technologies or a technical stack, so use those strictly
 * as fallbacks rather than leaving otherwise useful cards blank. */
const skillLabel = (value: unknown) => {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  return text(item.skill) ?? text(item.name) ?? text(item.value);
};
export const cardSkills = (facts: Record<string, unknown>) => {
  const required = Array.isArray(facts.required_skills) ? facts.required_skills.map(skillLabel).filter((x): x is string => !!x) : [];
  const technologies = Array.isArray(facts.technologies) ? facts.technologies.map(skillLabel).filter((x): x is string => !!x) : [];
  const stack = facts.technical_stack && typeof facts.technical_stack === "object"
    ? Object.values(facts.technical_stack as Record<string, unknown>).flatMap((value) => Array.isArray(value) ? value.map(skillLabel).filter((x): x is string => !!x) : [])
    : [];
  return [...new Set((required.length ? required : technologies.length ? technologies : stack).map((x) => x.trim()))];
};

export function GateCard({ g, active, onClick }: { g: GateOpportunity; active: boolean; onClick: () => void }) {
  const rawE = (g?.envelope ?? {}) as unknown as Record<string, unknown>;
  const e = rawE as unknown as GateOpportunity["envelope"];
  const dl = (() => { try { return deadlineOf(e); } catch { return undefined; } })();
  const left = dl ? Math.ceil((dl - Date.now()) / DAY) : undefined;
  const pay = (() => { try { return payText(e); } catch { return "—"; } })();
  const level = (() => { try { return fitLevelFor(e); } catch { return "low" as ReturnType<typeof fitLevelFor>; } })();
  const perfect = (() => { try { return isPerfectFit(e); } catch { return false; } })();
  const opportunity = (rawE.opportunity ?? {}) as Record<string, unknown>;
  const location = (opportunity.location ?? {}) as Record<string, unknown>;
  const workArr = text(location.work_arrangement) ?? text(opportunity.work_arrangement);
  const mode = workArr ? MODE[workArr] : undefined;
  const place = (() => { try { return locationText(e); } catch { return "—"; } })();
  const safeCompanyName = typeof (rawE.company as Record<string, unknown> | undefined)?.name === "string" ? (rawE.company as Record<string, unknown>).name as string : "Unknown";
  const safeTitle = typeof (rawE.opportunity as Record<string, unknown> | undefined)?.title === "string" ? (rawE.opportunity as Record<string, unknown>).title as string : "Untitled opportunity";
  const rawScore: unknown = (rawE.match as Record<string, unknown> | undefined)?.score;
  const scoreNum = typeof rawScore === "number" && Number.isFinite(rawScore) ? rawScore : 0;
  const companyWebsite = (rawE.company as Record<string, unknown> | undefined)?.website as string | undefined;
  const companyLogo = (rawE.company as Record<string, unknown> | undefined)?.logo_url as string | undefined;
  const applyUrl = (rawE.opportunity as unknown as { application?: { apply_url?: string } })?.application?.apply_url;
  const sourceOfficial = !!(rawE.source as Record<string, unknown> | undefined)?.official;
  const facts = (rawE.structured_facts ?? {}) as Record<string, unknown>;
  const education = (facts.education ?? {}) as Record<string, unknown>;
  const employment = text(opportunity.employment_type);
  const officeDays = typeof location.office_days_per_week === "number" && Number.isFinite(location.office_days_per_week) ? location.office_days_per_week : undefined;
  const degree = degreeLabel(education);
  const technologies = cardSkills(facts);
  const roleFacts = [
    employment ? titleCase(employment) : undefined,
    officeDays !== undefined ? `Onsite ${officeDays} day${officeDays === 1 ? "" : "s"}` : undefined,
    pay !== "—" ? pay : undefined,
    degree,
  ].filter((value): value is string => Boolean(value));
  return (
    <button className={`g-card ${active ? "active" : ""} ${!g?.seen ? "unseen" : ""} ${perfect ? "perfect-fit" : ""}`} onClick={onClick} aria-pressed={active}>
      <Logo name={safeCompanyName} size={46} hints={{ website: companyWebsite, applyUrl: applyUrl, logoUrl: companyLogo }} />
      <div className="g-card-main">
        <div className="g-card-title"><b title={safeTitle}>{safeTitle}</b>{!g?.seen && <i className="g-dot" aria-label="New" />}</div>
        <span className="g-card-co">{safeCompanyName}{sourceOfficial && <CheckBadgeIcon className="g-verified" aria-label="Official source" />}</span>
        <span className="g-card-loc">{place}{mode && !place.includes("Remote") ? ` · ${mode}` : ""}</span>
        {roleFacts.length ? <div className="g-role-facts">{roleFacts.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}
        {technologies.length ? <div className="g-tech-row">{technologies.slice(0, 3).map((tech) => <span key={tech}>{tech}</span>)}{technologies.length > 3 ? <span className="g-tech-more">+{technologies.length - 3}</span> : null}</div> : null}
        <div className="g-card-match-row">
          <span className={`g-ai-match ${level}`}><SparklesIcon />AI Match {Math.round(scoreNum)}%</span>
          <span className="g-card-meta"><ClockIcon />Found {(() => { try { return fmtAgo(g.receivedAt); } catch { return "unknown"; } })()}</span>
          <span className={`g-card-meta ${left !== undefined && left <= 4 ? "urgent" : ""}`}><CalendarDaysIcon />{dl ? (() => { try { return `Deadline ${fmtShort(dl)}`; } catch { return "Deadline —"; } })() : "No deadline"}</span>
        </div>
      </div>
    </button>
  );
}
