import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowTopRightOnSquareIcon, CameraIcon, ChevronRightIcon, ComputerDesktopIcon, CreditCardIcon, KeyIcon, LinkIcon, MapPinIcon, ShieldCheckIcon, SquaresPlusIcon,
  BriefcaseIcon, DocumentTextIcon, BuildingOffice2Icon, StarIcon, UsersIcon,
} from "@heroicons/react/24/outline";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import type { Settings } from "../../lib/types";
import { Field, Progress, Toggle } from "../../components/ui";
import { isTauri, saveBlob } from "../../lib/tauri";
import { pickFiles } from "../../lib/files";
import { useWorkspaceStatus, workspaceSyncNow } from "../../lib/workspaceSync";
import { syncNow, useSyncConfig, useSyncStatus, writeSyncConfig } from "../../lib/gateSync";
import { fmtAgo } from "../../lib/format";
import { lockVault, vaultExists, vaultUnlocked } from "../../lib/vault";

/** Local editable copy of a settings section that autosaves (debounced). */
function useDraft<K extends "profile" | "prefs">(section: K) {
  const { data, act } = useData();
  const [draft, setDraft] = useState<Settings[K]>(data.settings[section]);
  const [saved, setSaved] = useState(false);
  const first = useRef(true);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { act.updateSettings(section, latest.current); setSaved(true); }, 450);
    return () => { clearTimeout(t); };
  }, [draft, act, section]);
  useEffect(() => () => { if (JSON.stringify(latest.current) !== JSON.stringify(data.settings[section])) act.updateSettings(section, latest.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [draft, (p: Partial<Settings[K]>) => { setSaved(false); setDraft((d) => ({ ...d, ...p })); }, saved] as const;
}

const Card = ({ title, sub, children, aside }: { title: string; sub?: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="set-card">
    <div className="set-card-head"><div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}</div>{aside}</div>
    {children}
  </section>
);
const Row = ({ icon, title, sub, children }: { icon?: ReactNode; title: string; sub?: string; children?: ReactNode }) => (
  <div className="set-row">{icon}<div className="tx"><b>{title}</b>{sub && <small>{sub}</small>}</div>{children && <div className="end">{children}</div>}</div>
);
const Soon = () => <span className="set-soon">Coming soon</span>;

export function Account({ goto }: { goto: (s: string) => void }) {
  const { data } = useData();
  const { openModal, toast } = useUI();
  const [p, set, saved] = useDraft("profile");
  const avatar = p.avatar ?? "";
  const initials = (p.name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const changePhoto = async () => {
    const [f] = await pickFiles("image/png,image/jpeg,image/webp", false);
    if (!f) return;
    if (f.size > 1_500_000) return toast("Choose an image under 1.5 MB", "warn");
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); });
    set({ avatar: url }); toast("Photo updated");
  };
  const docs = data.documents.filter((d) => !d.trashed).length;
  const hasVault = vaultExists();
  const unlockVault = () => openModal({ kind: "vault-unlock", resolve: (ok) => ok && toast("Vault unlocked") });
  return (
    <>
      <Card title="Account" sub="Manage your profile, personal information, and account settings.">
        <div className="set-profile">
          <div className="set-avatar"><span>{avatar ? <img src={avatar} alt="" /> : initials}</span><i><CameraIcon /></i></div>
          <div><h3>{p.name || "Your name"}</h3><div className="role">{p.title}</div><p>{p.bio}</p></div>
          <button className="btn" onClick={changePhoto}>Change Photo</button>
        </div>
        <div className="form-grid">
          <Field label="Full Name"><input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Email Address"><input type="email" value={p.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Job Title"><input value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Location"><div className="set-with-icon"><MapPinIcon /><input value={p.location} onChange={(e) => set({ location: e.target.value })} /></div></Field>
          <label className="field"><span>Phone <em>(Optional)</em></span><input value={p.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
          <Field label="LinkedIn"><div className="set-with-icon"><LinkIcon /><input value={p.linkedin} onChange={(e) => set({ linkedin: e.target.value })} /></div></Field>
          <label className="field"><span>Website <em>(Optional)</em></span><div className="set-with-icon"><LinkIcon /><input value={p.website} onChange={(e) => set({ website: e.target.value })} /></div></label>
          <div style={{ gridColumn: "span 2" }}><Field label="Bio"><input value={p.bio} onChange={(e) => set({ bio: e.target.value })} /></Field></div>
        </div>
        <div className="set-saved">{saved ? "All changes saved" : ""}</div>
      </Card>

      <Card title="Plan & Usage" sub="Personal plan. Everything is stored securely on your own server." aside={<button className="btn" style={{ color: "var(--blue)" }} onClick={() => goto("Billing & Plan")}>Manage Plan</button>}>
        <div className="set-usage">
          <div className="plan"><span className="set-tile solid"><StarIcon /></span><span><b>Personal plan</b><small>Private, single user</small><small>No limits, no subscription</small></span></div>
          {([["Jobs Tracked", data.jobs.length, "blue"], ["Documents", docs, "purple"], ["Companies", data.companies.length, "green"]] as const).map(([l, n, tone]) => (
            <div key={l} className="set-meter"><small>{l}</small><b>{n.toLocaleString()} <span className="set-unl">Unlimited</span></b><Progress value={1} max={1} tone={tone} /></div>
          ))}
        </div>
      </Card>

      <Card title="Security" sub="Keep your account secure and manage your authentication settings.">
        <div className="set-rows">
          <Row icon={<KeyIcon />} title="Password" sub={hasVault ? `Vault master password is set${vaultUnlocked() ? " (vault unlocked)" : ""}` : "Vault master password is not set"}>
            <button className="btn" onClick={unlockVault}>{hasVault ? (vaultUnlocked() ? "Vault unlocked" : "Unlock vault") : "Create vault"}</button>
          </Row>
          <Row icon={<ShieldCheckIcon />} title="Two-Factor Authentication" sub="Not available for local accounts"><Toggle on={false} onChange={() => undefined} label="Two-factor authentication (unavailable)" /><span className="muted">Unavailable</span></Row>
          <Row icon={<ComputerDesktopIcon />} title="Active Sessions" sub="This device only. The app runs locally and has no remote sessions."><span className="set-soon">Local only</span></Row>
          <Row icon={<SquaresPlusIcon />} title="Connected Apps" sub="Manage third-party applications"><button className="btn" onClick={() => goto("Integrations")}>Manage Apps</button><ChevronRightIcon width={16} /></Row>
        </div>
      </Card>
    </>
  );
}

export function Appearance() {
  const { data, act } = useData();
  const a = data.settings.appearance;
  const fs = a.fontScale ?? 100;
  const setFs = (v: number) => act.updateSettings("appearance", { fontScale: Math.min(130, Math.max(75, v)) });
  return (
    <Card title="Appearance" sub="Theme, density, and display.">
      <div className="set-rows">
        <Row title="Theme" sub="Applies instantly. System follows your OS setting.">
          <div className="set-seg" role="radiogroup" aria-label="Theme">{(["light", "dark", "system"] as const).map((t) => <button key={t} role="radio" aria-checked={a.theme === t} className={a.theme === t ? "on" : ""} onClick={() => act.updateSettings("appearance", { theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        </Row>
        <Row title="Density" sub="Compact tightens the header and spacing.">
          <div className="set-seg" role="radiogroup" aria-label="Density">{(["comfortable", "compact"] as const).map((t) => <button key={t} role="radio" aria-checked={a.density === t} className={a.density === t ? "on" : ""} onClick={() => act.updateSettings("appearance", { density: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        </Row>
        <Row title="Font size" sub="Scales all text in the app. Applies instantly.">
          <div className="fs-ctl">
            <button className="btn sm" aria-label="Smaller text" onClick={() => setFs(fs - 5)}>A−</button>
            <input type="range" min={75} max={130} step={5} value={fs} aria-label="Font size" onChange={(e) => setFs(+e.target.value)} />
            <button className="btn sm" aria-label="Larger text" onClick={() => setFs(fs + 5)}>A+</button>
            <b>{fs}%</b>
            <button className="btn sm" disabled={fs === 100} onClick={() => setFs(100)}>Reset</button>
          </div>
        </Row>
      </div>
    </Card>
  );
}

export function Notifications() {
  const { data, act } = useData();
  const { toast } = useUI();
  const n = data.settings.notify;
  const rows: [keyof typeof n, string, string][] = [
    ["interviews", "Interviews", "Reminders before scheduled interviews"], ["deadlines", "Deadlines", "Application and task due dates"],
    ["followups", "Follow-ups", "Nudges to follow up after applying or interviewing"], ["agent", "Agent alerts", "New matches and research from your AI agent"], ["system", "System", "Backups, vault, and app updates"],
  ];
  const test = async () => {
    try {
      if (isTauri()) {
        const m = await import("@tauri-apps/plugin-notification");
        let ok = await m.isPermissionGranted();
        if (!ok) ok = (await m.requestPermission()) === "granted";
        if (!ok) return toast("Notification permission was denied", "warn");
        m.sendNotification({ title: "Job Hunt OS", body: "This is a test notification." });
      } else if (typeof Notification === "undefined") return toast("Notifications are not supported here", "warn");
      else {
        const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (perm !== "granted") return toast("Notification permission was denied", "warn");
        new Notification("Job Hunt OS", { body: "This is a test notification." });
      }
      toast("Test notification sent");
    } catch { toast("Could not send a notification", "warn"); }
  };
  return (
    <Card title="Notifications" sub="Choose which alerts you want to receive.">
      <div className="set-rows">
        {rows.map(([k, t, s]) => <Row key={k} title={t} sub={s}><Toggle on={n[k]} label={t} onChange={(v) => act.updateSettings("notify", { [k]: v })} /></Row>)}
      </div>
      <div className="set-actions" style={{ marginTop: 14 }}><button className="btn" onClick={test}>Send a test notification</button></div>
    </Card>
  );
}

export function Prefs() {
  const [p, set, saved] = useDraft("prefs");
  const f = (k: keyof typeof p, label: string, hint?: string) => <Field label={label} hint={hint}><input value={p[k]} onChange={(e) => set({ [k]: e.target.value })} /></Field>;
  return (
    <Card title="Job Search Preferences" sub="Your agent uses these to find and rank roles.">
      <div className="form-grid">{f("roles", "Roles")}{f("locations", "Locations")}{f("salary", "Salary Range")}{f("companies", "Companies")}{f("keywords", "Keywords")}{f("level", "Experience Level")}</div>
      <div className="set-saved">{saved ? "All changes saved" : ""}</div>
    </Card>
  );
}

export function Agent() {
  const { data, act } = useData();
  const on = data.settings.agent.active;
  return (
    <Card title="AI Agent" sub="Research, notifications, and automation.">
      <div className="set-rows">
        <Row title="Agent active" sub={on ? "The agent is watching for new matches" : "Paused: no new matches will be added"}><Toggle on={on} label="Agent active" onChange={(v) => act.updateSettings("agent", { active: v })} /></Row>
        <Row title="Frequency" sub="The watcher runs on the server on its own schedule; it is not configurable from the app yet."><span className="set-soon">Server schedule</span></Row>
      </div>
      <GateConnection />
      <div className="set-note" style={{ marginTop: 14 }}>
        <b>What the agent can access</b>
        <ul className="set-list">
          <li>Your job preferences, tracked jobs, companies, and calendar.</li>
          <li>It can add matches, research notes, and tasks to your inbox.</li>
          <li>It <b>cannot</b> read the credentials vault or any saved password.</li>
          <li>It <b>never</b> submits applications. You review and submit each one.</li>
        </ul>
      </div>
    </Card>
  );
}

function GateConnection() {
  const cfg = useSyncConfig();
  const st = useSyncStatus();
  const ws = useWorkspaceStatus();
  const [url, setUrl] = useState(cfg.apiUrl);
  const [key, setKey] = useState(cfg.syncKey);
  const [every, setEvery] = useState(String(cfg.intervalSec));
  const dirty = url !== cfg.apiUrl || key !== cfg.syncKey || Number(every) !== cfg.intervalSec;
  const valid = /^https?:\/\//.test(url) && key.length > 0;
  return (
    <div className="set-note" style={{ marginTop: 14 }}>
      <b>GATE Scout connection</b>
      <p style={{ margin: "4px 0 12px", color: "var(--muted)" }}>Pull discovered opportunities from your Job Hunt OS API into the GATE Inbox and report Approve / Dismiss decisions back. The same connection also keeps your jobs, companies, contacts, calendar, tasks, notifications, agent inbox and profile in step across devices (the credential vault, document files and appearance stay on this device). Uses the desktop sync key (DESKTOP_SYNC_KEY), never the agent key. The key is stored only on this Mac and is excluded from exports.</p>
      <div className="form-grid">
        <Field label="API URL"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com" /></Field>
        <Field label="Desktop sync key"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="DESKTOP_SYNC_KEY" autoComplete="off" /></Field>
        <Field label="Check every (seconds)"><input type="number" min={30} value={every} onChange={(e) => setEvery(e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={!dirty || !valid} onClick={() => { writeSyncConfig({ apiUrl: url.trim(), syncKey: key.trim(), intervalSec: Math.max(30, Number(every) || 120) }); setTimeout(() => void workspaceSyncNow(), 50); }}>Save connection</button>
        <button className="btn" disabled={!(cfg.apiUrl && cfg.syncKey)} onClick={() => { void syncNow(); void workspaceSyncNow(); }}>Sync now</button>
        {(cfg.apiUrl || cfg.syncKey) && <button className="btn danger" onClick={() => { writeSyncConfig({ apiUrl: "", syncKey: "", intervalSec: 120 }); setUrl(""); setKey(""); }}>Disconnect</button>}
        <span className="muted">{st.state === "off" ? "Not connected" : st.state === "error" ? st.error : st.state === "syncing" ? "Syncing…" : st.lastAt ? `Last synced ${fmtAgo(st.lastAt)}` : "Connected"}</span>
        <span className="muted">Workspace: {ws.state === "off" ? "off" : ws.state === "error" ? ws.error : ws.state === "syncing" ? "syncing…" : ws.lastAt ? `synced ${fmtAgo(ws.lastAt)}${ws.pending ? ` · ${ws.pending} waiting` : ""}` : "connected"}</span>
      </div>
    </div>
  );
}

export function Integrations() {
  const items: [string, string][] = [["LinkedIn", "Import connections and jobs"], ["Google Calendar", "Sync interviews and deadlines"], ["Gmail", "Track recruiter replies"], ["Notion", "Export notes and boards"]];
  return (
    <Card title="Integrations" sub="Connect LinkedIn, Google, calendar, and more.">
      <div className="set-int">{items.map(([n, d]) => <div key={n}><span className="set-tile blue"><LinkIcon /></span><span className="tx"><b>{n}</b><small>{d}</small></span><Soon /></div>)}</div>
    </Card>
  );
}

export function Privacy() {
  const { data, act } = useData();
  const { toast } = useUI();
  const [step, setStep] = useState<"" | "reset" | "clear">("");
  const exportData = () => {
    const clean = { ...data, credentials: data.credentials.map(({ secret: _s, ...c }) => c) };
    saveBlob(new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }), `job-hunt-os-export-${new Date().toISOString().slice(0, 10)}.json`);
    toast("Exported (vault passwords are never included)");
  };
  const importData = async () => {
    const [f] = await pickFiles(".json,application/json", false);
    if (!f) return;
    try {
      const ok = act.importData(JSON.parse(await f.text()));
      toast(ok ? "Data imported" : "That file is not a valid Job Hunt OS export", ok ? "ok" : "warn");
    } catch { toast("Could not read that file", "warn"); }
  };
  const confirmBox = (kind: "reset" | "clear", label: string, text: string, run: () => void) => step === kind ? (
    <span className="set-actions"><span className="set-danger">{text}</span><button className="btn danger" onClick={() => { run(); setStep(""); }}>Yes, {label.toLowerCase()}</button><button className="btn" onClick={() => setStep("")}>Cancel</button></span>
  ) : <button className="btn danger" onClick={() => setStep(kind)}>{label}</button>;
  return (
    <Card title="Data & Privacy" sub="Data export, privacy settings, and history.">
      <div className="set-rows">
        <Row title="Export data" sub="Download everything as JSON. Vault passwords are excluded."><button className="btn" onClick={exportData}>Export data</button></Row>
        <Row title="Import data" sub="Replace current data with a previous export."><button className="btn" onClick={importData}>Import data</button></Row>
        <Row title="Lock vault now" sub="Forget the master key in memory immediately."><button className="btn" onClick={() => { lockVault(); toast("Vault locked"); }}>Lock vault now</button></Row>
        <Row title="Reset demo data" sub="Replace everything with the sample data.">{confirmBox("reset", "Reset demo data", "Replace all data?", () => { act.resetDemo(); toast("Demo data restored"); })}</Row>
        <Row title="Clear all data" sub="Delete jobs, documents metadata, contacts and more. Settings are kept.">{confirmBox("clear", "Clear all data", "This cannot be undone.", () => { act.clearAll(); toast("All data cleared"); })}</Row>
      </div>
    </Card>
  );
}

const Simple = ({ title, sub, children }: { title: string; sub: string; children: ReactNode }) => <Card title={title} sub={sub}>{children}</Card>;
export const Team = () => <Simple title="Team & Collaboration" sub="Manage team members and permissions."><div className="set-note">Job Hunt OS is a private, single-user app. Sharing and team workspaces are not available.</div><div className="set-actions" style={{ marginTop: 12 }}><Soon /></div></Simple>;
export const Billing = () => (
  <Simple title="Billing & Plan" sub="Subscription, usage, and invoices.">
    <div className="set-rows"><Row icon={<CreditCardIcon />} title="Personal plan" sub="Free and unlimited. No payment method or invoices."><span className="set-soon">No billing</span></Row></div>
  </Simple>
);
export const Shortcuts = () => (
  <Simple title="Keyboard Shortcuts" sub="Customize shortcuts.">
    {([["Focus search", "⌘K / ⌘F"], ["Close dialog or panel", "Esc"]] as const).map(([a, k]) => <div key={a} className="set-kbd-row"><span>{a}</span><kbd>{k}</kbd></div>)}
    <p className="muted" style={{ marginTop: 10 }}>Custom shortcuts are not available yet.</p>
  </Simple>
);
export const Help = () => (
  <Simple title="Help & Support" sub="Documentation and contact support.">
    <ul className="set-list" style={{ marginTop: 0 }}>
      <li>Add jobs from Kanban or Opportunities; drag cards between stages.</li>
      <li>Store files in Documents and logins in the Credentials Vault (master password required).</li>
      <li>The agent suggests matches in Agent Inbox. It never applies for you.</li>
      <li>Export your data any time under Data &amp; Privacy.</li>
    </ul>
    <div className="set-note" style={{ marginTop: 12 }}>Support is community-run for this local build; see the project README for setup and troubleshooting.</div>
  </Simple>
);
export const About = () => (
  <Simple title="About" sub="Version, updates, and legal.">
    <div className="set-rows">
      <Row title="Job Hunt OS" sub="Desktop app built with Tauri and React"><span>Version 0.1.0</span></Row>
      <Row title="Updates" sub="Automatic updates are not enabled in this build."><ArrowTopRightOnSquareIcon width={18} /></Row>
    </div>
  </Simple>
);
