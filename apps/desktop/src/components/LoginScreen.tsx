import { useState } from "react";
import { Mark } from "./Mark";
import { apiBase, persistSyncConfig, readSyncConfig } from "../lib/syncConfig";
import { workspaceSyncNow } from "../lib/workspaceSync";
import "./login.css";

const FEATURES = [
  { tone: "violet", title: "Track Applications", text: "Stay organized and never miss a follow-up.", icon: <path d="M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1ZM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" /> },
  { tone: "green", title: "Get AI Insights", text: "Personalized tips to improve your chances.", icon: <path d="m5 12.5 4.5 4.5L19 7.5" /> },
  { tone: "orange", title: "Visualize Progress", text: "See your job search journey in real-time.", icon: <path d="M6 20v-7M12 20V6M18 20v-11" /> },
  { tone: "blue", title: "Land Opportunities", text: "Turn applications into offers.", icon: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 2.7 3 5" /></> },
];

/** Sign-in. Your email and password are checked by your server, which then unlocks your workspace on this device. */
export function LoginScreen({ notice }: { notice?: string }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [keep, setKeep] = useState(true);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const cfg = readSyncConfig();
      const res = await fetch(`${apiBase(cfg)}/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password: pw, keep }) });
      if (res.status === 401) throw new Error("Incorrect email or password.");
      if (res.status === 429) throw new Error("Too many attempts. Wait a few minutes and try again.");
      if (res.status === 503) throw new Error("Sign-in isn’t set up on your server yet. Run the one-time owner setup, then try again.");
      if (!res.ok) throw new Error(`Server returned ${res.status}.`);
      const { syncKey } = (await res.json()) as { syncKey: string };
      persistSyncConfig({ ...cfg, syncKey }, keep);
      setPw("");
      void workspaceSyncNow();
    } catch (err) {
      setError(err instanceof TypeError ? "Can’t reach your server. Check your connection and try again." : err instanceof Error ? err.message : "Sign-in failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="lgn">
      <div className="lg-frame">
        <section className="lg-hero">
          <div className="lg-brand"><Mark size={42} /><b>Job Hunt OS</b></div>
          <span className="lg-pill"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2l2.2 6.3L21 10l-6.8 1.7L12 18l-2.2-6.3L3 10l6.8-1.7Z" /></svg>AI-Powered Career Platform</span>
          <h1>Find. Track. Land.<br />Your <span>Dream Job.</span></h1>
          <p className="lg-lead">Organize your applications, track progress, get AI insights, and land opportunities faster — all in one place.</p>
          <ul className="lg-features">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <span className={`lg-ico ${f.tone}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{f.icon}</svg></span>
                <div><b>{f.title}</b><small>{f.text}</small></div>
              </li>
            ))}
          </ul>
          <div className="lg-preview" aria-hidden="true">
            <div className="lg-pv-side"><i /><i /><i /><i /><i /></div>
            <div className="lg-pv-main">
              <div className="lg-pv-stats"><span><i /><b /></span><span><i /><b className="v" /></span><span><i /><b className="g" /></span></div>
              <svg viewBox="0 0 200 70" className="lg-pv-chart"><defs><linearGradient id="lgf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b7bff" stopOpacity=".35" /><stop offset="1" stopColor="#8b7bff" stopOpacity="0" /></linearGradient></defs><path d="M0 60 C25 55 35 40 60 45 S100 25 125 30 170 8 200 4 V70 H0Z" fill="url(#lgf)" /><path d="M0 60 C25 55 35 40 60 45 S100 25 125 30 170 8 200 4" fill="none" stroke="#5b6cff" strokeWidth="2" /></svg>
            </div>
          </div>
        </section>

        <section className="lg-panel">
          <form className="lg-form" onSubmit={submit} noValidate>
            <div className="lg-logo"><Mark size={44} /><b>Job Hunt OS</b></div>
            <h2>Welcome Back</h2>
            <p className="lg-sub">Sign in to continue your job search journey.</p>

            <label className="lg-label" htmlFor="lg-email">Email Address</label>
            <div className="lg-field">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></svg>
              <input id="lg-email" type="email" autoComplete="username" autoFocus placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <label className="lg-label" htmlFor="lg-pw">Password</label>
            <div className="lg-field">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
              {/* A plain text box masked with CSS: the system password box draws its own Caps Lock badge, which flickers whenever Shift is pressed. */}
              <input id="lg-pw" type="text" className={show ? "" : "lg-masked"} autoComplete="current-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Enter your password" value={pw}
                onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))} onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onBlur={() => setCaps(false)} />
              <button type="button" className="lg-eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!show && <path d="M4 4l16 16" />}</svg>
              </button>
            </div>

            {caps && <div className="lg-caps" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4 5 12h4v4h6v-4h4Z" /><path d="M9 20h6" /></svg>Caps Lock is on</div>}
            {error && <div className="lg-err" role="alert">{error}</div>}

            <button className="lg-submit" type="submit" disabled={busy || !email.trim() || !pw}>
              {busy ? "Signing in…" : <>Sign In <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>}
            </button>
            <label className="lg-keep"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />Keep me signed in</label>
          </form>
        </section>
      </div>
    </div>
  );
}
