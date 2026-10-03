import { useMemo, useState } from "react";
import { PageHead } from "../components/ui";
import { Logo } from "../components/Logo";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { daysSince, fmtShort } from "../lib/format";
import type { Status } from "../lib/types";
import { ComboChart, LineChart } from "./dashboard/Chart";
import { isApp, lastTouch, RESPONDED, responseRate, weekSeries } from "./dashboard/metrics";
import "./dashboard.css";
import "./insights.css";

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Bars({ rows, color = "var(--blue)", unit = "" }: { rows: { key: string; label: React.ReactNode; value: number; max: number; note?: string }[]; color?: string; unit?: string }) {
  return (
    <ul className="ins-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="ins-bar-label">{r.label}</span>
          <span className="ins-bar-track"><i style={{ width: `${Math.max(2, (r.value / Math.max(r.max, 1)) * 100)}%`, background: color }} /></span>
          <b>{r.note ?? `${r.value}${unit}`}</b>
        </li>
      ))}
    </ul>
  );
}

export default function Insights() {
  const { data } = useData();
  const gateStats = useMemo(() => {
    const approved = data.gate.filter((g) => g.gateStatus === "approved").length, dismissed = data.gate.filter((g) => g.gateStatus === "dismissed").length;
    return { total: data.gate.length, approved, dismissed, rate: approved + dismissed ? Math.round((approved / (approved + dismissed)) * 100) : null };
  }, [data.gate]);
  const funnel = useMemo(() => {
    const linked = data.jobs.filter((j) => j.gate);
    const n = (...st: string[]) => linked.filter((j) => st.includes(j.status)).length;
    return [
      { label: "Discovered", n: data.gate.length },
      { label: "Approved", n: data.gate.filter((g) => g.gateStatus === "approved" || g.linkedJobId).length },
      { label: "Applied", n: n("applied", "interviewing", "offer", "rejected") },
      { label: "Interviewing", n: n("interviewing", "offer") },
      { label: "Offer", n: n("offer") },
    ];
  }, [data.gate, data.jobs]);
  const { openJob } = useUI();
  const [weeks, setWeeks] = useState(8);

  const m = useMemo(() => {
    const jobs = data.jobs.filter((j) => j.status !== "dismissed");
    const apps = jobs.filter(isApp);
    const reached = (s: Status[]) => jobs.filter((j) => s.includes(j.status)).length;
    const funnel = [
      { name: "Saved", n: reached(["saved", "preparing", "applied", "interviewing", "offer", "rejected"]) },
      { name: "Applied", n: reached(["applied", "interviewing", "offer", "rejected"]) },
      { name: "Interviewing", n: reached(["interviewing", "offer"]) },
      { name: "Offer", n: reached(["offer"]) },
    ];
    const scored = jobs.filter((j) => j.score);
    const byCompany = [...jobs].sort((a, b) => b.score - a.score).slice(0, 6);
    const tracks = [...new Set(jobs.map((j) => j.track))].map((t) => ({ t, n: jobs.filter((j) => j.track === t).length, s: Math.round(avg(jobs.filter((j) => j.track === t).map((j) => j.score))) })).sort((a, b) => b.s - a.s);
    const stages: Status[] = ["saved", "preparing", "applied", "interviewing", "offer"];
    const stageTime = stages.map((s) => {
      const js = jobs.filter((j) => j.status === s);
      return { s, n: js.length, d: Math.round(avg(js.map((j) => daysSince(lastTouch(data, j))))) };
    });
    const agent = jobs.filter((j) => j.source === "agent"), manual = jobs.filter((j) => j.source === "manual");
    const resumes = data.documents.filter((d) => !d.trashed && (d.folder === "Resumes" || /resume|cv/i.test(d.name))).map((d) => {
      const linked = data.jobs.filter((j) => d.jobIds.includes(j.id) && isApp(j));
      const win = linked.filter((j) => j.status === "interviewing" || j.status === "offer").length;
      return { d, linked: linked.length, win };
    }).sort((a, b) => b.win - a.win || b.linked - a.linked);
    return { jobs, apps, funnel, avgScore: Math.round(avg(scored.map((j) => j.score))), byCompany, tracks, stageTime, agent, manual, resumes };
  }, [data]);

  const series = useMemo(() => weekSeries(data, weeks, fmtShort), [data, weeks]);
  const rr = responseRate(m.apps);
  const interviewRate = pctOf(m.apps.filter((j) => j.status === "interviewing" || j.status === "offer").length, m.apps.length);
  const offerRate = pctOf(m.funnel[3].n, m.apps.length);
  const maxStage = Math.max(1, ...m.stageTime.map((s) => s.d));
  const best = m.resumes.find((r) => r.linked > 0);

  const kpi = (label: string, value: string, sub: string) => (
    <div className="card ins-kpi"><span>{label}</span><b>{value}</b><small>{sub}</small></div>
  );

  return (
    <div className="page ins">
      <PageHead title="Insights" subtitle="See what is working in your job search, computed from your own pipeline." />
      {m.jobs.length === 0 ? (
        <div className="card ins-card"><p className="dash-empty">Add a few jobs to start seeing insights.</p></div>
      ) : (
        <>
          <div className="ins-kpis">
            {kpi("Avg. match score", `${m.avgScore}%`, `across ${m.jobs.length} tracked jobs`)}
            {kpi("Applications", String(m.apps.length), `${m.funnel[0].n ? pctOf(m.apps.length, m.funnel[0].n) : 0}% of saved roles`)}
            {kpi("Response rate", rr === null ? "—" : `${rr}%`, "interview, offer or rejection")}
            {kpi("Interview rate", `${interviewRate}%`, "of applications")}
            {kpi("Offer rate", `${offerRate}%`, "of applications")}
          </div>

          <div className="ins-grid">
            <section className="card ins-card">
              <h2>Pipeline funnel</h2>
              <p className="ins-sub">How roles progress from saved to offer</p>
              <ul className="ins-funnel">
                {m.funnel.map((f, i) => (
                  <li key={f.name}>
                    <div className="ins-funnel-bar" style={{ width: `${Math.max(14, pctOf(f.n, m.funnel[0].n))}%`, opacity: 1 - i * 0.18 }}><span>{f.name}</span><b>{f.n}</b></div>
                    <em>{i === 0 ? "" : `${pctOf(f.n, m.funnel[i - 1].n)}% from ${m.funnel[i - 1].name.toLowerCase()}`}</em>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card ins-card">
              <div className="ins-head"><div><h2>Applications over time</h2><p className="ins-sub">Applications per week</p></div>
                <select value={weeks} onChange={(e) => setWeeks(+e.target.value)} aria-label="Weeks to show">{[4, 8, 12].map((w) => <option key={w} value={w}>Last {w} weeks</option>)}</select></div>
              <ComboChart points={series} showInterviews={false} showRate={false} />
              <div className="dash-legend"><span><i className="dash-sw-a" />Applications</span></div>
            </section>

            <section className="card ins-card">
              <h2>Response rate trend</h2>
              <p className="ins-sub">Cumulative share of applications that got a response</p>
              <LineChart points={series.map((p) => ({ label: p.label, v: p.rate }))} />
            </section>

            <section className="card ins-card">
              <h2>Top matches</h2>
              <p className="ins-sub">Highest match scores across your pipeline</p>
              <ul className="ins-top">
                {m.byCompany.map((j) => (
                  <li key={j.id}><button onClick={() => openJob(j.id)}><Logo name={j.company} size={32} /><span className="dash-grow"><b>{j.company}</b><small>{j.role}</small></span><span className="progress green ins-mini"><i style={{ width: `${j.score}%` }} /></span><strong>{j.score}%</strong></button></li>
                ))}
              </ul>
              <h3>Tracks by average score</h3>
              <Bars color="var(--purple)" unit="%" rows={m.tracks.map((t) => ({ key: t.t, label: `${t.t} (${t.n})`, value: t.s, max: 100 }))} />
            </section>

            <section className="card ins-card">
              <h2>Time in stage</h2>
              <p className="ins-sub">Average days since the last movement</p>
              <Bars color="var(--amber)" rows={m.stageTime.map((s) => ({ key: s.s, label: <span className="ins-cap">{s.s}</span>, value: s.d, max: maxStage, note: s.n ? `${s.d}d` : "—" }))} />
            </section>

            <section className="card ins-card">
              <h2>Source split</h2>
              <p className="ins-sub">Jobs found by your agent vs. added manually</p>
              <div className="ins-split" role="img" aria-label={`${m.agent.length} agent, ${m.manual.length} manual`}>
                <i style={{ flex: m.agent.length || 0.0001, background: "var(--purple)" }} />
                <i style={{ flex: m.manual.length || 0.0001, background: "var(--blue)" }} />
              </div>
              <div className="ins-split-key">
                <span><i style={{ background: "var(--purple)" }} />Agent <b>{m.agent.length}</b> · {pctOf(m.agent.length, m.jobs.length)}%</span>
                <span><i style={{ background: "var(--blue)" }} />Manual <b>{m.manual.length}</b> · {pctOf(m.manual.length, m.jobs.length)}%</span>
              </div>
              <p className="ins-note">GATE: {gateStats.total} discovered · {gateStats.approved} approved · {gateStats.dismissed} dismissed · approval rate {gateStats.rate === null ? "—" : `${gateStats.rate}%`}.</p>
              <p className="ins-note">Avg. match: agent {Math.round(avg(m.agent.map((j) => j.score)))}% · manual {Math.round(avg(m.manual.map((j) => j.score)))}%. Applied from agent finds: {m.agent.filter(isApp).length}, from manual: {m.manual.filter(isApp).length}. Responses: {m.agent.filter((j) => RESPONDED.includes(j.status)).length} vs {m.manual.filter((j) => RESPONDED.includes(j.status)).length}.</p>
            </section>

            <section className="card ins-card">
              <h2>GATE funnel</h2>
              <p className="ins-sub">From discovery to offer</p>
              <ul className="ins-resumes">
                {funnel.map((f) => (
                  <li key={f.label}>
                    <span className="dash-grow"><b>{f.label}</b></span>
                    <span className="ins-bar-track"><i style={{ width: `${pctOf(f.n, Math.max(1, funnel[0].n))}%`, background: "var(--purple)" }} /></span>
                    <strong>{f.n}</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card ins-card ins-wide">
              <h2>Best-performing resume</h2>
              <p className="ins-sub">Resumes linked to applications that reached an interview or offer</p>
              {m.resumes.length === 0 ? <p className="dash-empty">Upload a resume in Documents and link it to jobs to compare results.</p> : (
                <ul className="ins-resumes">
                  {m.resumes.slice(0, 5).map((r) => (
                    <li key={r.d.id} className={best?.d.id === r.d.id ? "best" : ""}>
                      <span className="dash-grow"><b>{r.d.name}{best?.d.id === r.d.id && <em className="ins-badge">Best</em>}</b><small>{r.linked} linked application{r.linked === 1 ? "" : "s"}</small></span>
                      <span className="ins-bar-track"><i style={{ width: `${pctOf(r.win, r.linked)}%`, background: "var(--green)" }} /></span>
                      <strong>{r.linked ? `${pctOf(r.win, r.linked)}%` : "—"}</strong>
                      <small>{r.win} advanced</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
