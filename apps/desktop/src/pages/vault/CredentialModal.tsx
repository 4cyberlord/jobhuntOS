import { useMemo, useState } from "react";
import { EyeIcon, EyeSlashIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { Field, Modal } from "../../components/ui";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { useSecrets } from "../../lib/secrets";
import { fingerprint, generatePassword, scorePassword, sealPassword } from "../../lib/vault";
import type { Credential, CredType } from "../../lib/types";
import { CRED_TYPES, MFA_LABEL } from "./helpers";
import "./vault.css";

type Form = { portal: string; company: string; domain: string; type: CredType; username: string; recoveryEmail: string; password: string; mfa: Credential["mfa"]; notes: string; jobIds: string[] };

export function CredentialModal({ preset, editId, onClose }: { preset?: Record<string, unknown>; editId?: string; onClose: () => void }) {
  const { data, act } = useData();
  const { toast, openModal } = useUI();
  const secrets = useSecrets();
  const existing = editId ? data.credentials.find((c) => c.id === editId) : undefined;
  const [f, setF] = useState<Form>(() => ({
    portal: "", company: "", domain: "", type: "Company", username: "", recoveryEmail: "", password: "", mfa: "none", notes: "", jobIds: [],
    ...(existing ? { portal: existing.portal, company: existing.company ?? "", domain: existing.domain, type: existing.type, username: existing.username, recoveryEmail: existing.recoveryEmail, mfa: existing.mfa, notes: existing.notes, jobIds: existing.jobIds } : {}),
    ...((preset ?? {}) as Partial<Form>),
  }));
  const [show, setShow] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));
  const strength = f.password ? scorePassword(f.password) : undefined;
  const needsPw = !existing;
  const ok = f.portal.trim() && f.username.trim() && (!needsPw || f.password.length > 0);

  const groups = useMemo(() => {
    const m = new Map<string, typeof data.jobs>();
    for (const j of data.jobs) {
      if (q && !`${j.company} ${j.role}`.toLowerCase().includes(q.toLowerCase())) continue;
      m.set(j.company, [...(m.get(j.company) ?? []), j]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data.jobs, q]);

  const toggleJob = (id: string) => set("jobIds", f.jobIds.includes(id) ? f.jobIds.filter((x) => x !== id) : [...f.jobIds, id]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const snapshot = f;
    try {
      let sealed: Pick<Credential, "secret" | "strength" | "fingerprint"> = {};
      if (f.password) {
        if (!(await secrets.ensure())) {
          // the unlock dialog replaced this modal; bring the form back so nothing typed is lost
          openModal({ kind: "credential", editId, preset: { ...snapshot } });
          toast("Vault stayed locked, so nothing was saved.", "warn");
          return;
        }
        sealed = { secret: await sealPassword(f.password), strength: scorePassword(f.password), fingerprint: await fingerprint(f.password) };
      }
      const base = { portal: f.portal.trim(), company: f.company.trim() || undefined, domain: f.domain.trim(), type: f.type, username: f.username.trim(), recoveryEmail: f.recoveryEmail.trim(), mfa: f.mfa, notes: f.notes, jobIds: f.jobIds };
      if (existing) act.updateCredential(existing.id, { ...base, ...sealed }, f.password ? "Updated password" : "Updated details");
      else act.addCredential({ ...base, ...sealed });
      toast(existing ? "Credential updated." : `Saved credential for ${base.portal}.`);
      onClose();
    } catch {
      toast("Could not save the credential.", "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal wide title={existing ? "Edit Credential" : "Add Credential"} subtitle="Passwords are encrypted with your master password and never stored in plain text." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok || busy} onClick={save}>{existing ? "Save changes" : "Save credential"}</button></>}>
      <div className="form-grid">
        <Field label="Portal name"><input autoFocus value={f.portal} onChange={(e) => set("portal", e.target.value)} placeholder="Google Careers" /></Field>
        <Field label="Company">
          <input list="vlt-companies" value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="Google" />
          <datalist id="vlt-companies">{data.companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <Field label="Portal URL / domain"><input value={f.domain} onChange={(e) => set("domain", e.target.value)} placeholder="careers.google.com" /></Field>
        <Field label="Type"><select value={f.type} onChange={(e) => set("type", e.target.value as CredType)}>{CRED_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field label="Username / email"><input value={f.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" /></Field>
        <Field label="Recovery email"><input value={f.recoveryEmail} onChange={(e) => set("recoveryEmail", e.target.value)} autoComplete="off" /></Field>
        <Field label="Password" hint={existing ? "Leave blank to keep the current password." : "Required. Stored encrypted."}>
          <div className="vlt-pwrow">
            <input type={show ? "text" : "password"} value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
            <button type="button" className="icon-btn" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)}>{show ? <EyeSlashIcon /> : <EyeIcon />}</button>
            <button type="button" className="btn" onClick={() => { set("password", generatePassword()); setShow(true); }}><SparklesIcon />Generate</button>
          </div>
          <div className="vlt-meter" aria-label="Password strength"><i className={strength ?? "none"} /><em className={strength ?? "none"}>{strength ? strength[0].toUpperCase() + strength.slice(1) : ""}</em></div>
        </Field>
        <Field label="Multi-factor authentication"><select value={f.mfa} onChange={(e) => set("mfa", e.target.value as Credential["mfa"])}>{(["none", "authenticator", "sms", "email"] as const).map((m) => <option key={m} value={m}>{m === "none" ? "None" : MFA_LABEL[m]}</option>)}</select></Field>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Notes</span>
          <textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Security questions, account quirks, anything else" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <span>Linked applications ({f.jobIds.length})</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search applications…" />
          <div className="vlt-checklist">
            {groups.length === 0 && <p className="muted vlt-small">No applications match.</p>}
            {groups.map(([company, jobs]) => (
              <div key={company}>
                <b>{company}</b>
                {jobs.map((j) => (
                  <label key={j.id}><input type="checkbox" checked={f.jobIds.includes(j.id)} onChange={() => toggleJob(j.id)} /><span>{j.role}</span><small>{j.status}</small></label>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
