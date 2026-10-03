import { useState } from "react";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { createVault, unlockVault, vaultExists } from "../lib/vault";
import { Field, Modal } from "./ui";
import { PIPELINE, type Job, type Status } from "../lib/types";
import { EventModal } from "../pages/calendar/EventModal";
import { CredentialModal } from "../pages/vault/CredentialModal";

export function ModalHost() {
  const { modal, closeModal } = useUI();
  if (!modal) return null;
  switch (modal.kind) {
    case "job": return <JobModal preset={modal.preset} onClose={closeModal} />;
    case "company": return <CompanyModal onClose={closeModal} />;
    case "contact": return <ContactModal preset={modal.preset} onClose={closeModal} />;
    case "event": return <EventModal preset={modal.preset} editId={modal.editId} onClose={closeModal} />;
    case "credential": return <CredentialModal preset={modal.preset} editId={modal.editId} onClose={closeModal} />;
    case "vault-unlock": return <VaultUnlockModal resolve={modal.resolve} />;
  }
}

function JobModal({ preset, onClose }: { preset?: Record<string, unknown>; onClose: () => void }) {
  const { act, data } = useData();
  const { toast, openJob } = useUI();
  const [f, setF] = useState({ company: "", role: "", location: "", workMode: "Remote" as Job["workMode"], pay: "", url: "", status: "saved" as Status, notes: "", ...(preset as object) });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const ok = f.company.trim() && f.role.trim();
  const save = () => {
    const job = act.addJob({ company: f.company.trim(), role: f.role.trim(), location: f.location || (f.workMode === "Remote" ? "Remote · US" : ""), workMode: f.workMode, pay: f.pay || "—", url: f.url, status: f.status, notes: f.notes, track: /product/i.test(f.role) ? "Product" : /data/i.test(f.role) ? "Data" : "Engineering" });
    toast(`Added ${job.company}`);
    onClose();
    openJob(job.id);
  };
  return (
    <Modal title="Add Job" subtitle="Track a new opportunity." onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={save}>Add Job</button></>}>
      <div className="form-grid">
        <Field label="Company"><input autoFocus list="company-list" value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="e.g. Stripe" /><datalist id="company-list">{data.companies.map((c) => <option key={c.id} value={c.name} />)}</datalist></Field>
        <Field label="Role"><input value={f.role} onChange={(e) => set("role", e.target.value)} placeholder="e.g. Software Engineering Intern" /></Field>
        <Field label="Location"><input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="San Francisco, CA" /></Field>
        <Field label="Work mode"><select value={f.workMode} onChange={(e) => set("workMode", e.target.value)}>{["Remote", "Hybrid", "Onsite"].map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Salary / pay"><input value={f.pay} onChange={(e) => set("pay", e.target.value)} placeholder="$40–48/hr" /></Field>
        <Field label="Stage"><select value={f.status} onChange={(e) => set("status", e.target.value)}>{PIPELINE.map((p) => <option key={p.status} value={p.status}>{p.name}</option>)}</select></Field>
        <Field label="Job posting URL"><input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://" /></Field>
        <Field label="Notes"><input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></Field>
      </div>
    </Modal>
  );
}

function CompanyModal({ onClose }: { onClose: () => void }) {
  const { act } = useData();
  const { toast, navigate } = useUI();
  const [f, setF] = useState({ name: "", website: "", industry: "", size: "", hq: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Add Company" subtitle="Keep track of companies you care about." onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim()} onClick={() => { act.addCompany({ ...f, name: f.name.trim() }); toast(`Added ${f.name}`); onClose(); navigate("companies"); }}>Add Company</button></>}>
      <div className="form-grid">
        <Field label="Name"><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Website"><input value={f.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" /></Field>
        <Field label="Industry"><input value={f.industry} onChange={(e) => set("industry", e.target.value)} /></Field>
        <Field label="Size"><input value={f.size} onChange={(e) => set("size", e.target.value)} placeholder="1,000+" /></Field>
        <Field label="Headquarters"><input value={f.hq} onChange={(e) => set("hq", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ContactModal({ preset, onClose }: { preset?: Record<string, unknown>; onClose: () => void }) {
  const { act, data } = useData();
  const { toast } = useUI();
  const [f, setF] = useState({ name: "", role: "", company: "", email: "", phone: "", linkedin: "", jobId: "", ...(preset as object) });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Add Contact" subtitle="Recruiters, hiring managers, referrers, interviewers." onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name.trim()} onClick={() => { act.addContact({ ...f, name: f.name.trim(), jobId: f.jobId || undefined }); toast(`Added ${f.name}`); onClose(); }}>Add Contact</button></>}>
      <div className="form-grid">
        <Field label="Name"><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Role"><input value={f.role} onChange={(e) => set("role", e.target.value)} placeholder="Recruiter" /></Field>
        <Field label="Company"><input list="company-list2" value={f.company} onChange={(e) => set("company", e.target.value)} /><datalist id="company-list2">{data.companies.map((c) => <option key={c.id} value={c.name} />)}</datalist></Field>
        <Field label="Related job"><select value={f.jobId} onChange={(e) => set("jobId", e.target.value)}><option value="">None</option>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.company} · {j.role}</option>)}</select></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="LinkedIn"><input value={f.linkedin} onChange={(e) => set("linkedin", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function VaultUnlockModal({ resolve }: { resolve: (ok: boolean) => void }) {
  const { closeModal } = useUI();
  const exists = vaultExists();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const done = (ok: boolean) => { resolve(ok); closeModal(); };
  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      if (exists) {
        if (await unlockVault(pw)) return done(true);
        setErr("That master password is incorrect.");
      } else {
        if (pw !== pw2) return setErr("The two passwords do not match.");
        await createVault(pw);
        done(true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={exists ? "Unlock Vault" : "Create Vault Master Password"} subtitle={exists ? "Enter your master password to view or copy saved passwords." : "This password encrypts every portal password on this Mac. It is never stored, so it cannot be recovered if you forget it."} onClose={() => done(false)}
      footer={<><button className="btn" onClick={() => done(false)}>Cancel</button><button className="btn primary" disabled={busy || pw.length < 1} onClick={submit}>{exists ? "Unlock" : "Create Vault"}</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="form-stack">
        <Field label="Master password"><input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" /></Field>
        {!exists && <Field label="Confirm master password" hint="Use at least 8 characters."><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="off" /></Field>}
        {err && <p className="form-error">{err}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
