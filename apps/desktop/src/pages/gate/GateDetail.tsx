import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowPathRoundedSquareIcon, ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon, BookmarkIcon, BriefcaseIcon, CalendarDaysIcon, CheckBadgeIcon, CheckIcon, DocumentTextIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon, LinkIcon, MapPinIcon, MinusSmallIcon, ShieldCheckIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { AcademicCapIcon, BanknotesIcon, GlobeAltIcon, ShieldCheckIcon as ShieldOutline } from "@heroicons/react/24/outline";
import { DAY, fmtAgo, fmtDate } from "../../lib/format";
import { FLAG_LABEL, PROVIDER_LABEL, STATUS_LABEL, TRACK_LABEL, WARN_FLAGS, deadlineOf, flagsFor, isOpen, levelFor, locationText, payText } from "../../lib/gate";
import { openExternal } from "../../lib/tauri";
import type { GateOpportunity } from "../../lib/types";
import { Logo } from "../../components/Logo";
import { postingQuality } from "./filters";
import { Ring } from "./ui";

type Tone = "ok" | "maybe" | "bad" | "q";
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const toneOf = (s: string): Tone => (({ eligible: "ok", allowed: "ok", available: "ok", not_required: "ok", likely_eligible: "maybe", likely_allowed: "maybe", not_eligible: "bad", not_allowed: "bad", not_available: "bad" }) as Record<string, Tone>)[s] ?? "q";
const tri = (v: boolean | null | undefined, yes: string, no: string): [string, Tone] => (v == null ? ["Not stated", "q"] : v ? [yes, "ok"] : [no, "bad"]);

const Mark = ({ tone }: { tone: Tone }) => <span className={`gd-mark ${tone}`}>{tone === "bad" ? <XMarkIcon /> : tone === "q" ? <MinusSmallIcon /> : <CheckIcon />}</span>;
const Row = ({ label, children, tone, mark }: { label: string; children: ReactNode; tone?: Tone; mark?: Tone }) => (
  <div className="gd-row"><span>{label}</span><b className={tone ? `t-${tone}` : ""}>{children}{mark && <Mark tone={mark} />}</b></div>
);
const Card = ({ icon, title, aside, children, className = "" }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`gd-card ${className}`}><header><span className="gd-ico">{icon}</span><h3>{title}</h3>{aside && <div className="gd-aside">{aside}</div>}</header>{children}</section>
);

type Props = { g: GateOpportunity; onApprove: () => void; onDecide: (s: "dismissed" | "saved_for_later" | "discovered") => void; onOpenJob: () => void; onKanban: () => void; onCopied: () => void };

export function GateDetail({ g, onApprove, onDecide, onOpenJob, onKanban, onCopied }: Props) {
  const e = g.envelope, m = e.match, el = e.eligibility;
  const flags = flagsFor(g);
  const level = levelFor(e);
  const dl = deadlineOf(e);
  const left = dl ? Math.ceil((dl - Date.now()) / DAY) : undefined;
  const urgent = left !== undefined && left >= 0 && left <= 4;
  const q = postingQuality(g);
  const warnings = flags.filter((f) => WARN_FLAGS.has(f) && f !== "deadline_soon");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }); setMenu(false); }, [g.id]);
  useEffect(() => {
    if (!menu) return;
    const off = (ev: Event) => { if (ev instanceof KeyboardEvent ? ev.key === "Escape" : !menuRef.current?.contains(ev.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", off); };
  }, [menu]);

  const copy = async () => { try { await navigator.clipboard.writeText(e.opportunity.application.apply_url); onCopied(); } catch { /* clipboard unavailable */ } setMenu(false); };
  const apply = e.opportunity.application.apply_url;
  // records backfilled from Telegram carry a placeholder reason; show a friendlier line instead
  const reason = m.reason && !/^Imported from the GATE relay/i.test(m.reason) ? m.reason : `GATE Scout scored this ${Math.round(m.score)}% when it was discovered. A detailed breakdown wasn't captured for this one.`;
  const hasAssessment = m.matching_skills.length + m.matching_experience.length + m.matching_education.length > 0;
  const notes = [e.opportunity.description_summary, el.work_authorization_note].filter(Boolean) as string[];
  const place = locationText(e);
  const [degree, grad, student] = [tri(el.degree_match, "Matches", "Doesn't match"), tri(el.graduation_match, "In window", "Outside window"), tri(el.student_status_match, "Eligible student", "Not eligible")];

  return (
    <>
      <header className="gd-head">
        <Logo name={e.company.name} size={58} hints={{ website: e.company.website, applyUrl: e.opportunity.application.apply_url, logoUrl: e.company.logo_url }} />
        <div className="gd-title">
          <h2>{e.opportunity.title}</h2>
          <div className="gd-co">{e.company.name}{e.source.official && <CheckBadgeIcon className="g-verified" aria-label="Official source" />}</div>
          <div className="gd-meta">
            {place && <span><MapPinIcon />{place}</span>}
            {e.opportunity.work_arrangement !== "unknown" && <span><BriefcaseIcon />{pretty(e.opportunity.work_arrangement)}</span>}
            <span><DocumentTextIcon />{pretty(e.opportunity.employment_type)}</span>
            {e.opportunity.season && <span><CalendarDaysIcon />{e.opportunity.season}</span>}
          </div>
        </div>
        <div className="gd-head-right">
          <div className="gd-head-top">
            <span className={`gd-status st-${g.gateStatus}`}>{STATUS_LABEL[g.gateStatus]}</span>
            <div className="gd-menu" ref={menuRef}>
              <button className="gd-icon-btn" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><EllipsisHorizontalIcon /></button>
              {menu && (
                <div className="gd-pop" role="menu">
                  <button role="menuitem" onClick={copy}><LinkIcon />Copy apply link</button>
                  <button role="menuitem" onClick={() => { openExternal(e.source.url); setMenu(false); }}><ArrowTopRightOnSquareIcon />Open source listing</button>
                  {!isOpen(g) && <button role="menuitem" onClick={() => { onDecide("discovered"); setMenu(false); }}><ArrowUturnLeftIcon />Restore to inbox</button>}
                </div>
              )}
            </div>
          </div>
          <button className="btn gd-open" onClick={() => openExternal(apply)}>Open on {e.company.name}<ArrowTopRightOnSquareIcon /></button>
        </div>
      </header>

      <div className="gd-scroll" ref={scroller}>
        {e.agent.decision === "needs_review" && <div className="gd-alert"><ExclamationTriangleIcon />GATE Scout flagged this one for your review. Check eligibility before approving.</div>}

        <section className={`gd-banner ${level}`}>
          <Ring score={m.score} size={92} stroke={8} />
          <div>
            <span className={`gd-level ${level}`}>{level} match</span>
            <p>{reason}</p>
            <small>Score reflects résumé and requirement alignment, not your chance of an offer.</small>
          </div>
        </section>

        <div className="gd-grid two">
          <Card icon={<SparklesIcon />} title="Why this matched">
            {hasAssessment ? (<>
              {m.matching_skills.length > 0 && <div className="gd-skills">{m.matching_skills.map((s) => <span key={s}><CheckIcon />{s}</span>)}</div>}
              <ul className="gd-checks">{[...m.matching_experience, ...m.matching_education].map((x) => <li key={x}><CheckIcon />{x}</li>)}</ul>
            </>) : <p className="gd-empty">A detailed skills breakdown wasn't captured for this opportunity. The match score above came from the original discovery.</p>}
          </Card>
          <Card icon={<ExclamationTriangleIcon />} title="Potential gaps" className="gaps">
            {m.missing_or_unclear.length + warnings.length > 0 ? (
              <ul className="gd-gaps">
                {m.missing_or_unclear.map((x) => <li key={x}>{x}</li>)}
                {warnings.map((f) => <li key={f} className="flag">{FLAG_LABEL[f] ?? f}</li>)}
              </ul>
            ) : hasAssessment ? <p className="gd-empty good"><CheckIcon />No gaps flagged.</p> : <p className="gd-empty">Gaps weren't captured for this opportunity.</p>}
          </Card>
        </div>

        <div className="gd-grid two">
          <Card icon={<AcademicCapIcon />} title="Eligibility">
            <div className="gd-rows">
              <Row label="Degree" tone={degree[1]} mark={degree[1]}>{degree[0]}</Row>
              <Row label="Graduation window" tone={grad[1]} mark={grad[1]}>{grad[0]}</Row>
              <Row label="Student status" tone={student[1]} mark={student[1]}>{student[0]}</Row>
              <Row label="Citizenship required" tone={el.citizenship_required ? "bad" : "ok"} mark={el.citizenship_required ? "bad" : "ok"}>{el.citizenship_required ? "Yes" : "No"}</Row>
              <Row label="US person required" tone={el.us_person_required ? "bad" : "ok"} mark={el.us_person_required ? "bad" : "ok"}>{el.us_person_required ? "Yes" : "No"}</Row>
              <Row label="F-1 student" tone={toneOf(el.f1.status)} mark={toneOf(el.f1.status)}>{pretty(el.f1.status)}</Row>
              <Row label="CPT" tone={toneOf(el.f1.cpt_status)} mark={toneOf(el.f1.cpt_status)}>{pretty(el.f1.cpt_status)}</Row>
              <Row label="OPT" tone={toneOf(el.f1.opt_status)} mark={toneOf(el.f1.opt_status)}>{pretty(el.f1.opt_status)}</Row>
              <Row label="Sponsorship" tone={toneOf(el.sponsorship.status)} mark={toneOf(el.sponsorship.status)}>{pretty(el.sponsorship.status)}</Row>
            </div>
          </Card>
          <div className="gd-stack">
            <Card icon={<BanknotesIcon />} title="Compensation & logistics">
              <div className="gd-rows">
                <Row label="Salary range">{payText(e) === "—" ? "Not listed" : payText(e).replace("–", " – ").replace("/hr", " / hr")}</Row>
                <Row label="Work mode">{pretty(e.opportunity.work_arrangement)}</Row>
                <Row label="Location">{place}</Row>
                <Row label="Duration">{e.opportunity.dates.duration_weeks ? `${e.opportunity.dates.duration_weeks} weeks` : e.opportunity.season ?? "—"}</Row>
                <Row label="Track">{TRACK_LABEL(e.opportunity.track)}</Row>
                <Row label="Application deadline" tone={urgent ? "bad" : undefined}>{dl ? `${fmtDate(dl)}${left !== undefined && left >= 0 ? ` (in ${left} day${left === 1 ? "" : "s"})` : " (passed)"}` : "Not stated"}{urgent && <span className="gd-alert-dot" />}</Row>
              </div>
            </Card>
            <Card icon={<GlobeAltIcon />} title="Source & posting quality" aside={e.source.official ? <span className="gd-official"><ShieldCheckIcon />Official source</span> : <span className="gd-unverified">Unverified</span>}>
              <div className="gd-rows">
                <Row label="Source"><button className="gd-link" onClick={() => openExternal(e.source.url)}>{PROVIDER_LABEL[e.source.provider] ?? e.source.name}<ArrowTopRightOnSquareIcon /></button></Row>
                <Row label="Posting quality"><span className={`gd-quality ${q.level.toLowerCase()}`}>{q.level}<span className="bars">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= q.bars ? "on" : ""} style={{ height: 5 + i * 3 }} />)}</span></span></Row>
                <Row label="Discovered">{fmtAgo(g.receivedAt)}</Row>
              </div>
            </Card>
          </div>
        </div>

        <Card icon={<DocumentTextIcon />} title="Notes from GATE Scout" aside={<span className="gd-conf">{Math.round(e.agent.confidence * 100)}% confidence</span>}>
          {notes.length ? notes.map((n) => <p key={n} className="gd-note">{n}</p>) : <p className="gd-empty">No additional notes from GATE Scout.</p>}
          {flags.length > 0 && <div className="gd-flags">{flags.map((f) => <span key={f} className={WARN_FLAGS.has(f) ? "warn" : ""}>{FLAG_LABEL[f] ?? f}</span>)}</div>}
        </Card>
      </div>

      <footer className="gd-actions">
        {(isOpen(g) || g.gateStatus === "saved_for_later") && <button className="btn primary lg" onClick={onApprove}><CheckIcon />Approve to Pipeline</button>}
        {isOpen(g) && <button className="btn lg" onClick={() => onDecide("saved_for_later")}><BookmarkIcon />Save for later</button>}
        {(isOpen(g) || g.gateStatus === "saved_for_later") && <button className="btn danger lg" onClick={() => onDecide("dismissed")}><XMarkIcon />Dismiss</button>}
        {g.gateStatus === "approved" && <>{g.linkedJobId && <button className="btn primary lg" onClick={onOpenJob}>View in pipeline</button>}<button className="btn lg" onClick={onKanban}>Open Kanban</button></>}
        {["dismissed", "expired", "duplicate"].includes(g.gateStatus) && <button className="btn lg" onClick={() => onDecide("discovered")}><ArrowPathRoundedSquareIcon />Restore to inbox</button>}
        <span className="gd-sep" />
        <button className="btn lg gd-post" onClick={() => openExternal(apply)}>Open posting<ArrowTopRightOnSquareIcon /></button>
        <small><ShieldOutline />Approving adds this to your Saved column. GATE never submits an application for you.</small>
      </footer>
    </>
  );
}
