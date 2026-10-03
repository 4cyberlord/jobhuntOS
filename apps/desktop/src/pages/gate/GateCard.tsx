import { CalendarDaysIcon, CheckBadgeIcon, CheckIcon, ClockIcon, ShieldCheckIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { DAY, fmtAgo, fmtShort } from "../../lib/format";
import { deadlineOf, flagsFor, levelFor, locationText, payText } from "../../lib/gate";
import type { GateOpportunity } from "../../lib/types";
import { Logo } from "../../components/Logo";
import { Ring } from "./ui";

type Tone = "ok" | "warn" | "q" | "info";
const MODE: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };

export function chipsFor(g: GateOpportunity): [string, Tone][] {
  const e = g.envelope, el = e.eligibility, flags = flagsFor(g);
  const out: [string, Tone][] = [
    el.f1.cpt_status === "allowed" ? ["CPT", "ok"] : el.f1.cpt_status === "likely_allowed" ? ["CPT likely", "ok"] : el.f1.cpt_status === "not_allowed" ? ["No CPT", "warn"] : ["CPT ?", "q"],
    el.graduation_match === false ? ["Graduation", "warn"] : el.graduation_match ? ["Graduation", "ok"] : ["Graduation ?", "q"],
  ];
  if (e.match.matching_skills.length) out.push(["Skills", "ok"]);
  if (MODE[e.opportunity.work_arrangement]) out.push([MODE[e.opportunity.work_arrangement], "info"]);
  if (flags.includes("citizenship_required") || flags.includes("us_person_required")) out.push(["US only", "warn"]);
  return out;
}

export function GateCard({ g, active, onClick }: { g: GateOpportunity; active: boolean; onClick: () => void }) {
  const e = g.envelope;
  const dl = deadlineOf(e);
  const left = dl ? Math.ceil((dl - Date.now()) / DAY) : undefined;
  const pay = payText(e);
  const spons = e.eligibility.sponsorship.status;
  const level = levelFor(e);
  const mode = MODE[e.opportunity.work_arrangement];
  const place = locationText(e);
  return (
    <button className={`g-card ${active ? "active" : ""} ${!g.seen ? "unseen" : ""}`} onClick={onClick} aria-pressed={active}>
      <Logo name={e.company.name} size={46} hints={{ website: e.company.website, applyUrl: e.opportunity.application.apply_url, logoUrl: e.company.logo_url }} />
      <div className="g-card-main">
        <div className="g-card-title"><b title={e.opportunity.title}>{e.opportunity.title}</b>{!g.seen && <i className="g-dot" aria-label="New" />}</div>
        <span className="g-card-co">{e.company.name}{e.source.official && <CheckBadgeIcon className="g-verified" aria-label="Official source" />}</span>
        <span className="g-card-loc">{place}{mode && !place.includes("Remote") ? ` · ${mode}` : ""}</span>
        <div className="g-chips">
          {chipsFor(g).map(([t, tone]) => <span key={t} className={tone}>{tone === "ok" && <CheckIcon />}{tone === "warn" && <XMarkIcon />}{t}</span>)}
        </div>
        <div className="g-chips sub">
          {e.source.official ? <span className="info"><ShieldCheckIcon />Official</span> : <span className="warn">Unverified</span>}
          {spons === "not_available" && <span className="warn">No sponsorship</span>}
          {spons === "available" && <span className="ok"><CheckIcon />Sponsorship</span>}
        </div>
        <div className="g-card-foot">
          <span><ClockIcon />Found {fmtAgo(g.receivedAt)}</span>
          <span className={left !== undefined && left <= 4 ? "urgent" : ""}><CalendarDaysIcon />{dl ? `Deadline ${fmtShort(dl)}` : "No deadline"}</span>
        </div>
      </div>
      <div className="g-card-score">
        <Ring score={e.match.score} size={58} />
        <small className={level}>{level} match</small>
        {pay !== "—" && <em>{pay}</em>}
      </div>
    </button>
  );
}
