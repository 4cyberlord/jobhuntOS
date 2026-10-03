import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpTrayIcon, BriefcaseIcon, BuildingOffice2Icon, CalendarDaysIcon, CalendarIcon, ChartBarIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon,
  DocumentTextIcon, EnvelopeIcon, LightBulbIcon, MagnifyingGlassIcon, PaperAirplaneIcon, PencilSquareIcon, PlusIcon, SparklesIcon, TrophyIcon,
} from "@heroicons/react/24/outline";
import { PageHead } from "../components/ui";
import { Logo } from "../components/Logo";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { isOpen, locationText, TRACK_LABEL } from "../lib/gate";
import { pickFiles } from "../lib/files";
import { DAY, daysSince, fmtAgo, fmtRange, fmtShort, fmtTime, sameDay, startOfDay, fmtDate } from "../lib/format";
import type { Job, Status, Task } from "../lib/types";
import { ComboChart, type Focus } from "./dashboard/Chart";
import { ACTIVE_STATUSES, appliedAt, delta, isApp, lastTouch, pointDelta, responseRate, weekSeries, type Delta } from "./dashboard/metrics";
import "./dashboard.css";

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

function Card({ title, count, action, children, className = "" }: { title: string; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card dash-card ${className}`}>
      <header>
        <h2>{title}{count !== undefined && <span className="dash-count">{count}</span>}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Kpi({ tone, icon, label, value, d, sub }: { tone: string; icon: ReactNode; label: string; value: string | number; d: Delta; sub: string }) {
  return (
    <div className="card dash-kpi">
      <span className={`dash-tile ${tone}`}>{icon}</span>
      <div className="dash-kpi-body">
        <span className="dash-kpi-label">{label}</span>
        <div className="dash-kpi-row">
          <b>{value}</b>
          <div>
            <span className={`dash-delta ${d.dir}`}>{d.text}</span>
            <small>{sub}</small>
          </div>
        </div>
      </div>
    </div>
  );
}

const TASK_ICON = { mail: EnvelopeIcon, calendar: CalendarDaysIcon, send: PaperAirplaneIcon, search: MagnifyingGlassIcon };
const TASK_TONE = { mail: "blue", calendar: "purple", send: "green", search: "blue" } as const;
const PRIO_CLASS = { High: "red", Today: "red", Medium: "blue", Low: "gray" } as const;

function TaskRow({ t, onToggle, openCount }: { t: Task; onToggle: () => void; openCount: number }) {
  const Icon = TASK_ICON[t.icon];
  return (
    <li className={`dash-task ${t.done ? "done" : ""}`}>
      <input type="checkbox" checked={t.done} onChange={onToggle} aria-label={`Mark "${t.title}" ${t.done ? "not done" : "done"}`} />
      {t.icon === "mail" && t.company ? <Logo name={t.company} size={38} /> : <span className={`dash-tile sm ${TASK_TONE[t.icon]}`}><Icon /></span>}
      <div className="dash-grow"><b>{t.title}</b><small>{/review new jobs/i.test(t.title) ? `${openCount} new match${openCount === 1 ? "" : "es"} in the GATE Inbox` : t.subtitle}</small></div>
      <div className="dash-task-meta"><span>{fmtTime(t.dueAt)}</span><i className={`dash-chip ${PRIO_CLASS[t.priority]}`}>{t.priority}</i></div>
    </li>
  );
}

const DOT: Record<Status, string> = { saved: "var(--purple)", preparing: "var(--amber)", applied: "var(--green)", interviewing: "var(--blue)", offer: "var(--purple)", rejected: "var(--red)", pending_review: "var(--faint)", dismissed: "var(--faint)" };
const BAR: Record<string, string> = { saved: "var(--purple-soft)", preparing: "var(--amber-soft)", applied: "var(--green-soft)", interviewing: "var(--blue-soft)", offer: "var(--purple-soft)", rejected: "var(--red-soft)" };
const BARSTRONG: Record<string, string> = { saved: "color-mix(in srgb, var(--purple) 45%, var(--panel))", preparing: "color-mix(in srgb, var(--amber) 55%, var(--panel))", applied: "color-mix(in srgb, var(--green) 50%, var(--panel))", interviewing: "color-mix(in srgb, var(--blue) 45%, var(--panel))", offer: "color-mix(in srgb, var(--purple) 45%, var(--panel))", rejected: "color-mix(in srgb, var(--red) 55%, var(--panel))" };
const PIPE: { s: Status; n: string }[] = [
  { s: "saved", n: "Saved" }, { s: "preparing", n: "Preparing" }, { s: "applied", n: "Applied" }, { s: "interviewing", n: "Interviewing" }, { s: "offer", n: "Offer" }, { s: "rejected", n: "Rejected" },
];

const ACT_ICON: Record<string, { Icon: typeof DocumentTextIcon; tone: string }> = {
  doc: { Icon: DocumentTextIcon, tone: "blue" }, calendar: { Icon: CalendarDaysIcon, tone: "purple" }, spark: { Icon: DocumentTextIcon, tone: "green" },
  note: { Icon: PencilSquareIcon, tone: "amber" }, key: { Icon: DocumentTextIcon, tone: "purple" },
};
const TONE_VAR: Record<string, string> = { blue: "var(--blue)", purple: "var(--purple)", green: "var(--green)", amber: "var(--amber)" };

const dayWord = (t: number) => {
  const today = startOfDay(Date.now());
  if (sameDay(t, today)) return "Today";
  if (sameDay(t, today + DAY)) return "Tomorrow";
  return new Date(t).toLocaleDateString(undefined, { weekday: "short" });
};
const level = (r: string) => (/intern/i.test(r) ? "Entry-level" : /senior|staff|lead|principal/i.test(r) ? "Senior" : "Mid-level");
const EMP: Record<string, string> = { internship: "Internship", co_op: "Co-op", new_grad: "New grad", full_time: "Full-time", part_time: "Part-time", contract: "Contract" };
const ARR: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite", unknown: "Onsite" };
const kind = (r: string) => (/intern/i.test(r) ? "Internship" : "Full-time");

export default function Dashboard() {
  const { data, act } = useData();
  const { navigate, openJob, openModal, toast } = useUI();
  const [tab, setTab] = useState<Focus>("apps");
  const [weeks, setWeeks] = useState(4);

  const m = useMemo(() => {
    const now = Date.now();
    const jobs = data.jobs;
    const apps = jobs.filter(isApp);
    const inWin = (t: number, a: number, b: number) => t >= now - b * DAY && t < now - a * DAY;
    const appsCur = apps.filter((j) => inWin(appliedAt(j), 0, 30));
    const appsPrev = apps.filter((j) => inWin(appliedAt(j), 30, 60));
    const activeJobs = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));
    const addCur = activeJobs.filter((j) => inWin(j.addedAt, 0, 30)).length;
    const addPrev = activeJobs.filter((j) => inWin(j.addedAt, 30, 60)).length;
    const ivAll = data.events.filter((e) => e.kind === "interview");
    const ivUp = ivAll.filter((e) => e.end >= now).sort((a, b) => a.start - b.start);
    const eod = startOfDay(now) + DAY;
    const openTasks = data.tasks.filter((t) => !t.done && t.dueAt < eod);
    const overdue = data.tasks.filter((t) => !t.done && t.dueAt < startOfDay(now)).length;
    const followEv = data.events.filter((e) => e.kind === "followup" && e.start >= startOfDay(now) && e.start < startOfDay(now) + 7 * DAY).length;
    const rrNow = responseRate(apps);
    const rrCur = responseRate(appsCur);
    const rrPrev = responseRate(appsPrev);
    const stale = jobs.filter((j) => (j.status === "applied" || j.status === "interviewing") && daysSince(lastTouch(data, j)) >= 7).sort((a, b) => lastTouch(data, a) - lastTouch(data, b));
    return { apps, appsCur, appsPrev, addCur, addPrev, activeJobs, ivAll, ivUp, openTasks, overdue, followEv, rrNow, rrCur, rrPrev, stale };
  }, [data]);

  const todayTasks = useMemo(() => {
    const t0 = startOfDay(Date.now());
    return data.tasks.filter((t) => sameDay(t.dueAt, t0) || (!t.done && t.dueAt < t0)).sort((a, b) => Number(a.done) - Number(b.done) || a.dueAt - b.dueAt);
  }, [data.tasks]);

  const series = useMemo(() => weekSeries(data, weeks, fmtShort), [data, weeks]);
  const sum = useMemo(() => {
    const prior = weekSeries(data, weeks * 2, fmtShort).slice(0, weeks);
    const a = series.reduce((s, p) => s + p.apps, 0), pa = prior.reduce((s, p) => s + p.apps, 0);
    const i = series.reduce((s, p) => s + p.interviews, 0), pi = prior.reduce((s, p) => s + p.interviews, 0);
    const r = series[series.length - 1]?.rate ?? null, pr = prior[prior.length - 1]?.rate ?? null;
    return { a, i, r, da: delta(a, pa), di: delta(i, pi), dr: pointDelta(r, pr) };
  }, [data, series, weeks]);

  const counts = useMemo(() => Object.fromEntries(PIPE.map((p) => [p.s, data.jobs.filter((j) => j.status === p.s).length])) as Record<Status, number>, [data.jobs]);
  const maxCount = Math.max(1, ...Object.values(counts));
  const openGate = useMemo(() => data.gate.filter(isOpen), [data.gate]);
  const matches = useMemo(() => [...openGate].sort((a, b) => b.envelope.match.score - a.envelope.match.score).slice(0, 4), [openGate]);
  const jobById = (id?: string) => data.jobs.find((j) => j.id === id);

  const followUp = (j: Job) => {
    const c = data.contacts.find((x) => x.jobId === j.id) ?? data.contacts.find((x) => x.company === j.company);
    act.addTask({ title: `Follow up with ${j.company}`, company: j.company, subtitle: `${j.company} · ${j.role}`, dueAt: Date.now(), priority: "High", icon: "mail", jobId: j.id });
    if (c?.email) navigator.clipboard?.writeText(c.email).catch(() => undefined);
    toast(c ? `Follow-up task added. ${c.name}'s email${c.email ? " copied" : ""}.` : `Follow-up task added for ${j.company}`);
  };
  const hasFollowTask = (j: Job) => data.tasks.some((t) => t.jobId === j.id && !t.done && /follow/i.test(t.title));
  const uploadResume = async () => {
    const files = await pickFiles(".pdf,.doc,.docx,.txt,.rtf,.pages", true);
    if (!files.length) return;
    await act.addFiles(files, { folder: "Resumes" });
    toast(`Uploaded ${files.length} resume${files.length > 1 ? "s" : ""}`);
  };

  const rrDelta = m.rrCur !== null && m.rrPrev !== null ? m.rrCur - m.rrPrev : null;
  const rollin = rrDelta !== null ? rrDelta > 0 : (m.rrNow ?? 0) >= 50;

  const kpis = [
    { tone: "blue", icon: <DocumentTextIcon />, label: "Total Applications", value: m.apps.length, d: delta(m.appsCur.length, m.appsPrev.length), sub: "vs. last month" },
    { tone: "purple", icon: <CalendarDaysIcon />, label: "Interviews", value: m.ivAll.length, d: { text: `${m.ivUp.length} upcoming`, dir: m.ivUp.length ? "up" : "flat" } as Delta, sub: "scheduled" },
    { tone: "amber", icon: <ClockIcon />, label: "Follow-ups Due", value: m.openTasks.length + m.followEv, d: { text: m.overdue ? `${m.overdue} overdue` : "—", dir: m.overdue ? "down" : "flat" } as Delta, sub: "this week" },
    { tone: "blue", icon: <BriefcaseIcon />, label: "Active Opportunities", value: m.activeJobs.length, d: delta(m.addCur, m.addPrev), sub: "in pipeline" },
    { tone: "green", icon: <ChartBarIcon />, label: "Response Rate", value: pct(m.rrNow), d: pointDelta(m.rrCur, m.rrPrev), sub: "vs. last month" },
    { tone: "purple", icon: <TrophyIcon />, label: "Offers", value: counts.offer, d: { text: "—", dir: "flat" } as Delta, sub: "this cycle" },
  ];

  return (
    <div className="page dash">
      <PageHead title="Dashboard" subtitle="Stay on top of your job search at a glance." />
      <div className="dash-kpis">{kpis.map((k) => <Kpi key={k.label} {...k} />)}</div>

      <div className="dash-grid">
        <Card title="Today's Priorities" count={todayTasks.filter((t) => !t.done).length} className="c-pri" action={<button className="link" onClick={() => navigate("calendar")}>View All</button>}>
          {todayTasks.length ? <ul className="dash-list">{todayTasks.slice(0, 5).map((t) => <TaskRow key={t.id} t={t} onToggle={() => act.toggleTask(t.id)} openCount={openGate.length} />)}</ul> : <p className="dash-empty">Nothing due today. Enjoy the breathing room.</p>}
        </Card>

        <Card title="Upcoming Interviews" className="c-int" action={<button className="link" onClick={() => navigate("calendar")}>View Calendar</button>}>
          {m.ivUp.length ? (
            <ul className="dash-list">
              {m.ivUp.slice(0, 3).map((e) => (
                <li key={e.id}>
                  <button className="dash-iv" onClick={() => navigate("calendar", { event: e.id })}>
                    <Logo name={e.company ?? e.title} size={44} />
                    <span className="dash-grow">
                      <b>{e.title}</b>
                      <small>{e.company ?? "Interview"}</small>
                      <span className="dash-when"><span><CalendarIcon />{dayWord(e.start)}, {fmtShort(e.start)}</span><span><ClockIcon />{fmtRange(e.start, e.end)}</span></span>
                    </span>
                    {e.format !== "None" && <i className={`dash-chip ${e.format === "In Person" ? "purple" : e.format === "Phone" ? "green" : "blue"}`}>{e.format}</i>}
                    <ChevronRightIcon className="dash-chev" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="dash-empty">No interviews scheduled yet.</p>}
          <button className="dash-foot-link" onClick={() => navigate("calendar")}><CalendarDaysIcon /><span>View all interviews</span><ChevronRightIcon /></button>
        </Card>

        <Card title="Application Pipeline" className="c-pipe" action={<button className="link" onClick={() => navigate("kanban")}>View All</button>}>
          <ul className="dash-pipe">
            {PIPE.map((p) => (
              <li key={p.s}>
                <button onClick={() => navigate("kanban")} aria-label={`${p.n}: ${counts[p.s]}. Open board`}>
                  <i className="dash-dot-s" style={{ background: DOT[p.s] }} />
                  <span>{p.n}</span>
                  <span className="dash-track"><i style={{ width: `${counts[p.s] ? Math.max(5, (counts[p.s] / maxCount) * 100) : 0}%`, background: BARSTRONG[p.s] }} /></span>
                  <b>{counts[p.s]}</b>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Application Activity" className="c-act" action={
          <label className="dash-select"><select value={weeks} onChange={(e) => setWeeks(+e.target.value)} aria-label="Time range">{[4, 8, 12].map((w) => <option key={w} value={w}>Last {w} weeks</option>)}</select><ChevronDownIcon /></label>
        }>
          <div className="dash-act">
            <div className="dash-act-main">
              <div className="dash-tabs" role="tablist">
                {([["apps", "Applications"], ["interviews", "Interviews"], ["rate", "Response Rate"]] as [Focus, string][]).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
                ))}
              </div>
              <ComboChart points={series} focus={tab} />
              <div className="dash-legend"><span><i className="dash-sw-a" />Applications</span><span><i className="dash-sw-i" />Interviews</span><span><i className="dash-sw-r line" />Response Rate</span></div>
            </div>
            <div className="dash-sums">
              <div><b>{sum.a}</b><span>Applications</span><em className={sum.da.dir}>{sum.da.text}</em></div>
              <div><b>{sum.i}</b><span>Interviews</span><em className={sum.di.dir}>{sum.di.text}</em></div>
              <div><b>{pct(sum.r)}</b><span>Response Rate</span><em className={sum.dr.dir}>{sum.dr.text}</em></div>
            </div>
          </div>
        </Card>

        <Card title="New Job Matches" count={openGate.length} className="c-match" action={<button className="link" onClick={() => navigate("gate")}>View All</button>}>
          {matches.length ? (
            <ul className="dash-list">
              {matches.map((g) => {
                const e = g.envelope, score = Math.round(e.match.score);
                return (
                  <li key={g.id} className="dash-match">
                    <button className="dash-match-main" onClick={() => navigate("gate", { item: g.id })}>
                      <Logo name={e.company.name} size={40} />
                      <span className="dash-grow">
                        <b>{e.opportunity.title}</b>
                        <small>{e.company.name} · {locationText(e)}</small>
                        <span className="dash-tags"><i>{ARR[e.opportunity.work_arrangement]}</i><i>{EMP[e.opportunity.employment_type] ?? "Internship"}</i><i>{TRACK_LABEL(e.opportunity.track)}</i></span>
                      </span>
                    </button>
                    <div className="dash-score"><b>{score}% match</b><span className="progress green"><i style={{ width: `${score}%` }} /></span></div>
                    <button className="btn sm" onClick={() => { act.approveGate(g.id); toast(`Approved ${e.company.name} to your pipeline`); }}>Approve</button>
                    <button className="icon-btn ghost dash-chev-btn" onClick={() => navigate("gate", { item: g.id })} aria-label={`Open ${e.opportunity.title} at ${e.company.name}`}><ChevronRightIcon /></button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="dash-empty">No new matches waiting. Your agent will add more soon.</p>}
        </Card>

        <Card title="Recent Activity" className="c-recent" action={<button className="link" onClick={() => navigate("notifications")}>View All</button>}>
          {data.activity.length ? (
            <ul className="dash-timeline">
              {data.activity.slice(0, 5).map((a) => {
                const { Icon, tone } = ACT_ICON[a.icon] ?? { Icon: SparklesIcon, tone: "blue" };
                return (
                  <li key={a.id}>
                    <i className="dash-tl-dot" style={{ background: TONE_VAR[tone] }} />
                    <span className={`dash-tile sm ${tone}`}><Icon /></span>
                    <div className="dash-grow"><span className="dash-tl-row"><b>{a.title}</b><time>{fmtAgo(a.at)}</time></span><small>{a.subtitle}</small></div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="dash-empty">Activity will show up here as you work.</p>}
        </Card>

        <Card title="Stale Applications" count={m.stale.length} className="c-stale" action={<button className="link" onClick={() => navigate("kanban")}>View All</button>}>
          {m.stale.length ? (
            <ul className="dash-list tight">
              {m.stale.slice(0, 4).map((j) => {
                const queued = hasFollowTask(j);
                return (
                  <li key={j.id} className="dash-stale">
                    <button className="dash-stale-main" onClick={() => openJob(j.id)}>
                      <Logo name={j.company} size={32} />
                      <span className="dash-grow"><b>{j.role}</b><small>{j.company}</small></span>
                      <time>{daysSince(lastTouch(data, j))} days ago</time>
                    </button>
                    <button className="dash-follow" disabled={queued} onClick={() => followUp(j)}>{queued ? "Task added" : "Follow Up"}</button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="dash-empty">Nothing is going stale. Nice work staying on top of it.</p>}
        </Card>

        <Card title="Quick Actions" className="c-quick" action={null}>
          <div className="dash-quick">
            {[
              { l: "Add Job", s: "Track a new opportunity", Icon: PlusIcon, tone: "blue", f: () => openModal({ kind: "job" }) },
              { l: "Add Event", s: "Schedule an interview or task", Icon: CalendarDaysIcon, tone: "purple", f: () => openModal({ kind: "event" }) },
              { l: "Add Company", s: "Keep track of companies", Icon: BuildingOffice2Icon, tone: "gray", f: () => openModal({ kind: "company" }) },
              { l: "Upload Resume", s: "Update your resume or documents", Icon: ArrowUpTrayIcon, tone: "green", f: uploadResume },
            ].map(({ l, s, Icon, tone, f }) => (
              <button key={l} onClick={f}><span className={`dash-qicon ${tone}`}><Icon /></span><b>{l}</b><small>{s}</small></button>
            ))}
          </div>
        </Card>

        <section className="card dash-card dash-tips c-tips">
          <button className="dash-tips-head" onClick={() => navigate("insights")}><LightBulbIcon /><b>Insights &amp; Tips</b><ChevronRightIcon /></button>
          <div className="dash-callout">
            <b>{rollin ? "You're on a roll! 🎉" : "Keep the momentum going"}</b>
            <p>
              {rrDelta !== null && rrDelta > 0 ? `Your response rate is ${rrDelta}% higher than last month.` : rrDelta !== null && rrDelta < 0 ? `Your response rate is ${Math.abs(rrDelta)}% lower than last month.` : m.rrNow !== null ? `Your response rate is ${m.rrNow}%.` : "Apply to a few roles to start measuring your response rate."}
              {" "}{m.stale.length ? `Consider following up on ${m.stale.length} stale application${m.stale.length > 1 ? "s" : ""} to keep momentum going.` : "Keep your pipeline moving by reviewing new matches."}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
