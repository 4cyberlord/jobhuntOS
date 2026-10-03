import { useEffect, useRef, useState } from "react";
import {
  ArrowTopRightOnSquareIcon, CheckCircleIcon, DocumentDuplicateIcon, EllipsisHorizontalIcon, ExclamationTriangleIcon, EyeIcon, EyeSlashIcon,
  InformationCircleIcon, LockClosedIcon, PencilSquareIcon, SparklesIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import { Logo } from "../../components/Logo";
import { StatusPill } from "../../components/ui";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { CLIPBOARD_CLEAR_SECONDS, useSecrets } from "../../lib/secrets";
import { fingerprint, generatePassword, lockVault, scorePassword, sealPassword, useVaultState } from "../../lib/vault";
import { copyToClipboard, openExternal } from "../../lib/tauri";
import { fmtDate, fmtDateTime } from "../../lib/format";
import type { Credential } from "../../lib/types";
import { MFA_LABEL, TYPE_CLASS, hostOf, ownerName, plural, reusedIn, urlOf } from "./helpers";

const TABS = ["Overview", "Security", "Applications", "Activity", "Notes"] as const;
type Tab = (typeof TABS)[number];
const REVEAL_MS = 30_000;

export function DetailPanel({ cred, counts, onClose, onDeleted }: { cred: Credential; counts: Map<string, number>; onClose: () => void; onDeleted: () => void }) {
  const { data, act } = useData();
  const { openModal, toast, openJob } = useUI();
  const secrets = useSecrets();
  const vault = useVaultState();
  const [tab, setTab] = useState<Tab>("Overview");
  const [menu, setMenu] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [pw, setPw] = useState<string | null>(null);
  const timer = useRef<number>(0);

  useEffect(() => { setPw(null); setTab("Overview"); setMenu(false); setConfirmDel(false); }, [cred.id]);
  useEffect(() => { if (vault !== "unlocked") setPw(null); }, [vault]);
  useEffect(() => { window.clearTimeout(timer.current); if (pw !== null) timer.current = window.setTimeout(() => setPw(null), REVEAL_MS); return () => window.clearTimeout(timer.current); }, [pw]);

  const reused = reusedIn(cred, counts);
  const jobs = data.jobs.filter((j) => cred.jobIds.includes(j.id));
  const toggleReveal = async () => { if (pw !== null) return setPw(null); const v = await secrets.reveal(cred); if (v !== null) setPw(v); };
  const open = () => openExternal(urlOf(cred.domain));
  const edit = () => openModal({ kind: "credential", editId: cred.id });
  const copyRecovery = async () => { await copyToClipboard(cred.recoveryEmail); toast("Recovery email copied."); };
  const duplicate = () => {
    const { id: _id, activity: _a, ...rest } = cred;
    void _id; void _a;
    act.addCredential({ ...rest, portal: `${cred.portal} (copy)`, jobIds: [], lastUsedAt: Date.now(), createdAt: Date.now() });
    toast("Credential duplicated.");
    setMenu(false);
  };
  const remove = () => { act.removeCredential(cred.id); toast(`Deleted ${cred.portal}.`); onDeleted(); };

  const strength = cred.secret ? cred.strength ?? "medium" : undefined;
  const mfaOn = cred.mfa !== "none";
  const lastChange = cred.activity.find((a) => a.action === "Updated password") ?? cred.activity.find((a) => a.action === "Created credential");

  const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <span className="vlt-check">{ok ? <CheckCircleIcon className="ok" /> : <ExclamationTriangleIcon className="warn" />}{children}</span>
  );
  const strengthRow = (
    <div className="vlt-strength"><span className="vlt-bar"><i className={strength ?? "none"} /></span><b className={strength ?? "none"}>{strength ? strength[0].toUpperCase() + strength.slice(1) : "Not set"}</b></div>
  );
  const uniq = !cred.fingerprint ? <span className="muted">Unknown until a password is saved</span> : reused > 0 ? <span className="vlt-check bad"><ExclamationTriangleIcon className="bad" />Reused in {plural(reused, "other portal")}</span> : <Check ok>Unique password</Check>;
  const mfaSelect = (
    <select aria-label="MFA method" className="vlt-mini-select" value={cred.mfa} onChange={(e) => act.updateCredential(cred.id, { mfa: e.target.value as Credential["mfa"] }, "Updated MFA")}>
      {(["none", "authenticator", "sms", "email"] as const).map((m) => <option key={m} value={m}>{m === "none" ? "None" : MFA_LABEL[m]}</option>)}
    </select>
  );
  const [editMfa, setEditMfa] = useState(false);

  return (
    <aside className="vlt-panel" aria-label="Credential details">
      <div className="vlt-panel-top">
        <button className="btn sm" onClick={open}><ArrowTopRightOnSquareIcon />Open Portal</button>
        <button className="btn sm" onClick={edit}><PencilSquareIcon />Edit</button>
        <div className="vlt-menu-wrap">
          <button className="icon-btn" aria-label="More actions" onClick={() => setMenu(!menu)}><EllipsisHorizontalIcon /></button>
          {menu && (
            <div className="vlt-menu" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { setMenu(false); edit(); }}><PencilSquareIcon />Edit credential</button>
              <button role="menuitem" onClick={duplicate}><DocumentDuplicateIcon />Duplicate credential</button>
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); setConfirmDel(true); }}>Delete credential</button>
            </div>
          )}
        </div>
        <button className="icon-btn ghost" aria-label="Close details" onClick={onClose}><XMarkIcon /></button>
      </div>

      {confirmDel && (
        <div className="vlt-confirm" role="alertdialog">
          <p><b>Delete {cred.portal}?</b> The stored username and encrypted password will be removed. Linked applications are not affected.</p>
          <div><button className="btn sm" onClick={() => setConfirmDel(false)}>Cancel</button><button className="btn sm danger" onClick={remove}>Delete</button></div>
        </div>
      )}

      <div className="vlt-panel-scroll">
        <div className="vlt-hero">
          <div className="vlt-biglogo"><Logo name={ownerName(cred)} size={64} /></div>
          <div className="vlt-hero-text">
            <h2>{cred.portal}</h2>
            {cred.domain && <button className="vlt-url" onClick={open}>{urlOf(cred.domain)}<ArrowTopRightOnSquareIcon /></button>}
            <div className="vlt-chips"><span className={`vlt-type ${TYPE_CLASS[cred.type]}`}>{cred.type === "Company" ? "Company Portal" : cred.type}</span><span className="vlt-apps-chip">{plural(cred.jobIds.length, "Application")}</span></div>
          </div>
        </div>

        <nav className="vlt-tabs" role="tablist">
          {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
        </nav>

        {tab === "Overview" && (
          <div className="vlt-tabbody">
            <section className="vlt-card">
              <h3>Account Details</h3>
              <dl className="vlt-dl">
                <dt>Username / Email</dt><dd><span className="vlt-val">{cred.username || "—"}</span>{cred.username && <button className="vlt-ico" aria-label="Copy username" onClick={() => secrets.copyUsername(cred)}><DocumentDuplicateIcon /></button>}</dd>
                <dt>Password</dt>
                <dd>
                  <span className="vlt-val vlt-pw">{!cred.secret ? <span className="muted">No password saved</span> : pw !== null ? pw : "••••••••••••"}</span>
                  {cred.secret && <>
                    <button className="vlt-ico" aria-label={pw !== null ? "Hide password" : "Show password"} onClick={toggleReveal}>{pw !== null ? <EyeSlashIcon /> : <EyeIcon />}</button>
                    <button className="btn sm vlt-soft" onClick={toggleReveal}>{pw !== null ? "Hide" : "Reveal"}</button>
                  </>}
                </dd>
                <dt>Recovery Email</dt><dd><span className="vlt-val">{cred.recoveryEmail || "—"}</span>{cred.recoveryEmail && <button className="vlt-ico" aria-label="Copy recovery email" onClick={copyRecovery}><DocumentDuplicateIcon /></button>}</dd>
                <dt>Portal URL</dt><dd><span className="vlt-val">{cred.domain ? <button className="link" onClick={open}>{urlOf(cred.domain)}</button> : "—"}</span>{cred.domain && <button className="vlt-ico" aria-label="Open portal" onClick={open}><ArrowTopRightOnSquareIcon /></button>}</dd>
                <dt>MFA Status</dt>
                <dd>
                  {editMfa ? mfaSelect : <span className="vlt-val wrap">{mfaOn ? <Check ok><b>Enabled</b> <span className="muted">({MFA_LABEL[cred.mfa]})</span></Check> : <Check ok={false}><b>Not Enabled</b></Check>}</span>}
                  <button className="btn sm vlt-soft" onClick={() => setEditMfa(!editMfa)}>{editMfa ? "Done" : "Edit"}</button>
                </dd>
                <dt>Password Strength</dt><dd>{strengthRow}</dd>
                <dt>Password Uniqueness</dt><dd>{uniq}</dd>
              </dl>
            </section>

            <div className="vlt-actions">
              <button className="btn" onClick={() => secrets.copyUsername(cred)}><DocumentDuplicateIcon />Copy Username</button>
              <button className="btn" onClick={() => secrets.copyPassword(cred)}><DocumentDuplicateIcon />Copy Password</button>
              <button className="btn primary" onClick={open}><ArrowTopRightOnSquareIcon />Open Portal</button>
            </div>

            <section className="vlt-auth">
              <span className="vlt-auth-ico"><LockClosedIcon /></span>
              <div><b>Authenticate to reveal password</b><p>{vault === "unlocked" ? "Vault unlocked. Passwords can be revealed and copied." : "Unlock your vault with your master password to view and copy this credential securely."}</p></div>
              {vault === "unlocked" ? <button className="btn" onClick={() => { lockVault(); toast("Vault locked."); }}>Lock now</button> : <button className="btn" onClick={() => secrets.ensure()}>{vault === "none" ? "Create Vault" : "Unlock Vault"}</button>}
            </section>
            <p className="vlt-info"><InformationCircleIcon />Password will be automatically cleared from your clipboard in {CLIPBOARD_CLEAR_SECONDS} seconds.</p>

            <div className="vlt-minis">
              <section className="vlt-card">
                <div className="vlt-card-head"><h3>Related Applications</h3><button className="link" onClick={() => setTab("Applications")}>View All</button></div>
                {jobs.length === 0 && <p className="muted vlt-small">No applications linked.</p>}
                {jobs.slice(0, 3).map((j) => (
                  <button key={j.id} className="vlt-rel" onClick={() => openJob(j.id)}>
                    <i /><span><b>{j.role}</b><small>{fmtDate(j.addedAt)}</small></span><StatusPill status={j.status} />
                  </button>
                ))}
              </section>
              <section className="vlt-card">
                <div className="vlt-card-head"><h3>Recent Activity</h3><button className="link" onClick={() => setTab("Activity")}>View All</button></div>
                <ul className="vlt-tl">{cred.activity.slice(0, 4).map((a) => <li key={a.id}><i /><span><b>{a.action}</b><small>{fmtDateTime(a.at)}</small></span></li>)}</ul>
              </section>
            </div>
          </div>
        )}

        {tab === "Security" && <SecurityTab cred={cred} strengthRow={strengthRow} uniq={uniq} lastChange={lastChange?.at} reused={reused} />}
        {tab === "Applications" && <AppsTab cred={cred} />}
        {tab === "Activity" && (
          <div className="vlt-tabbody"><section className="vlt-card"><ul className="vlt-tl">{cred.activity.map((a) => <li key={a.id}><i /><span><b>{a.action}</b><small>{fmtDateTime(a.at)}</small></span></li>)}</ul></section></div>
        )}
        {tab === "Notes" && <NotesTab key={cred.id} cred={cred} />}
      </div>
    </aside>
  );
}

function SecurityTab({ cred, strengthRow, uniq, lastChange, reused }: { cred: Credential; strengthRow: React.ReactNode; uniq: React.ReactNode; lastChange?: number; reused: number }) {
  const { act } = useData();
  const { toast, openModal } = useUI();
  const secrets = useSecrets();
  const [gen, setGen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!gen || busy) return;
    setBusy(true);
    try {
      if (!(await secrets.ensure())) return;
      act.updateCredential(cred.id, { secret: await sealPassword(gen), strength: scorePassword(gen), fingerprint: await fingerprint(gen) }, "Updated password");
      await copyToClipboard(gen, CLIPBOARD_CLEAR_SECONDS * 1000);
      toast(`New password saved and copied. Update it on the ${cred.portal} site too.`);
      setGen(null);
    } catch { toast("Could not save the new password.", "warn"); } finally { setBusy(false); }
  };
  const recs: { text: string; action?: React.ReactNode }[] = [];
  if (cred.mfa === "none") recs.push({ text: "Enable multi-factor authentication on this portal.", action: <button className="btn sm" onClick={() => act.updateCredential(cred.id, { mfa: "authenticator" }, "Updated MFA")}>Mark MFA enabled</button> });
  if (!cred.secret) recs.push({ text: "No password is saved for this portal yet.", action: <button className="btn sm" onClick={() => openModal({ kind: "credential", editId: cred.id })}>Add password</button> });
  if (cred.secret && cred.strength !== "strong") recs.push({ text: "Generate a stronger password.", action: <button className="btn sm" onClick={() => setGen(generatePassword())}><SparklesIcon />Generate a stronger password</button> });
  if (reused > 0) recs.push({ text: `This password is reused in ${plural(reused, "other portal")}. Use a unique one.`, action: <button className="btn sm" onClick={() => setGen(generatePassword())}>Generate</button> });
  return (
    <div className="vlt-tabbody">
      <section className="vlt-card">
        <h3>Security</h3>
        <dl className="vlt-dl">
          <dt>Password Strength</dt><dd>{strengthRow}</dd>
          <dt>MFA</dt><dd><span className="vlt-val">{cred.mfa === "none" ? "Not enabled" : `Enabled (${MFA_LABEL[cred.mfa]})`}</span></dd>
          <dt>Uniqueness</dt><dd>{uniq}</dd>
          <dt>Last password change</dt><dd><span className="vlt-val">{cred.secret && lastChange ? fmtDate(lastChange) : "—"}</span></dd>
        </dl>
      </section>
      <section className="vlt-card">
        <h3>Recommended actions</h3>
        {recs.length === 0 && <p className="vlt-ok"><CheckCircleIcon />Nothing to fix. This credential looks healthy.</p>}
        {recs.map((r) => <div key={r.text} className="vlt-rec"><span>{r.text}</span>{r.action}</div>)}
        {gen && (
          <div className="vlt-gen">
            <code>{gen}</code>
            <div>
              <button className="btn sm" onClick={() => setGen(generatePassword())}>Regenerate</button>
              <button className="btn sm" onClick={() => setGen(null)}>Cancel</button>
              <button className="btn sm primary" disabled={busy} onClick={save}>Save encrypted &amp; copy</button>
            </div>
            <small className="muted">Saving only changes the password stored here. Remember to change it on the portal itself.</small>
          </div>
        )}
      </section>
    </div>
  );
}

function AppsTab({ cred }: { cred: Credential }) {
  const { data, act } = useData();
  const { openJob } = useUI();
  const linked = data.jobs.filter((j) => cred.jobIds.includes(j.id));
  const others = data.jobs.filter((j) => !cred.jobIds.includes(j.id));
  const link = (id: string) => id && act.updateCredential(cred.id, { jobIds: [...cred.jobIds, id] }, "Linked application");
  const unlink = (id: string) => act.updateCredential(cred.id, { jobIds: cred.jobIds.filter((x) => x !== id) }, "Unlinked application");
  return (
    <div className="vlt-tabbody">
      <section className="vlt-card">
        <h3>Applications using this portal</h3>
        {linked.length === 0 && <p className="muted vlt-small">No applications are tied to this credential yet.</p>}
        {linked.map((j) => (
          <div key={j.id} className="vlt-app">
            <button className="vlt-app-main" onClick={() => openJob(j.id)}><Logo name={j.company} size={30} /><span><b>{j.role}</b><small>{j.company}</small></span></button>
            <StatusPill status={j.status} />
            <button className="icon-btn ghost" aria-label={`Unlink ${j.role}`} onClick={() => unlink(j.id)}><XMarkIcon /></button>
          </div>
        ))}
      </section>
      <section className="vlt-card">
        <h3>Link application</h3>
        <select aria-label="Link application" value="" onChange={(e) => link(e.target.value)}>
          <option value="">{others.length ? "Choose an application…" : "All applications are linked"}</option>
          {others.map((j) => <option key={j.id} value={j.id}>{j.company} · {j.role}</option>)}
        </select>
      </section>
    </div>
  );
}

function NotesTab({ cred }: { cred: Credential }) {
  const { act } = useData();
  const { toast } = useUI();
  const [v, setV] = useState(cred.notes);
  return (
    <div className="vlt-tabbody">
      <section className="vlt-card">
        <h3>Notes</h3>
        <textarea rows={8} value={v} onChange={(e) => setV(e.target.value)} placeholder="Security questions, login quirks, who to contact…" />
        <div className="vlt-note-foot"><button className="btn primary sm" disabled={v === cred.notes} onClick={() => { act.updateCredential(cred.id, { notes: v }); toast("Notes saved."); }}>Save notes</button></div>
      </section>
    </div>
  );
}
