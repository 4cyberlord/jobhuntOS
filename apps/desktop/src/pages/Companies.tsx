import { useEffect, useMemo, useState } from "react";
import { ArrowTopRightOnSquareIcon, BuildingOffice2Icon, KeyIcon, PlusIcon, UsersIcon, XMarkIcon, DocumentTextIcon, TrashIcon } from "@heroicons/react/24/outline";
import { PageHead, StatusPill } from "../components/ui";
import { Logo } from "../components/Logo";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { isOpen } from "../lib/gate";
import { openExternal } from "../lib/tauri";
import type { Company, Status } from "../lib/types";
import "./companies.css";

const STAGES: { s: Status; n: string }[] = [
  { s: "saved", n: "Saved" }, { s: "preparing", n: "Preparing" }, { s: "applied", n: "Applied" }, { s: "interviewing", n: "Interviewing" }, { s: "offer", n: "Offer" }, { s: "rejected", n: "Rejected" },
];
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

export default function Companies() {
  const { data, act } = useData();
  const { search, openModal, openJob, toast, navigate } = useUI();
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const info = useMemo(() => {
    const map = new Map<string, { jobs: typeof data.jobs; contacts: typeof data.contacts; creds: typeof data.credentials; docs: typeof data.documents }>();
    for (const c of data.companies) {
      const key = c.name.toLowerCase();
      const jobs = data.jobs.filter((j) => j.company.toLowerCase() === key && j.status !== "dismissed");
      const ids = new Set(jobs.map((j) => j.id));
      map.set(c.id, {
        jobs,
        contacts: data.contacts.filter((x) => x.company.toLowerCase() === key),
        creds: data.credentials.filter((x) => x.company?.toLowerCase() === key || x.jobIds.some((i) => ids.has(i))),
        docs: data.documents.filter((d) => !d.trashed && (d.company?.toLowerCase() === key || d.jobIds.some((i) => ids.has(i)))),
      });
    }
    return map;
  }, [data]);

  const q = search.trim().toLowerCase();
  const list = useMemo(
    () => data.companies.filter((c) => !q || [c.name, c.industry, c.hq, c.size].some((v) => v.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name)),
    [data.companies, q],
  );
  const current = data.companies.find((c) => c.id === sel) ?? null;
  const cur = current ? info.get(current.id) : undefined;
  useEffect(() => setConfirm(false), [sel]);

  return (
    <div className="page co">
      <PageHead title="Companies" subtitle="Every company you are tracking, with their roles, people and paperwork.">
        <button className="btn primary" onClick={() => openModal({ kind: "company" })}><PlusIcon />Add Company</button>
      </PageHead>
      <div className={`co-layout ${current ? "with-drawer" : ""}`}>
        <div className="co-main">
          {list.length === 0 ? (
            <div className="card co-empty"><BuildingOffice2Icon /><b>{q ? "No companies match your search" : "No companies yet"}</b><p>{q ? "Try a different name or industry." : "Add a company, or save a job and it will appear here."}</p>{!q && <button className="btn primary" onClick={() => openModal({ kind: "company" })}><PlusIcon />Add Company</button>}</div>
          ) : (
            <div className="co-grid">
              {list.map((c) => {
                const i = info.get(c.id)!;
                return (
                  <div key={c.id} role="button" tabIndex={0} className={`card co-card ${sel === c.id ? "on" : ""}`} onClick={() => setSel(c.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(c.id))}>
                    <div className="co-top">
                      <Logo name={c.name} size={44} />
                      <div className="dash-grow"><b>{c.name}</b><small>{c.industry || "Industry not set"}</small></div>
                      {i.creds.length > 0 && <span className="co-badge" title={`${i.creds.length} portal credential${i.creds.length > 1 ? "s" : ""} linked`}><KeyIcon /></span>}
                    </div>
                    <dl>
                      <div><dt>HQ</dt><dd>{c.hq || "—"}</dd></div>
                      <div><dt>Size</dt><dd>{c.size || "—"}</dd></div>
                    </dl>
                    <div className="co-chips">
                      {STAGES.map((st) => { const n = i.jobs.filter((j) => j.status === st.s).length; return n ? <span key={st.s} className={`pill st-${st.s}`}>{n} {st.n}</span> : null; })}
                      {(() => { const n = data.gate.filter((g) => isOpen(g) && g.envelope.company.name.toLowerCase() === c.name.toLowerCase()).length; return n > 0 ? <span className="pill st-pending_review">{n} discovered</span> : null; })()}
                      {i.jobs.length === 0 && <span className="muted co-none">No tracked jobs</span>}
                    </div>
                    <footer>
                      <span><UsersIcon />{i.contacts.length} contact{i.contacts.length === 1 ? "" : "s"}</span>
                      {c.website ? <button className="link" onClick={(e) => { e.stopPropagation(); void openExternal(c.website); }}>{host(c.website)}<ArrowTopRightOnSquareIcon /></button> : <span className="muted">No website</span>}
                    </footer>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {current && cur && (
          <aside className="card co-drawer" aria-label={`${current.name} details`}>
            <header>
              <Logo name={current.name} size={48} />
              <div className="dash-grow"><h2>{current.name}</h2><small>{[current.industry, current.hq].filter(Boolean).join(" · ") || "No details yet"}</small></div>
              <button className="icon-btn ghost" onClick={() => setSel(null)} aria-label="Close details"><XMarkIcon /></button>
            </header>
            <div className="co-drawer-scroll">
              <CompanyFields key={current.id} c={current} onSave={(p) => act.updateCompany(current.id, p)} onOpen={() => current.website && void openExternal(current.website)} />

              <h3>Jobs <span>{cur.jobs.length}</span></h3>
              {cur.jobs.length === 0 ? <p className="muted co-p">No jobs tracked for this company.</p> : cur.jobs.map((j) => (
                <button key={j.id} className="co-row" onClick={() => openJob(j.id)}><span className="dash-grow"><b>{j.role}</b><small>{j.location}</small></span><StatusPill status={j.status} /></button>
              ))}
              <button className="link co-add" onClick={() => openModal({ kind: "job", preset: { company: current.name } })}>+ Add job at {current.name}</button>

              <h3>Contacts <span>{cur.contacts.length}</span></h3>
              {cur.contacts.length === 0 ? <p className="muted co-p">No contacts yet.</p> : cur.contacts.map((x) => (
                <button key={x.id} className="co-row" onClick={() => navigate("contacts")}><span className="dash-grow"><b>{x.name}</b><small>{x.role || x.email}</small></span></button>
              ))}
              <button className="link co-add" onClick={() => openModal({ kind: "contact", preset: { company: current.name } })}>+ Add contact</button>

              <h3>Documents <span>{cur.docs.length}</span></h3>
              {cur.docs.length === 0 ? <p className="muted co-p">No documents linked.</p> : cur.docs.map((d) => (
                <button key={d.id} className="co-row" onClick={() => navigate("documents")}><DocumentTextIcon className="co-ico" /><span className="dash-grow"><b>{d.name}</b><small>{d.folder}</small></span></button>
              ))}

              <h3>Portal credentials <span>{cur.creds.length}</span></h3>
              {cur.creds.length === 0 ? <p className="muted co-p">No portal accounts linked.</p> : cur.creds.map((x) => (
                <button key={x.id} className="co-row" onClick={() => navigate("vault")}><KeyIcon className="co-ico" /><span className="dash-grow"><b>{x.portal}</b><small>{x.username || x.domain}</small></span></button>
              ))}

              <div className="co-danger">
                {confirm ? (
                  <><span>Delete {current.name}? Jobs and contacts stay.</span><button className="btn sm danger" onClick={() => { act.removeCompany(current.id); setSel(null); toast(`Deleted ${current.name}`); }}>Delete</button><button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button></>
                ) : <button className="btn danger-ghost sm" onClick={() => setConfirm(true)}><TrashIcon />Delete company</button>}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function CompanyFields({ c, onSave, onOpen }: { c: Company; onSave: (p: Partial<Company>) => void; onOpen: () => void }) {
  const [f, setF] = useState({ website: c.website, industry: c.industry, size: c.size, hq: c.hq, notes: c.notes });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const commit = (k: keyof typeof f) => f[k] !== c[k] && onSave({ [k]: f[k] });
  return (
    <div className="co-fields">
      <label className="field"><span>Website</span><div className="co-web"><input value={f.website} onChange={(e) => set("website", e.target.value)} onBlur={() => commit("website")} placeholder="https://" /><button className="icon-btn" onClick={onOpen} disabled={!c.website} aria-label="Open website"><ArrowTopRightOnSquareIcon /></button></div></label>
      <div className="form-grid">
        <label className="field"><span>Industry</span><input value={f.industry} onChange={(e) => set("industry", e.target.value)} onBlur={() => commit("industry")} /></label>
        <label className="field"><span>Size</span><input value={f.size} onChange={(e) => set("size", e.target.value)} onBlur={() => commit("size")} /></label>
      </div>
      <label className="field"><span>Headquarters</span><input value={f.hq} onChange={(e) => set("hq", e.target.value)} onBlur={() => commit("hq")} /></label>
      <label className="field"><span>Notes</span><textarea rows={4} value={f.notes} onChange={(e) => set("notes", e.target.value)} onBlur={() => commit("notes")} placeholder="Culture, interview tips, people to know…" /></label>
    </div>
  );
}
