import { ArrowTopRightOnSquareIcon, CheckIcon, MinusSmallIcon, QuestionMarkCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";
import type { GateEnvelope } from "@job-hunt-os/contracts";
import { FLAG_LABEL, PROVIDER_LABEL, TRACK_LABEL, WARN_FLAGS, deadlineOf, levelFor, locationText, payText } from "../lib/gate";
import { DAY, fmtAgo, fmtDate } from "../lib/format";
import { openExternal } from "../lib/tauri";
import "./gate-assessment.css";

type Tri = boolean | null | undefined;
const Mark = ({ v, invert }: { v: Tri; invert?: boolean }) => {
  if (v == null) return <span className="ga-mark q"><QuestionMarkCircleIcon /></span>;
  const good = invert ? !v : v;
  return <span className={`ga-mark ${good ? "ok" : "bad"}`}>{good ? <CheckIcon /> : <XMarkIcon />}</span>;
};
const status = (s: string) => ({ eligible: "ok", allowed: "ok", available: "ok", not_required: "ok", likely_eligible: "maybe", likely_allowed: "maybe", unknown: "q", not_eligible: "bad", not_allowed: "bad", not_available: "bad" })[s] ?? "q";
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const Row = ({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) => (
  <div className="ga-row"><span>{label}</span><b className={tone}>{children}</b></div>
);

export function MatchRing({ score, size = 64 }: { score: number; size?: number }) {
  const lvl = score >= 85 ? "strong" : score >= 65 ? "moderate" : "weak";
  return (
    <div className={`ga-ring ${lvl}`} style={{ width: size, height: size, ["--p" as string]: `${score}%` }} role="img" aria-label={`${score}% match`}>
      <b style={{ fontSize: size * 0.27 }}>{Math.round(score)}%</b>
    </div>
  );
}

export function GateAssessment({ env, flags, compact }: { env: GateEnvelope; flags: string[]; compact?: boolean }) {
  const m = env.match;
  const e = env.eligibility;
  const lvl = levelFor(env);
  const dl = deadlineOf(env);
  const left = dl ? Math.ceil((dl - Date.now()) / DAY) : undefined;
  return (
    <div className={`ga ${compact ? "compact" : ""}`}>
      <section className="ga-card ga-match">
        <MatchRing score={m.score} />
        <div>
          <span className={`ga-level ${lvl}`}>{lvl} match</span>
          <p>{m.reason || "No explanation provided by the agent."}</p>
          <small>Score reflects résumé and requirement alignment, not your chance of an offer.</small>
        </div>
      </section>

      <section className="ga-card">
        <h4>Why this matched</h4>
        {m.matching_skills.length > 0 && <div className="ga-chips">{m.matching_skills.map((s) => <span key={s} className="ga-chip good"><CheckIcon />{s}</span>)}</div>}
        <ul className="ga-list good">{[...m.matching_experience, ...m.matching_education].map((x) => <li key={x}><CheckIcon />{x}</li>)}</ul>
        {m.missing_or_unclear.length > 0 && (<><h4 className="ga-sub">Potential gaps</h4><ul className="ga-list gap">{m.missing_or_unclear.map((x) => <li key={x}><QuestionMarkCircleIcon />{x}</li>)}</ul></>)}
      </section>

      <section className="ga-card">
        <h4>Eligibility</h4>
        <div className="ga-grid">
          <Row label="Degree"><Mark v={e.degree_match} /></Row>
          <Row label="Graduation window"><Mark v={e.graduation_match} /></Row>
          <Row label="Student status"><Mark v={e.student_status_match} /></Row>
          <Row label="Citizenship required">{e.citizenship_required ? "Yes" : "No"} <Mark v={e.citizenship_required} invert /></Row>
          <Row label="US person required">{e.us_person_required ? "Yes" : "No"} <Mark v={e.us_person_required} invert /></Row>
          <Row label="F-1 student" tone={`t-${status(e.f1.status)}`}>{pretty(e.f1.status)}</Row>
          <Row label="CPT" tone={`t-${status(e.f1.cpt_status)}`}>{pretty(e.f1.cpt_status)}</Row>
          <Row label="OPT" tone={`t-${status(e.f1.opt_status)}`}>{pretty(e.f1.opt_status)}</Row>
          <Row label="Sponsorship" tone={`t-${status(e.sponsorship.status)}`}>{pretty(e.sponsorship.status)}</Row>
        </div>
        {e.work_authorization_note && <p className="ga-note">{e.work_authorization_note}</p>}
      </section>

      <section className="ga-card">
        <h4>Opportunity</h4>
        <div className="ga-grid">
          <Row label="Location">{locationText(env)}</Row>
          <Row label="Work arrangement">{pretty(env.opportunity.work_arrangement)}</Row>
          <Row label="Compensation">{payText(env)}</Row>
          <Row label="Season">{env.opportunity.season ?? "—"}</Row>
          <Row label="Duration">{env.opportunity.dates.duration_weeks ? `${env.opportunity.dates.duration_weeks} weeks` : "—"}</Row>
          <Row label="Track">{TRACK_LABEL(env.opportunity.track)}</Row>
          <Row label="Posting">{pretty(env.opportunity.application.status)}</Row>
          <Row label="Deadline" tone={left !== undefined && left <= 4 ? "t-bad" : undefined}>{dl ? `${fmtDate(dl)}${left !== undefined && left >= 0 ? ` · ${left}d left` : ""}` : "Not stated"}</Row>
        </div>
      </section>

      <section className="ga-card">
        <h4>Source</h4>
        <div className="ga-grid">
          <Row label="Provider">{PROVIDER_LABEL[env.source.provider] ?? env.source.provider}</Row>
          <Row label="Listing">{env.source.name}</Row>
          <Row label="Official posting" tone={env.source.official ? "t-ok" : "t-maybe"}>{env.source.official ? "Yes" : "Unverified"}</Row>
          <Row label="First seen">{fmtAgo(Date.parse(env.source.first_seen_at))}</Row>
          <Row label="Last verified">{fmtAgo(Date.parse(env.source.last_verified_at))}</Row>
        </div>
        <button className="link ga-open" onClick={() => openExternal(env.source.url)}>Open source listing <ArrowTopRightOnSquareIcon /></button>
      </section>

      <section className="ga-card">
        <h4>Agent</h4>
        <div className="ga-grid">
          <Row label="Agent">{env.agent.name}</Row>
          <Row label="Decision">{pretty(env.agent.decision)}</Row>
          <Row label="Confidence"><span className="ga-conf"><i style={{ width: `${Math.round(env.agent.confidence * 100)}%` }} /></span>{Math.round(env.agent.confidence * 100)}%</Row>
        </div>
        {flags.length > 0 && <div className="ga-chips">{flags.map((f) => <span key={f} className={`ga-flag ${WARN_FLAGS.has(f) ? "warn" : "good"}`}>{FLAG_LABEL[f] ?? f}</span>)}</div>}
      </section>
    </div>
  );
}

export { MinusSmallIcon };
