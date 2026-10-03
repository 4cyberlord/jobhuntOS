import { useEffect, useMemo, useState } from "react";
import { ClipboardDocumentIcon, PlusIcon, TrashIcon, UserCircleIcon, XMarkIcon, CheckIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { PageHead } from "../components/ui";
import { Logo } from "../components/Logo";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { copyToClipboard, openExternal } from "../lib/tauri";
import { fmtAgo, fmtDate } from "../lib/format";
import type { Contact } from "../lib/types";
import "./contacts.css";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const HUES = ["#2f7cf6", "#8b5cf6", "#0f9f67", "#e58a0e", "#e5483f", "#0e9db5", "#ec4899"];
const hue = (n: string) => HUES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export default function Contacts() {
  const { data, act } = useData();
  const { search, openModal, openJob, toast } = useUI();
  const [sel, setSel] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [sel]);

  const q = search.trim().toLowerCase();
  const list = useMemo(
    () => data.contacts.filter((c) => !q || [c.name, c.role, c.company, c.email].some((v) => v.toLowerCase().includes(q))),
    [data.contacts, q],
  );
  const current = data.contacts.find((c) => c.id === sel) ?? null;
  const jobOf = (c: Contact) => data.jobs.find((j) => j.id === c.jobId);
  const copy = (text: string, what: string) => copyToClipboard(text).then(() => toast(`${what} copied`), () => toast("Could not copy", "warn"));

  return (
    <div className="page ct">
      <PageHead title="Contacts" subtitle="Recruiters, hiring managers and referrals, all in one place.">
        <button className="btn primary" onClick={() => openModal({ kind: "contact" })}><PlusIcon />Add Contact</button>
      </PageHead>
      <div className={`ct-layout ${current ? "with-drawer" : ""}`}>
        <div className="card ct-table">
          {list.length === 0 ? (
            <div className="empty"><UserCircleIcon className="ct-empty-ico" /><b>{q ? "No contacts match your search" : "No contacts yet"}</b><p>{q ? "Try a different name or company." : "Add recruiters and hiring managers to keep every conversation in one place."}</p></div>
          ) : (
            <table>
              <thead><tr><th>Name</th><th>Company</th><th>Email</th>{!current && <th>Phone</th>}{!current && <th>Linked job</th>}<th>Last contacted</th></tr></thead>
              <tbody>
                {list.map((c) => {
                  const job = jobOf(c);
                  return (
                    <tr key={c.id} className={sel === c.id ? "picked" : ""} onClick={() => setSel(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(c.id)}>
                      <td><div className="ct-name"><span className="ct-av" style={{ background: hue(c.name) }}>{initials(c.name)}</span><span className="dash-grow"><b>{c.name}</b><small>{c.role || "—"}</small></span></div></td>
                      <td>{c.company ? <div className="ct-co"><Logo name={c.company} size={24} /><span className="ct-coname">{c.company}</span></div> : <span className="muted">—</span>}</td>
                      <td>
                        {c.email ? <div className="ct-mail"><span>{c.email}</span><button className="icon-btn ghost" onClick={(e) => { e.stopPropagation(); void copy(c.email, "Email"); }} aria-label={`Copy ${c.name}'s email`}><ClipboardDocumentIcon /></button></div> : <span className="muted">—</span>}
                        {c.linkedin && <button className="link ct-li" onClick={(e) => { e.stopPropagation(); void openExternal(c.linkedin); }}>LinkedIn<ArrowTopRightOnSquareIcon /></button>}
                      </td>
                      {!current && <td>{c.phone || <span className="muted">—</span>}</td>}
                      {!current && <td>{job ? <button className="ct-job" onClick={(e) => { e.stopPropagation(); openJob(job.id); }}>{job.role}</button> : <span className="muted">—</span>}</td>}
                      <td className="ct-last">{c.lastContacted ? <><b>{fmtAgo(c.lastContacted)}</b><small>{fmtDate(c.lastContacted)}</small></> : <span className="muted">Never</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {current && (
          <aside className="card ct-drawer" aria-label={`${current.name} details`}>
            <header>
              <span className="ct-av lg" style={{ background: hue(current.name) }}>{initials(current.name)}</span>
              <div className="dash-grow"><h2>{current.name}</h2><small>{[current.role, current.company].filter(Boolean).join(" · ") || "No role set"}</small></div>
              <button className="icon-btn ghost" onClick={() => setSel(null)} aria-label="Close details"><XMarkIcon /></button>
            </header>
            <div className="ct-drawer-scroll">
              <button className="btn" onClick={() => { act.updateContact(current.id, { lastContacted: Date.now() }); toast(`Logged contact with ${current.name}`); }}><CheckIcon />Log contact</button>
              <small className="muted">{current.lastContacted ? `Last contacted ${fmtAgo(current.lastContacted)} (${fmtDate(current.lastContacted)})` : "Not contacted yet"}</small>
              <ContactForm key={current.id} c={current} />
              <label className="field"><span>Linked job</span>
                <select value={current.jobId ?? ""} onChange={(e) => act.updateContact(current.id, { jobId: e.target.value || undefined })}>
                  <option value="">None</option>
                  {data.jobs.filter((j) => j.status !== "dismissed").map((j) => <option key={j.id} value={j.id}>{j.company} · {j.role}</option>)}
                </select>
              </label>
              <div className="ct-actions">
                {current.email && <button className="btn sm" onClick={() => void copy(current.email, "Email")}><ClipboardDocumentIcon />Copy email</button>}
                {current.linkedin && <button className="btn sm" onClick={() => void openExternal(current.linkedin)}><ArrowTopRightOnSquareIcon />LinkedIn</button>}
                {jobOf(current) && <button className="btn sm" onClick={() => openJob(current.jobId)}>Open job</button>}
              </div>
              <div className="co-danger">
                {confirm ? (
                  <><span>Delete {current.name}?</span><button className="btn sm danger" onClick={() => { act.removeContact(current.id); setSel(null); toast(`Deleted ${current.name}`); }}>Delete</button><button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button></>
                ) : <button className="btn danger-ghost sm" onClick={() => setConfirm(true)}><TrashIcon />Delete contact</button>}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function ContactForm({ c }: { c: Contact }) {
  const { act } = useData();
  const field = (k: "name" | "role" | "company" | "email" | "phone" | "linkedin", label: string, type = "text") => (
    <label className="field"><span>{label}</span><input type={type} value={c[k]} onChange={(e) => act.updateContact(c.id, { [k]: e.target.value })} /></label>
  );
  return (
    <div className="ct-form">
      {field("name", "Name")}
      <div className="form-grid">{field("role", "Role")}{field("company", "Company")}</div>
      {field("email", "Email", "email")}
      <div className="form-grid">{field("phone", "Phone")}{field("linkedin", "LinkedIn")}</div>
    </div>
  );
}
