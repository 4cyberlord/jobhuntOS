import { ArrowTopRightOnSquareIcon, CheckIcon, MinusSmallIcon, QuestionMarkCircleIcon, XMarkIcon } from "@heroicons/react/24/solid";
import type { GateEnvelope } from "@job-hunt-os/contracts";
import { FLAG_LABEL, PROVIDER_LABEL, TRACK_LABEL, WARN_FLAGS, badgeFor, deadlineOf, fitLevelFor, isPerfectFit, locationText, payText } from "../lib/gate";
import { DAY, fmtAgo, fmtDate } from "../lib/format";
import { openExternal } from "../lib/tauri";
import "./gate-assessment.css";

type Tri = boolean | null | undefined;
const Mark = ({ v, invert }: { v: Tri; invert?: boolean }) => {
  if (v == null) return <span className="ga-mark q"><QuestionMarkCircleIcon /></span>;
  const good = invert ? !v : v;
  return <span className={`ga-mark ${good ? "ok" : "bad"}`}>{good ? <CheckIcon /> : <XMarkIcon />}</span>;
};
const status = (s: string) => ({ eligible: "ok", allowed: "ok", available: "ok", not_required: "ok", likely_eligible: "maybe", likely_allowed: "maybe", unknown: "q", not_eligible: "bad", not_allowed: "bad", not_available: "bad" } as Record<string, string>)[String(s)] ?? "q";
const pretty = (s: unknown) => {
  const str = typeof s === "string" && s.trim() ? s : "Not captured";
  if (str === "Not captured") return str;
  return str.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
};
const Row = ({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) => (
  <div className="ga-row"><span>{label}</span><b className={tone}>{children}</b></div>
);
const safeFmtDate = (ms: number | undefined) => {
  if (ms == null || Number.isNaN(ms)) return "Not captured";
  try { return fmtDate(ms); } catch { return "Not captured"; }
};
const safeFmtAgo = (ms: number | undefined) => {
  if (ms == null || Number.isNaN(ms)) return "Not captured";
  try { return fmtAgo(ms); } catch { return "Not captured"; }
};
const parseDate = (v: unknown): number | undefined => {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const n = Date.parse(v);
  return Number.isNaN(n) ? undefined : n;
};

export function MatchRing({ score, size = 64 }: { score: number; size?: number }) {
  const safe = typeof score === "number" && Number.isFinite(score) ? score : 0;
  const lvl = (() => { try { return fitLevelFor({ match: { score: safe } } as unknown as GateEnvelope); } catch { return safe >= 85 ? "strong" as const : safe >= 65 ? "moderate" as const : "weak" as const; } })();
  // Normalize to the ring's strong/moderate/weak classes
  const ringLvl = lvl === "perfect" || lvl === "strong" ? "strong" : lvl === "good" || lvl === "partial" ? "moderate" : "weak";
  return (
    <div className={`ga-ring ${ringLvl}`} style={{ width: size, height: size, ["--p" as string]: `${Math.min(100, Math.max(0, safe))}%` }} role="img" aria-label={`${Math.round(safe)}% match`}>
      <b style={{ fontSize: size * 0.27 }}>{Math.round(safe)}%</b>
    </div>
  );
}

export function GateAssessment({ env, flags, compact }: { env: GateEnvelope; flags: string[]; compact?: boolean }) {
  const raw = (env ?? {}) as unknown as Record<string, unknown>;
  const mRaw = (raw.match ?? {}) as Record<string, unknown>;
  const eRaw = (raw.eligibility ?? {}) as Record<string, unknown>;
  const f1Raw = (eRaw.f1 ?? {}) as Record<string, unknown>;
  const sponsRaw = (eRaw.sponsorship ?? {}) as Record<string, unknown>;
  const oppRaw = (raw.opportunity ?? {}) as Record<string, unknown>;
  const appRaw = (oppRaw.application ?? {}) as Record<string, unknown>;
  const datesRaw = (oppRaw.dates ?? {}) as Record<string, unknown>;
  const sourceRaw = (raw.source ?? {}) as Record<string, unknown>;
  const agentRaw = (raw.agent ?? {}) as Record<string, unknown>;
  const companyRaw = (raw.company ?? {}) as Record<string, unknown>;
  const safeFlags = Array.isArray(flags) ? flags : [];
  const scoreNum = typeof mRaw.score === "number" && Number.isFinite(mRaw.score) ? mRaw.score : 0;
  const reason = typeof mRaw.reason === "string" && mRaw.reason.trim() ? mRaw.reason : "No explanation provided by the agent.";
  const matchingSkills: string[] = Array.isArray(mRaw.matching_skills) ? (mRaw.matching_skills as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const matchingExp: string[] = Array.isArray(mRaw.matching_experience) ? (mRaw.matching_experience as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const matchingEdu: string[] = Array.isArray(mRaw.matching_education) ? (mRaw.matching_education as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const missingOrUnclear: string[] = Array.isArray(mRaw.missing_or_unclear) ? (mRaw.missing_or_unclear as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const lvl = (() => { try { return fitLevelFor(env); } catch { return "low" as const; } })();
  const badge = (() => { try { return badgeFor(env); } catch { return "LOW MATCH"; } })();
  const perfect = (() => { try { return isPerfectFit(env); } catch { return false; } })();
  const dl = (() => { try { return deadlineOf(env); } catch { return undefined; } })();
  const left = dl ? Math.ceil((dl - Date.now()) / DAY) : undefined;
  const locText = (() => { try { return locationText(env); } catch { return "Not captured"; } })();
  const payLabel = (() => { try { return payText(env); } catch { return "—"; } })();
  const workArr = typeof oppRaw.work_arrangement === "string" ? oppRaw.work_arrangement : "unknown";
  const track = typeof oppRaw.track === "string" ? oppRaw.track : "other";
  const season = typeof oppRaw.season === "string" ? oppRaw.season : undefined;
  const statusStr = typeof appRaw.status === "string" ? appRaw.status : "unknown";
  const duration = typeof datesRaw.duration_weeks === "number" && Number.isFinite(datesRaw.duration_weeks) ? datesRaw.duration_weeks : undefined;
  const provider = typeof sourceRaw.provider === "string" ? sourceRaw.provider : "other";
  const sourceName = typeof sourceRaw.name === "string" ? sourceRaw.name : provider;
  const sourceOfficial = !!sourceRaw.official;
  const sourceUrl = typeof sourceRaw.url === "string" ? sourceRaw.url : "";
  const firstSeen = parseDate(sourceRaw.first_seen_at);
  const lastVerified = parseDate(sourceRaw.last_verified_at);
  const agentName = typeof agentRaw.name === "string" ? agentRaw.name : "GATE Scout";
  const agentDecision = typeof agentRaw.decision === "string" ? agentRaw.decision : "surface";
  const agentConf = typeof agentRaw.confidence === "number" && Number.isFinite(agentRaw.confidence) ? agentRaw.confidence : 0.5;
  const companyName = typeof companyRaw.name === "string" ? companyRaw.name : "Unknown company";

  void companyName; void perfect;

  return (
    <div className={`ga ${compact ? "compact" : ""}`}>
      <section className="ga-card ga-match">
        <MatchRing score={scoreNum} />
        <div>
          <span className={`ga-level ${lvl}`}>{badge}</span>
          <p>{reason}</p>
          <small>Score reflects résumé and requirement alignment, not your chance of an offer.</small>
        </div>
      </section>

      <section className="ga-card">
        <h4>Why this matched</h4>
        {matchingSkills.length > 0 && <div className="ga-chips">{matchingSkills.map((s) => <span key={s} className="ga-chip good"><CheckIcon />{s}</span>)}</div>}
        <ul className="ga-list good">{[...matchingExp, ...matchingEdu].map((x) => <li key={x}><CheckIcon />{x}</li>)}</ul>
        {matchingSkills.length === 0 && matchingExp.length === 0 && matchingEdu.length === 0 && <p className="ga-empty">Match details weren’t captured for this opportunity.</p>}
        {missingOrUnclear.length > 0 && (<><h4 className="ga-sub">Potential gaps</h4><ul className="ga-list gap">{missingOrUnclear.map((x) => <li key={x}><QuestionMarkCircleIcon />{x}</li>)}</ul></>)}
      </section>

      <section className="ga-card">
        <h4>Eligibility</h4>
        <div className="ga-grid">
          <Row label="Degree"><Mark v={eRaw.degree_match as Tri} /></Row>
          <Row label="Graduation window"><Mark v={eRaw.graduation_match as Tri} /></Row>
          <Row label="Student status"><Mark v={eRaw.student_status_match as Tri} /></Row>
          <Row label="Citizenship required">{eRaw.citizenship_required ? "Yes" : "No"} <Mark v={eRaw.citizenship_required as Tri} invert /></Row>
          <Row label="US person required">{eRaw.us_person_required ? "Yes" : "No"} <Mark v={eRaw.us_person_required as Tri} invert /></Row>
          <Row label="F-1 student" tone={`t-${status(String(f1Raw.status ?? "unknown"))}`}>{pretty(f1Raw.status ?? "unknown")}</Row>
          <Row label="CPT" tone={`t-${status(String(f1Raw.cpt_status ?? "unknown"))}`}>{pretty(f1Raw.cpt_status ?? "unknown")}</Row>
          <Row label="OPT" tone={`t-${status(String(f1Raw.opt_status ?? "unknown"))}`}>{pretty(f1Raw.opt_status ?? "unknown")}</Row>
          <Row label="Sponsorship" tone={`t-${status(String(sponsRaw.status ?? "unknown"))}`}>{pretty(sponsRaw.status ?? "unknown")}</Row>
        </div>
        {typeof eRaw.work_authorization_note === "string" && eRaw.work_authorization_note.trim() ? <p className="ga-note">{eRaw.work_authorization_note as string}</p> : null}
      </section>

      <section className="ga-card">
        <h4>Opportunity</h4>
        <div className="ga-grid">
          <Row label="Location">{locText}</Row>
          <Row label="Work arrangement">{pretty(workArr)}</Row>
          <Row label="Compensation">{payLabel}</Row>
          <Row label="Season">{season ?? "—"}</Row>
          <Row label="Duration">{duration ? `${duration} weeks` : "—"}</Row>
          <Row label="Track">{(() => { try { return TRACK_LABEL(track); } catch { return track; } })()}</Row>
          <Row label="Posting">{pretty(statusStr)}</Row>
          <Row label="Deadline" tone={left !== undefined && left <= 4 ? "t-bad" : undefined}>{dl ? `${safeFmtDate(dl)}${left !== undefined && left >= 0 ? ` · ${left}d left` : ""}` : "Not stated"}</Row>
        </div>
      </section>

      <section className="ga-card">
        <h4>Source</h4>
        <div className="ga-grid">
          <Row label="Provider">{PROVIDER_LABEL[provider] ?? provider}</Row>
          <Row label="Listing">{sourceName}</Row>
          <Row label="Official posting" tone={sourceOfficial ? "t-ok" : "t-maybe"}>{sourceOfficial ? "Yes" : "Unverified"}</Row>
          <Row label="First seen">{firstSeen ? safeFmtAgo(firstSeen) : "Not captured"}</Row>
          <Row label="Last verified">{lastVerified ? safeFmtAgo(lastVerified) : "Not captured"}</Row>
        </div>
        {sourceUrl ? <button className="link ga-open" onClick={() => void openExternal(sourceUrl)}>Open source listing <ArrowTopRightOnSquareIcon /></button> : <p className="ga-empty">Source link not captured.</p>}
      </section>

      <section className="ga-card">
        <h4>Agent</h4>
        <div className="ga-grid">
          <Row label="Agent">{agentName}</Row>
          <Row label="Decision">{pretty(agentDecision)}</Row>
          <Row label="Confidence"><span className="ga-conf"><i style={{ width: `${Math.round(agentConf * 100)}%` }} /></span>{Math.round(agentConf * 100)}%</Row>
        </div>
        {safeFlags.length > 0 && <div className="ga-chips">{safeFlags.map((f) => <span key={f} className={`ga-flag ${WARN_FLAGS.has(f) ? "warn" : "good"}`}>{FLAG_LABEL[f] ?? f}</span>)}</div>}
      </section>
    </div>
  );
}

export { MinusSmallIcon };
