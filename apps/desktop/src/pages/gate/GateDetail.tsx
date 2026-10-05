import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowPathRoundedSquareIcon, ArrowTopRightOnSquareIcon, ArrowUturnLeftIcon, BookmarkIcon, BriefcaseIcon, CalendarDaysIcon, CheckBadgeIcon, CheckIcon, ChevronRightIcon, DocumentTextIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon, LinkIcon, MapPinIcon, MinusSmallIcon, ShieldCheckIcon, SparklesIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { AcademicCapIcon, BanknotesIcon, GlobeAltIcon, IdentificationIcon, ShieldCheckIcon as ShieldOutline, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import { RefactorResumeModal } from "./RefactorResumeModal";
import { DAY, fmtAgo, fmtDate } from "../../lib/format";
import { FLAG_LABEL, PROVIDER_LABEL, STATUS_LABEL, TRACK_LABEL, WARN_FLAGS, badgeFor, deadlineOf, fitLevelFor, flagsFor, gateDataAvailability, isOpen, isPerfectFit, locationText, payText } from "../../lib/gate";
import { openExternal } from "../../lib/tauri";
import type { GateOpportunity } from "../../lib/types";
import { Logo } from "../../components/Logo";
import { postingQuality } from "./filters";
import { Ring } from "./ui";

type Tone = "ok" | "maybe" | "bad" | "q";
type DetailTab = "overview" | "details" | "requirements" | "match" | "company" | "similar";
const TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "details", label: "Job Details" }, { id: "requirements", label: "Requirements" },
  { id: "match", label: "Match Analysis" }, { id: "company", label: "Company" }, { id: "similar", label: "Similar Opportunities" },
];
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const toneOf = (s: string): Tone => (({ eligible: "ok", allowed: "ok", available: "ok", not_required: "ok", likely_eligible: "maybe", likely_allowed: "maybe", not_eligible: "bad", not_allowed: "bad", not_available: "bad" }) as Record<string, Tone>)[s] ?? "q";
const tri = (v: boolean | null | undefined, yes: string, no: string): [string, Tone] => v == null ? ["Not captured", "q"] : v ? [yes, "ok"] : [no, "bad"];
const eligibilityText = (v: string) => v === "unknown" ? "Not captured" : pretty(v);
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stringValue = (v: unknown) => typeof v === "string" && v.trim() ? v : undefined;
const numberValue = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const dateValue = (v: unknown) => { const s = stringValue(v); if (!s) return undefined; const n = Date.parse(s); return Number.isNaN(n) ? undefined : n; };
const safeFmtDate = (ms: number | undefined) => {
  if (ms == null || Number.isNaN(ms)) return "Not captured";
  try { return fmtDate(ms); } catch { return "Not captured"; }
};
const safeFmtAgo = (ms: number | undefined) => {
  if (ms == null || Number.isNaN(ms)) return "Not captured";
  try { return fmtAgo(ms); } catch { return "Not captured"; }
};

const Mark = ({ tone }: { tone: Tone }) => <span className={`gd-mark ${tone}`}>{tone === "bad" ? <XMarkIcon /> : tone === "q" ? <MinusSmallIcon /> : <CheckIcon />}</span>;
const Row = ({ label, children, tone, mark }: { label: string; children: ReactNode; tone?: Tone; mark?: Tone }) => (
  <div className="gd-row"><span>{label}</span><b className={tone ? `t-${tone}` : ""}>{children}{mark ? <Mark tone={mark} /> : null}</b></div>
);
const Card = ({ icon, title, aside, children, className = "" }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`gd-card ${className}`}><header><span className="gd-ico">{icon}</span><h3>{title}</h3>{aside ? <div className="gd-aside">{aside}</div> : null}</header>{children}</section>
);

type Props = {
  g: GateOpportunity;
  similar: GateOpportunity[];
  onSelectSimilar: (id: string) => void;
  onApprove: () => void;
  onDecide: (s: "dismissed" | "saved_for_later" | "discovered") => void;
  onOpenJob: () => void;
  onKanban: () => void;
  onCopied: () => void;
};

export function GateDetail({ g, similar, onSelectSimilar, onApprove, onDecide, onOpenJob, onKanban, onCopied }: Props) {
  // Hardened: older stored opportunities may lack GATE 2.x layers or even core match/eligibility/source fields. Never crash.
  const safeG = g ?? {} as GateOpportunity;
  const rawEnvelope = (safeG.envelope ?? {}) as unknown as Record<string, unknown>;
  const e = rawEnvelope as unknown as GateOpportunity["envelope"];
  const mRaw = (rawEnvelope.match ?? {}) as Record<string, unknown>;
  const m = {
    score: typeof mRaw.score === "number" && Number.isFinite(mRaw.score) ? mRaw.score as number : 0,
    reason: typeof mRaw.reason === "string" ? mRaw.reason as string : "",
    supporting_evidence: Array.isArray(mRaw.supporting_evidence) ? mRaw.supporting_evidence as string[] : [],
    matching_experience: Array.isArray(mRaw.matching_experience) ? mRaw.matching_experience as string[] : [],
    matching_education: Array.isArray(mRaw.matching_education) ? mRaw.matching_education as string[] : [],
    already_satisfies: Array.isArray(mRaw.already_satisfies) ? mRaw.already_satisfies as { requirement: string; evidence?: string | null; profile_evidence?: string | null }[] : [],
    missing: Array.isArray(mRaw.missing) ? mRaw.missing as { requirement: string; type?: string; status?: string; reason?: string | null }[] : [],
    missing_or_unclear: Array.isArray(mRaw.missing_or_unclear) ? mRaw.missing_or_unclear as string[] : [],
    unknown: Array.isArray(mRaw.unknown) ? mRaw.unknown as { field: string; reason?: string | null }[] : [],
    recommended_resume_emphasis: Array.isArray(mRaw.recommended_resume_emphasis) ? mRaw.recommended_resume_emphasis as string[] : [],
    eligibility_risk: (mRaw.eligibility_risk && typeof mRaw.eligibility_risk === "object" ? mRaw.eligibility_risk : { level: "unknown", reason: null }) as { level: string; reason?: string | null },
  } as unknown as GateOpportunity["envelope"]["match"];
  const elRaw = (rawEnvelope.eligibility ?? {}) as Record<string, unknown>;
  const f1Raw = (elRaw.f1 ?? {}) as Record<string, unknown>;
  const sponsorshipRaw = (elRaw.sponsorship ?? {}) as Record<string, unknown>;
  const el = {
    degree_match: (elRaw.degree_match as boolean | null | undefined) ?? null,
    graduation_match: (elRaw.graduation_match as boolean | null | undefined) ?? null,
    student_status_match: (elRaw.student_status_match as boolean | null | undefined) ?? null,
    citizenship_required: !!elRaw.citizenship_required,
    us_person_required: !!elRaw.us_person_required,
    f1: { status: typeof f1Raw.status === "string" ? f1Raw.status : "unknown", cpt_status: typeof f1Raw.cpt_status === "string" ? f1Raw.cpt_status : "unknown", opt_status: typeof f1Raw.opt_status === "string" ? f1Raw.opt_status : "unknown" },
    sponsorship: { status: typeof sponsorshipRaw.status === "string" ? sponsorshipRaw.status : "unknown" },
    work_authorization_note: typeof elRaw.work_authorization_note === "string" ? elRaw.work_authorization_note as string : undefined,
  } as unknown as GateOpportunity["envelope"]["eligibility"];
  const facts = (rawEnvelope.structured_facts ?? null) as GateOpportunity["envelope"]["structured_facts"] | null;
  const posting = (rawEnvelope.original_posting ?? null) as GateOpportunity["envelope"]["original_posting"] | null;
  const assessment = (rawEnvelope.gate_assessment ?? null) as GateOpportunity["envelope"]["gate_assessment"] | null;
  let flags: string[] = []; let level: ReturnType<typeof fitLevelFor> = "low" as ReturnType<typeof fitLevelFor>; let badge = "LOW MATCH"; let perfect = false;
  try { flags = flagsFor(safeG as GateOpportunity); } catch { flags = []; }
  try { level = fitLevelFor(e); } catch { level = "low" as ReturnType<typeof fitLevelFor>; }
  try { badge = badgeFor(e); } catch { badge = "LOW MATCH"; }
  try { perfect = isPerfectFit(e); } catch { perfect = false; }
  const dl = (() => { try { return deadlineOf(e); } catch { return undefined; } })();
  const left = dl ? Math.ceil((dl - Date.now()) / DAY) : undefined;
  const urgent = left !== undefined && left >= 0 && left <= 4;
  let q: ReturnType<typeof postingQuality> = { level: "Low", bars: 1 };
  try { q = postingQuality(safeG as GateOpportunity); } catch { q = { level: "Low", bars: 1 }; }
  const warnings = (flags as string[]).filter((f) => WARN_FLAGS.has(f) && f !== "deadline_soon");
  const [menu, setMenu] = useState(false), [tab, setTab] = useState<DetailTab>("overview"), [refactorOpen, setRefactorOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { setTab("overview"); scroller.current?.scrollTo({ top: 0 }); setMenu(false); }, [safeG.id]);
  useEffect(() => {
    if (!menu) return;
    const off = (ev: Event) => { if (ev instanceof globalThis.KeyboardEvent ? ev.key === "Escape" : !menuRef.current?.contains(ev.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", off); };
  }, [menu]);

  const chooseTab = (next: DetailTab) => { setTab(next); scroller.current?.scrollTo({ top: 0 }); };
  const tabKey = (ev: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    ev.preventDefault();
    const next = (index + delta + TABS.length) % TABS.length;
    chooseTab(TABS[next].id);
    document.getElementById(`gate-tab-${TABS[next].id}`)?.focus();
  };
  const applyRaw = (rawEnvelope.opportunity as unknown as { application?: { apply_url?: unknown } })?.application?.apply_url;
  const apply = typeof applyRaw === "string" && applyRaw.trim() ? applyRaw : ((rawEnvelope.source as unknown as { url?: unknown })?.url as string) ?? "";
  const available = (() => { try { return gateDataAvailability(e); } catch { return { assessment: false, eligibility: false, citizenship: false, usPerson: false } as ReturnType<typeof gateDataAvailability>; } })();
  const place = (() => { try { return locationText(e); } catch { return "—"; } })();
  const rawReason = typeof m.reason === "string" ? m.reason : "";
  const scoreNum = typeof m.score === "number" && Number.isFinite(m.score) ? m.score : 0;
  const reason = rawReason && !/^Imported from the GATE relay/i.test(rawReason) ? rawReason : available.assessment ? `${badge} based on the captured requirements and candidate evidence.` : `Scored ${Math.round(scoreNum)}% at discovery. Detailed breakdown unavailable.`;
  const evidenceLines = (Array.isArray(m.supporting_evidence) && m.supporting_evidence.length ? m.supporting_evidence : [...(Array.isArray(m.matching_experience) ? m.matching_experience : []), ...(Array.isArray(m.matching_education) ? m.matching_education : [])]) as string[];
  const [degree, grad, student] = [tri(el.degree_match, "Matches", "Doesn't match"), tri(el.graduation_match, "In window", "Outside window"), tri(el.student_status_match, "Eligible student", "Not eligible")];
  const opportunityRaw = (rawEnvelope.opportunity ?? {}) as Record<string, unknown>;
  const education = record((facts as unknown as Record<string, unknown> | null)?.education), application = record((opportunityRaw.application as unknown) ?? {}), location = record((opportunityRaw.location as unknown) ?? {}), internship = record((opportunityRaw.internship as unknown) ?? {});
  const degreeRequired = stringValue(education.degree_required);
  const degreeFields = Array.isArray(education.degree_fields) ? (education.degree_fields as unknown[]).filter((x): x is string => typeof x === "string") as string[] : [];
  const postedAt = dateValue(application.posted_at), applicationCount = stringValue(application.applications) ?? numberValue(application.applications)?.toLocaleString();
  const officeDays = numberValue(location.office_days_per_week), schedule = stringValue(internship.schedule);
  const roleSummary = (typeof opportunityRaw.description_summary === "string" && opportunityRaw.description_summary.trim() ? opportunityRaw.description_summary as string : "A role summary wasn’t captured when this opportunity was discovered.");
  const companyRaw = (rawEnvelope.company ?? {}) as Record<string, unknown>;
  const sourceRaw = (rawEnvelope.source ?? {}) as Record<string, unknown>;
  const agentRaw = (rawEnvelope.agent ?? {}) as Record<string, unknown>;
  const safeCompanyName = stringValue(companyRaw.name) ?? "Unknown company";
  const safeCompanyWebsite = stringValue(companyRaw.website);
  const safeCompanyCareers = stringValue(companyRaw.careers_url);
  const safeCompanyLogo = stringValue(companyRaw.logo_url);
  const safeCompanyIndustry = stringValue(companyRaw.industry);
  const safeCompanyHeadquarters = stringValue(companyRaw.headquarters);
  const safeTitle = stringValue(opportunityRaw.title) ?? (posting && typeof (posting as unknown as Record<string, unknown>).raw_title === "string" ? stringValue((posting as unknown as Record<string, unknown>).raw_title) : undefined) ?? "Untitled opportunity";
  const safeExternalId = stringValue(opportunityRaw.external_id) ?? "";
  const safeWorkArrangement = stringValue(opportunityRaw.work_arrangement) ?? "unknown";
  const safeEmploymentType = stringValue(opportunityRaw.employment_type) ?? "—";
  const safeTrack = stringValue(opportunityRaw.track) ?? "other";
  const safeSeason = stringValue(opportunityRaw.season);
  const safeProvider = stringValue(sourceRaw.provider) ?? "other";
  const safeSourceOfficial = !!sourceRaw.official;
  const safeSourceUrl = stringValue(sourceRaw.url) ?? apply;
  const safeSourceName = stringValue(sourceRaw.name) ?? safeProvider;
  const safeSourceFirstSeen = dateValue(sourceRaw.first_seen_at);
  const safeSourceLastVerified = dateValue(sourceRaw.last_verified_at);
  const safeAgentDecision = stringValue(agentRaw.decision) ?? "surface";
  const safeGateStatus = (safeG.gateStatus ?? "discovered") as GateOpportunity["gateStatus"];
  const safeReceivedAt = typeof safeG.receivedAt === "number" && Number.isFinite(safeG.receivedAt) ? safeG.receivedAt : Date.now();
  const safeTrackLabel = (() => { try { return TRACK_LABEL(safeTrack); } catch { return safeTrack; } })();
  const safePlaceDisplay = place && place !== "—" ? place : "Not captured";
  const payLabel = (() => { try { return payText(e); } catch { return "—"; } })();
  const compAvailable = !!(rawEnvelope.compensation as unknown);
  const durationWeeks = (() => {
    const datesRaw = opportunityRaw.dates as unknown as Record<string, unknown> | undefined;
    const v = datesRaw?.duration_weeks;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  })();
  const canOpenApply = !!apply;
  const canOpenSource = !!safeSourceUrl;
  const canOpenWebsite = !!safeCompanyWebsite;
  const canOpenCareers = !!safeCompanyCareers;
  const copy = async () => { if (!apply) return; try { await navigator.clipboard.writeText(apply); onCopied(); } catch { /* unavailable */ } setMenu(false); };
  const openApply = () => { if (apply) void openExternal(apply); };
  const openSource = () => { if (safeSourceUrl) { void openExternal(safeSourceUrl); setMenu(false); } };
  const openWebsite = () => { if (safeCompanyWebsite) void openExternal(safeCompanyWebsite); };
  const openCareers = () => { if (safeCompanyCareers) void openExternal(safeCompanyCareers); };
  const isOpenStatus = (() => { try { return isOpen(safeG as GateOpportunity); } catch { return safeGateStatus === "discovered" || safeGateStatus === "reviewing"; } })();

  return (
    <>
      <header className="gd-head">
        <Logo name={safeCompanyName} size={64} hints={{ website: safeCompanyWebsite, applyUrl: apply, logoUrl: safeCompanyLogo }} />
        <div className="gd-title">
          <div className="gd-title-head">
            <h2>{safeTitle}</h2>
            <span className={`gd-status st-${safeGateStatus}`}>{STATUS_LABEL[safeGateStatus] ?? pretty(safeGateStatus)}</span>
            <div className="gd-menu" ref={menuRef}>
              <button className="gd-icon-btn" aria-label="More actions" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><EllipsisHorizontalIcon /></button>
              {menu ? <div className="gd-pop" role="menu">
                <button role="menuitem" onClick={copy} disabled={!canOpenApply}><LinkIcon />Copy apply link</button>
                <button role="menuitem" onClick={openSource} disabled={!canOpenSource}><ArrowTopRightOnSquareIcon />Open source listing</button>
                {!isOpenStatus ? <button role="menuitem" onClick={() => { onDecide("discovered"); setMenu(false); }}><ArrowUturnLeftIcon />Restore to inbox</button> : null}
              </div> : null}
            </div>
          </div>
          <div className="gd-co">{safeCompanyName}{safeSourceOfficial ? <CheckBadgeIcon className="g-verified" aria-label="Official source" /> : null}</div>
          <div className="gd-meta">{safePlaceDisplay !== "Not captured" ? <span><MapPinIcon />{safePlaceDisplay}</span> : null}{safeWorkArrangement !== "unknown" ? <span><BriefcaseIcon />{pretty(safeWorkArrangement)}</span> : null}</div>
          <div className="gd-head-chips">
            <span>{pretty(safeEmploymentType)}</span>
            {officeDays !== undefined ? <span>Onsite {officeDays} day{officeDays === 1 ? "" : "s"}/week</span> : null}
            {payLabel !== "—" ? <span>{payLabel}</span> : null}
            {degreeRequired ? <span>{degreeRequired}</span> : null}
            {safeSeason ? <span><CalendarDaysIcon />{safeSeason}</span> : null}
          </div>
        </div>
        <div className="gd-head-right">
          <div className="gd-head-top">
            <button className="gd-action secondary" aria-describedby="gd-refactor-note" onClick={() => setRefactorOpen(true)}><WrenchScrewdriverIcon />Refactor Resume</button>
            <span id="gd-refactor-note" className="sr-only">Open LaTeX editor to tailor your resume to this job.</span>
            <button className="gd-action primary" onClick={openApply} disabled={!canOpenApply} title={canOpenApply ? "Open application" : "Apply link not captured"}><LinkIcon />Apply</button>
          </div>
        </div>
      </header>
      {refactorOpen && <RefactorResumeModal gateId={safeG.id} onClose={() => setRefactorOpen(false)} />}

      <nav className="gd-tabs" role="tablist" aria-label="Opportunity details">
        {TABS.map((item, index) => <button key={item.id} id={`gate-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls="gate-detail-panel" tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? "on" : ""} onClick={() => chooseTab(item.id)} onKeyDown={(ev) => tabKey(ev, index)}>{item.label}</button>)}
      </nav>

      <div id="gate-detail-panel" className="gd-scroll" ref={scroller} role="tabpanel" aria-labelledby={`gate-tab-${tab}`} tabIndex={0}>
        {safeAgentDecision === "needs_review" ? <div className="gd-alert"><ExclamationTriangleIcon />GATE Scout flagged this one for your review. Check eligibility before approving.</div> : null}

        {tab === "overview" ? <div className="gd-reference-grid">
          <div className="gd-main-column">
            <Card icon={<BriefcaseIcon />} title="About the role">
              <p className="gd-lead">{roleSummary}</p>
              {facts?.responsibilities?.length ? <div className="gd-fact-list"><h4>Key responsibilities</h4><ul>{facts.responsibilities.slice(0, 6).map((x, i) => <li key={`${i}-${x.value}`}>{x.value}</li>)}</ul></div> : <p className="gd-empty">Responsibilities weren’t captured for this opportunity.</p>}
              {assessment?.recommended_next_action ? <div className="gd-next"><b>Recommended next action</b><p>{assessment.recommended_next_action}</p>{assessment.urgency_reason ? <small>{assessment.urgency_reason}</small> : null}</div> : null}
            </Card>
          </div>
          <aside className="gd-info-rail">
            <Card icon={<CalendarDaysIcon />} title="Application information">
              <div className="gd-rows">
                <Row label="Posted">{postedAt ? `${safeFmtDate(postedAt)} (${safeFmtAgo(postedAt)})` : "Not captured"}</Row>
                <Row label="Deadline" tone={urgent ? "bad" : undefined}>{dl ? `${safeFmtDate(dl)}${left !== undefined && left >= 0 ? ` (in ${left} day${left === 1 ? "" : "s"})` : ""}` : "Not captured"}</Row>
                <Row label="Applications">{applicationCount ?? "Not captured"}</Row><Row label="Job ID">{safeExternalId || "Not captured"}</Row>
              </div>
              <button className="gd-outline-link" onClick={openApply} disabled={!canOpenApply}>Open application<ArrowTopRightOnSquareIcon /></button>
            </Card>
            <Card icon={<GlobeAltIcon />} title="Company information">
              <div className="gd-company-mini"><Logo name={safeCompanyName} size={44} hints={{ website: safeCompanyWebsite, applyUrl: apply, logoUrl: safeCompanyLogo }} /><div><b>{safeCompanyName}</b><span>{[safeCompanyIndustry, safeCompanyHeadquarters].filter(Boolean).join(" · ") || "Company details not captured"}</span></div></div>
              {canOpenWebsite ? <button className="gd-link" onClick={openWebsite}>Website<ArrowTopRightOnSquareIcon /></button> : <p className="gd-empty">Website wasn’t captured.</p>}
            </Card>
          </aside>
        </div> : null}

        {tab === "details" ? <div className="gd-reference-grid">
          <div className="gd-main-column">
            <Card icon={<DocumentTextIcon />} title="Responsibilities and outcomes">
              <div className="gd-fact-list"><h4>Responsibilities</h4>{facts?.responsibilities?.length ? <ul>{facts.responsibilities.map((x, i) => <li key={`${i}-${x.value}`}>{x.value}{x.provenance ? <small>{x.provenance}</small> : null}</li>)}</ul> : <p className="gd-empty">Responsibilities weren’t captured.</p>}</div>
              <div className="gd-fact-list"><h4>Expected outcomes</h4>{facts?.expected_outcomes?.length ? <ul>{facts.expected_outcomes.map((x, i) => <li key={`${i}-${x.value}`}>{x.value}</li>)}</ul> : <p className="gd-empty">Expected outcomes weren’t captured.</p>}</div>
            </Card>
            <Card icon={<DocumentTextIcon />} title="Original employer posting" aside={posting?.raw_description ? <span className="gd-conf">Snapshot v{posting.snapshot_version}</span> : undefined}>
              {posting?.raw_description ? <div className="gd-posting-text">{posting.raw_description}</div> : <p className="gd-empty">The full job description wasn’t captured. You can still open the source listing.</p>}
            </Card>
          </div>
          <aside className="gd-info-rail">
            <Card icon={<BanknotesIcon />} title="Compensation and logistics"><div className="gd-rows">
              <Row label="Salary range">{!compAvailable ? "Not captured" : payLabel === "—" ? "Not listed" : payLabel}</Row><Row label="Work mode">{pretty(safeWorkArrangement)}</Row><Row label="Location">{safePlaceDisplay}</Row>
              <Row label="Duration">{durationWeeks ? `${durationWeeks} weeks` : "Not captured"}</Row><Row label="Schedule">{schedule ?? "Not captured"}</Row><Row label="Track">{safeTrackLabel}</Row>
            </div></Card>
            <Card icon={<GlobeAltIcon />} title="Source and posting quality" aside={safeSourceOfficial ? <span className="gd-official"><ShieldCheckIcon />Official</span> : <span className="gd-unverified">Unverified</span>}>
              <div className="gd-rows"><Row label="Source"><button className="gd-link" onClick={openSource} disabled={!canOpenSource}>{PROVIDER_LABEL[safeProvider] ?? safeSourceName}<ArrowTopRightOnSquareIcon /></button></Row><Row label="Posting quality">{q.level}</Row><Row label="Discovered">{safeFmtAgo(safeReceivedAt)}</Row></div>
            </Card>
          </aside>
        </div> : null}

        {tab === "requirements" ? <div className="gd-reference-grid">
          <div className="gd-main-column">
            <Card icon={<AcademicCapIcon />} title="Role requirements">
              {!facts ? <p className="gd-empty">Requirements and responsibilities weren’t captured when this opportunity was discovered.</p> : <div className="gd-requirement-stack">
                <div><h4>Required skills</h4>{facts.required_skills?.length ? <ul className="gd-dot-list">{facts.required_skills.map((x) => <li key={x.skill}>{x.skill}</li>)}</ul> : <p className="gd-empty">Required skills weren’t captured.</p>}</div>
                <div><h4>Preferred skills</h4>{facts.preferred_skills?.length ? <ul className="gd-dot-list preferred">{facts.preferred_skills.map((x) => <li key={x.skill}>{x.skill}</li>)}</ul> : <p className="gd-empty">Preferred skills weren’t captured.</p>}</div>
                <div><h4>Technologies</h4>{facts.technologies?.length ? <div className="gd-fact-skills tech">{facts.technologies.map((x) => <span key={x}>{x}</span>)}</div> : <p className="gd-empty">Technologies weren’t captured.</p>}</div>
              </div>}
            </Card>
            <Card icon={<IdentificationIcon />} title="Education"><div className="gd-rows"><Row label="Degree">{degreeRequired ?? "Not captured"}</Row><Row label="Fields">{degreeFields.length ? degreeFields.join(", ") : "Not captured"}</Row><Row label="Current enrollment">{typeof education.must_be_currently_enrolled === "boolean" ? education.must_be_currently_enrolled ? "Required" : "Not required" : "Not captured"}</Row><Row label="Minimum GPA">{numberValue(education.gpa_minimum) ?? "Not captured"}</Row></div></Card>
          </div>
          <aside className="gd-info-rail"><Card icon={<ShieldOutline />} title="Eligibility">
            {available.eligibility ? <div className="gd-rows">
              <Row label="Degree" tone={degree[1]} mark={degree[1]}>{degree[0]}</Row><Row label="Graduation window" tone={grad[1]} mark={grad[1]}>{grad[0]}</Row><Row label="Student status" tone={student[1]} mark={student[1]}>{student[0]}</Row>
              <Row label="Citizenship required" tone={available.citizenship ? el.citizenship_required ? "bad" : "ok" : "q"}>{available.citizenship ? el.citizenship_required ? "Yes" : "No" : "Not captured"}</Row>
              <Row label="US person required" tone={available.usPerson ? el.us_person_required ? "bad" : "ok" : "q"}>{available.usPerson ? el.us_person_required ? "Yes" : "No" : "Not captured"}</Row>
              <Row label="F-1 student" tone={toneOf(el.f1.status)}>{eligibilityText(el.f1.status)}</Row><Row label="CPT" tone={toneOf(el.f1.cpt_status)}>{eligibilityText(el.f1.cpt_status)}</Row><Row label="OPT" tone={toneOf(el.f1.opt_status)}>{eligibilityText(el.f1.opt_status)}</Row><Row label="Sponsorship" tone={toneOf(el.sponsorship.status)}>{eligibilityText(el.sponsorship.status)}</Row>
            </div> : <p className="gd-empty">Eligibility details weren’t captured for this opportunity.</p>}
            {el.work_authorization_note ? <p className="gd-note">{el.work_authorization_note}</p> : null}
          </Card></aside>
        </div> : null}

        {tab === "match" ? <>
          <section className={`gd-banner ${level} ${perfect ? "perfect-fit" : ""}`}><Ring score={scoreNum} size={82} stroke={7} /><div><span className={`gd-level ${level}`}>{badge}</span><p>{reason}</p><small>{perfect ? "Exceptional profile fit with no known hard mismatch. " : ""}Match score, not interview or offer odds.</small></div></section>
          <div className="gd-grid two">
            <Card icon={<SparklesIcon />} title="Why this matched">{available.assessment ? <>{m.already_satisfies.length ? <ul className="gd-evidence">{m.already_satisfies.map((x, i) => <li key={`${i}-${x.requirement}`}><CheckIcon /><div><b>{x.requirement}</b>{x.evidence || x.profile_evidence ? <small>{x.evidence || x.profile_evidence}</small> : null}</div></li>)}</ul> : <p className="gd-empty">Satisfied requirements weren’t itemized.</p>}<ul className="gd-checks">{evidenceLines.map((x, i) => <li key={`${i}-${x}`}><CheckIcon />{x}</li>)}</ul></> : <p className="gd-empty">Match assessment details weren’t captured for this opportunity.</p>}</Card>
            <Card icon={<ExclamationTriangleIcon />} title="Potential gaps" className="gaps">{m.missing.length + m.missing_or_unclear.length + warnings.length ? <ul className="gd-gaps">{m.missing.map((x, i) => <li key={`${i}-${x.requirement}`} className={x.type === "hard_requirement" && x.status === "not_satisfied" ? "hard" : ""}><span><b>{x.requirement}</b>{x.reason ? <small>{x.reason}</small> : null}{x.type === "hard_requirement" && x.status === "not_satisfied" ? <em>Hard requirement</em> : null}</span></li>)}{m.missing.length === 0 ? m.missing_or_unclear.map((x) => <li key={x}>{x}</li>) : null}{warnings.map((f) => <li key={f} className="flag">{FLAG_LABEL[f] ?? f}</li>)}</ul> : <p className="gd-empty good"><CheckIcon />No gaps flagged.</p>}</Card>
          </div>
          <div className="gd-grid two">
            <Card icon={<MinusSmallIcon />} title="Unknowns to confirm">{m.unknown.length ? <ul className="gd-unknowns">{m.unknown.map((x, i) => <li key={`${i}-${x.field}`}><b>{pretty(x.field)}</b>{x.reason ? <small>{x.reason}</small> : null}</li>)}</ul> : <p className="gd-empty">No unknown requirements were captured.</p>}{m.eligibility_risk.level !== "unknown" || m.eligibility_risk.reason ? <div className={`gd-risk ${m.eligibility_risk.level}`}><b>Eligibility risk: {pretty(m.eligibility_risk.level)}</b>{m.eligibility_risk.reason ? <p>{m.eligibility_risk.reason}</p> : null}</div> : null}</Card>
            <Card icon={<DocumentTextIcon />} title="Recommended résumé emphasis">{m.recommended_resume_emphasis.length ? <div className="gd-emphasis">{m.recommended_resume_emphasis.map((x) => <span key={x}>{x}</span>)}</div> : <p className="gd-empty">No résumé emphasis was captured for this opportunity.</p>}{flags.length ? <div className="gd-flags">{flags.map((f) => <span key={f} className={WARN_FLAGS.has(f) ? "warn" : ""}>{FLAG_LABEL[f] ?? f}</span>)}</div> : null}</Card>
          </div>
        </> : null}

        {tab === "company" ? <div className="gd-reference-grid company-tab">
          <div className="gd-main-column"><Card icon={<GlobeAltIcon />} title="Company"><div className="gd-company-hero"><Logo name={safeCompanyName} size={72} hints={{ website: safeCompanyWebsite, applyUrl: apply, logoUrl: safeCompanyLogo }} /><div><h3>{safeCompanyName}</h3><p>{[safeCompanyIndustry, safeCompanyHeadquarters].filter(Boolean).join(" · ") || "Company profile details weren’t captured."}</p></div></div><div className="gd-company-links">{canOpenWebsite ? <button onClick={openWebsite}>Website<ArrowTopRightOnSquareIcon /></button> : null}{canOpenCareers ? <button onClick={openCareers}>Careers<ArrowTopRightOnSquareIcon /></button> : null}<button onClick={openSource} disabled={!canOpenSource}>Job source<ArrowTopRightOnSquareIcon /></button></div>{!canOpenWebsite && !canOpenCareers ? <p className="gd-empty">Website and careers links weren’t captured.</p> : null}</Card></div>
          <aside className="gd-info-rail"><Card icon={<ShieldCheckIcon />} title="Captured source"><div className="gd-rows"><Row label="Provider">{PROVIDER_LABEL[safeProvider] ?? safeSourceName}</Row><Row label="Official">{safeSourceOfficial ? "Yes" : "Not verified"}</Row><Row label="First seen">{safeSourceFirstSeen ? safeFmtDate(safeSourceFirstSeen) : "Not captured"}</Row><Row label="Last verified">{safeSourceLastVerified ? safeFmtDate(safeSourceLastVerified) : "Not captured"}</Row></div></Card></aside>
        </div> : null}

        {tab === "similar" ? <section className="gd-similar"><header><div><h3>Similar opportunities</h3><p>Ranked from the opportunities already in your GATE Inbox.</p></div></header>{similar.length ? <div className="gd-similar-list">{similar.map((item) => {
          const sEnv = (item.envelope ?? {}) as unknown as Record<string, unknown>;
          const sComp = (sEnv.company ?? {}) as Record<string, unknown>;
          const sOpp = (sEnv.opportunity ?? {}) as Record<string, unknown>;
          const sMatch = (sEnv.match ?? {}) as Record<string, unknown>;
          const sName = typeof sComp.name === "string" ? sComp.name : "Unknown";
          const sTitle = typeof sOpp.title === "string" ? sOpp.title : "Untitled";
          const sScore = typeof sMatch.score === "number" && Number.isFinite(sMatch.score) ? Math.round(sMatch.score as number) : 0;
          let sPlace = "";
          try { sPlace = locationText(item.envelope); } catch { sPlace = ""; }
          const sWebsite = typeof sComp.website === "string" ? sComp.website : undefined;
          const sLogo = typeof sComp.logo_url === "string" ? sComp.logo_url : undefined;
          const sApply = typeof (sOpp.application as Record<string, unknown> | undefined)?.apply_url === "string" ? (sOpp.application as Record<string, unknown>).apply_url as string : undefined;
          return <button key={item.id} onClick={() => onSelectSimilar(item.id)}><Logo name={sName} size={42} hints={{ website: sWebsite, applyUrl: sApply, logoUrl: sLogo }} /><span><b>{sTitle}</b><small>{sName} · {sPlace || "—"}</small></span><em>{sScore}%</em><ChevronRightIcon /></button>;
        })}</div> : <div className="gd-similar-empty"><SparklesIcon /><b>No similar opportunities yet</b><p>More matches will appear as GATE discovers related roles.</p></div>}</section> : null}
      </div>

      <footer className="gd-actions">
        {(isOpenStatus || safeGateStatus === "saved_for_later") ? <button className="btn primary lg" onClick={onApprove}><CheckIcon />Approve to Pipeline</button> : null}
        {isOpenStatus ? <button className="btn lg" onClick={() => onDecide("saved_for_later")}><BookmarkIcon />Save for later</button> : null}
        {(isOpenStatus || safeGateStatus === "saved_for_later") ? <button className="btn danger lg" onClick={() => onDecide("dismissed")}><XMarkIcon />Dismiss</button> : null}
        {safeGateStatus === "approved" ? <>{safeG.linkedJobId ? <button className="btn primary lg" onClick={onOpenJob}>View in pipeline</button> : null}<button className="btn lg" onClick={onKanban}>Open Kanban</button></> : null}
        {["dismissed", "expired", "duplicate"].includes(safeGateStatus) ? <button className="btn lg" onClick={() => onDecide("discovered")}><ArrowPathRoundedSquareIcon />Restore to inbox</button> : null}
        <span className="gd-sep" /><small><ShieldOutline />Approving adds this to your Saved column. GATE never submits an application for you.</small>
      </footer>
    </>
  );
}
