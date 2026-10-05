import { useState } from "react";
import { ArrowTopRightOnSquareIcon, DocumentTextIcon, KeyIcon, PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { useSecrets } from "../lib/secrets";
import { pickFiles } from "../lib/files";
import { openExternal } from "../lib/tauri";
import { fmtDate, fmtShort, fmtTime } from "../lib/format";
import { PIPELINE, type Job, type Status } from "../lib/types";
import { Logo } from "./Logo";
import { StatusPill } from "./ui";
import { GateAssessment } from "./GateAssessment";
import { deriveFlags } from "@job-hunt-os/contracts";

const TABS = ["Overview", "Notes", "Documents", "Portal", "Contacts", "Timeline"] as const;

export function JobInspector() {
  const { jobId, openJob } = useUI();
  const { data } = useData();
  const job = data.jobs.find((j) => j.id === jobId);
  return (
    <>
      <div className={`veil ${job ? "show" : ""}`} onClick={() => openJob(undefined)} />
      <aside className={`inspector ${job ? "open" : ""}`} aria-hidden={!job}>{job && <Body key={job.id} job={job} />}</aside>
    </>
  );
}

function Body({ job }: { job: Job }) {
  const { act } = useData();
  const { openJob, toast } = useUI();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  return (
    <>
      <header>
        <button className="icon-btn" onClick={() => openJob(undefined)} aria-label="Close"><XMarkIcon /></button>
        <div>
          {job.url && <button className="btn" onClick={() => openExternal(job.url)}><ArrowTopRightOnSquareIcon />Open Link</button>}
          <button className="btn danger-ghost" onClick={() => { act.removeJob(job.id); openJob(undefined); toast("Job removed"); }}><TrashIcon />Delete</button>
        </div>
      </header>
      <div className="inspector-scroll">
        <div className="insp-title">
          <Logo name={job.company} size={56} />
          <div>
            <small>{job.source === "agent" ? "AGENT DISCOVERY" : "TRACKED OPPORTUNITY"}</small>
            <h2>{job.company}</h2>
            <h3>{job.role}</h3>
            <StatusPill status={job.status} />
          </div>
        </div>
        <div className="insp-meta"><span>{job.location || "—"}</span><span>{job.workMode || "—"}</span><span>{job.pay || "—"}</span><span>Added {(() => { try { return fmtShort(job.addedAt); } catch { return "—"; } })()}</span></div>
        <div className="tabs">{TABS.map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}</div>
        {tab === "Overview" && <Overview job={job} />}
        {tab === "Notes" && <Notes job={job} />}
        {tab === "Documents" && <Docs job={job} />}
        {tab === "Portal" && <Portal job={job} />}
        {tab === "Contacts" && <Contacts job={job} />}
        {tab === "Timeline" && <Timeline job={job} />}
      </div>
    </>
  );
}

const Row = ({ l, v }: { l: string; v: string }) => <div className="kv"><span>{l}</span><b>{v}</b></div>;

function Overview({ job }: { job: Job }) {
  const { act } = useData();
  const { openJob } = useUI();
  return (
    <div className="insp-section">
      <section><h4>About the role</h4><p>{job.about || "No description yet."}</p></section>
      <section>
        <h4>Stage</h4>
        <select value={job.status} onChange={(e) => act.moveJob(job.id, e.target.value as Status)}>
          {job.status === "pending_review" && <option value="pending_review">New (needs review)</option>}
          {PIPELINE.map((p) => <option key={p.status} value={p.status}>{p.name}</option>)}
          <option value="rejected">Rejected</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </section>
      <section>
        <h4>Eligibility &amp; sponsorship</h4>
        <Row l="F-1 student" v={job.eligibility.f1} /><Row l="CPT possible" v={job.eligibility.cpt} />
        <Row l="US citizen required" v={job.eligibility.citizen ? "Yes" : "No"} /><Row l="US person required" v={job.eligibility.usPerson ? "Yes" : "No"} />
        <Row l="Sponsorship" v={job.eligibility.sponsorship} />
      </section>
      {job.gate ? (
        <>
          <h4 className="gate-heading">GATE assessment <small>discovered by {(job.gate.envelope as unknown as { agent?: { name?: unknown } })?.agent?.name ? String((job.gate.envelope as unknown as { agent: { name: string } }).agent.name) : "GATE Scout"}</small></h4>
          <GateAssessment compact env={job.gate.envelope} flags={(() => { try { const ts = Date.parse((job.gate!.envelope as unknown as { metadata?: { discovered_at?: unknown } })?.metadata?.discovered_at as string); return deriveFlags(job.gate!.envelope, Number.isNaN(ts) ? Date.now() : ts); } catch { return []; } })()} />
        </>
      ) : (
        <section><h4>Match</h4><div className="score"><b>{typeof job.score === "number" && Number.isFinite(job.score) ? Math.round(job.score) : 0}%</b><span>Strong technical and graduation alignment</span></div></section>
      )}
      <div className="insp-actions">
        {job.status === "pending_review" && <button className="btn primary" onClick={() => act.moveJob(job.id, "saved")}>Approve to pipeline</button>}
        {job.url && <button className="btn" onClick={() => openExternal(job.url)}>Open official application<ArrowTopRightOnSquareIcon /></button>}
        {job.status !== "dismissed" && <button className="btn" onClick={() => { act.moveJob(job.id, "dismissed"); openJob(undefined); }}>Dismiss</button>}
      </div>
      <small className="muted">Opening an application never submits it. Submission remains your explicit decision.</small>
    </div>
  );
}

function Notes({ job }: { job: Job }) {
  const { act } = useData();
  const { toast } = useUI();
  const [notes, setNotes] = useState(job.notes);
  const [url, setUrl] = useState(job.url);
  return (
    <div className="insp-section form-stack">
      <label className="field"><span>Notes</span><textarea rows={7} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter context, referrals, questions…" /></label>
      <label className="field"><span>Application / source URL</span><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
      <button className="btn primary" onClick={() => { act.updateJob(job.id, { notes, url }); toast("Saved"); }}>Save notes</button>
    </div>
  );
}

function Docs({ job }: { job: Job }) {
  const { data, act } = useData();
  const { navigate, toast } = useUI();
  const linked = data.documents.filter((d) => !d.trashed && d.jobIds.includes(job.id));
  const others = data.documents.filter((d) => !d.trashed && !d.jobIds.includes(job.id));
  const link = (id: string, on: boolean) => { const d = data.documents.find((x) => x.id === id)!; act.updateDocument(id, { jobIds: on ? [...d.jobIds, job.id] : d.jobIds.filter((j) => j !== job.id) }); };
  const upload = async () => { const files = await pickFiles(); if (files.length) { await act.addFiles(files, { company: job.company, jobIds: [job.id] }); toast("Uploaded and linked"); } };
  return (
    <div className="insp-section">
      <p className="muted">Attach the exact resume, cover letter or portfolio used for this application.</p>
      <div className="insp-actions"><button className="btn" onClick={upload}><PlusIcon />Upload document</button>
        {others.length > 0 && <select value="" onChange={(e) => e.target.value && link(e.target.value, true)}><option value="">Link existing document…</option>{others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      </div>
      {linked.length === 0 ? <div className="empty-tab">No documents attached yet.</div> : linked.map((d) => (
        <div className="linked-row" key={d.id}>
          <DocumentTextIcon /><button className="link" onClick={() => navigate("documents", { doc: d.id })}>{d.name}.{d.ext.toLowerCase()}</button>
          <button className="icon-btn ghost" onClick={() => link(d.id, false)} aria-label="Unlink"><XMarkIcon /></button>
        </div>
      ))}
    </div>
  );
}

function Portal({ job }: { job: Job }) {
  const { data, act } = useData();
  const { navigate, openModal } = useUI();
  const secrets = useSecrets();
  const linked = data.credentials.filter((c) => c.jobIds.includes(job.id));
  const others = data.credentials.filter((c) => !c.jobIds.includes(job.id));
  const setLink = (id: string, on: boolean) => { const c = data.credentials.find((x) => x.id === id)!; act.updateCredential(id, { jobIds: on ? [...c.jobIds, job.id] : c.jobIds.filter((j) => j !== job.id) }); };
  return (
    <div className="insp-section">
      <p className="muted">Portal accounts you used to apply for this role. Passwords stay encrypted in your vault.</p>
      <div className="insp-actions">
        <button className="btn primary" onClick={() => openModal({ kind: "credential", preset: { portal: `${job.company} Careers`, company: job.company, domain: (typeof job.url === "string" ? job.url : "").replace(/^https?:\/\//, "").split("/")[0] ?? "", jobIds: [job.id] } })}><KeyIcon />Store credential</button>
        {others.length > 0 && <select value="" onChange={(e) => e.target.value && setLink(e.target.value, true)}><option value="">Link existing portal…</option>{others.map((c) => <option key={c.id} value={c.id}>{c.portal}</option>)}</select>}
      </div>
      {linked.length === 0 ? <div className="empty-tab">No portal credentials linked to this application.</div> : linked.map((c) => (
        <div className="portal-card" key={c.id}>
          <Logo name={c.portal} size={34} />
          <div><b>{c.portal}</b><small>{c.username}</small></div>
          <div className="portal-actions">
            <button className="btn sm" onClick={() => secrets.copyUsername(c)}>Copy user</button>
            <button className="btn sm" onClick={() => secrets.copyPassword(c)}>Copy password</button>
            <button className="btn sm" onClick={() => openExternal(c.domain)}>Open</button>
            <button className="btn sm ghost" onClick={() => navigate("vault", { cred: c.id })}>Vault</button>
            <button className="icon-btn ghost" onClick={() => setLink(c.id, false)} aria-label="Unlink"><XMarkIcon /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Contacts({ job }: { job: Job }) {
  const { data } = useData();
  const { openModal } = useUI();
  const list = data.contacts.filter((c) => c.jobId === job.id || c.company === job.company);
  return (
    <div className="insp-section">
      <div className="insp-actions"><button className="btn" onClick={() => openModal({ kind: "contact", preset: { company: job.company, jobId: job.id } })}><PlusIcon />Add contact</button></div>
      {list.length === 0 ? <div className="empty-tab">No contacts yet.</div> : list.map((c) => <div className="linked-row" key={c.id}><b>{c.name}</b><span className="muted">{c.role}{c.email ? ` · ${c.email}` : ""}</span></div>)}
    </div>
  );
}

function Timeline({ job }: { job: Job }) {
  const { data } = useData();
  const events = data.events.filter((e) => e.jobId === job.id).sort((a, b) => a.start - b.start);
  const safeDate = (n: number) => { try { return fmtDate(n); } catch { return "—"; } };
  const safeTime = (n: number) => { try { return fmtTime(n); } catch { return ""; } };
  return (
    <div className="insp-section timeline">
      <div><b>Opportunity {job.source === "agent" ? "discovered by your agent" : "added"}</b><span>{safeDate(job.addedAt)}</span></div>
      {events.map((e) => <div key={e.id}><b>{e.title}</b><span>{safeDate(e.start)} · {safeTime(e.start)}</span></div>)}
      <div><b>Current stage: {String(job.status ?? "saved").replace("_", " ")}</b><span>{job.dueLabel ?? ""}</span></div>
    </div>
  );
}
