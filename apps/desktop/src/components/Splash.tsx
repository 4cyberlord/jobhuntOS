import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mark } from "./Mark";
import "./splash.css";

const STEPS = ["Loading modules", "Syncing data", "Preparing dashboard", "Almost there"];
const MIN_MS = 1400;

const I = (p: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p}</svg>;
const ICONS = {
  brief: I(<><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" /></>),
  doc: I(<><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>),
  people: I(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5a3 3 0 0 1 0 6M18 14c2 .7 3 2.7 3 5" /></>),
  bell: I(<><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15Z" /><path d="M10 21h4" /></>),
  cal: I(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>),
  shield: I(<><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>),
  check: I(<path d="m5 12.5 4.5 4.5L19 7.5" />),
  sync: I(<><path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4" /></>),
};

const CARDS: { side: "l" | "r"; tone: string; icon: ReactNode; text: string[]; end: ReactNode; style: React.CSSProperties }[] = [
  { side: "l", tone: "violet", icon: ICONS.brief, text: ["Finding", "Opportunities"], end: <span className="sp-bars"><i /><i /><i /></span>, style: { top: "17%", left: "11%", ["--rot" as string]: "6deg" } },
  { side: "l", tone: "blue", icon: ICONS.doc, text: ["Organizing", "Applications"], end: <span className="sp-tick">{ICONS.check}</span>, style: { top: "36%", left: "7%", ["--rot" as string]: "6deg" } },
  { side: "l", tone: "green", icon: ICONS.people, text: ["Tracking", "Interviews"], end: <span className="sp-bars g"><i /><i /><i /></span>, style: { top: "55%", left: "9.5%", ["--rot" as string]: "-4deg" } },
  { side: "r", tone: "orange", icon: ICONS.bell, text: ["Reviewing", "Updates"], end: <span className="sp-dot" />, style: { top: "18%", right: "11%", ["--rot" as string]: "-6deg" } },
  { side: "r", tone: "pink", icon: ICONS.cal, text: ["Syncing", "Your Calendar"], end: <span className="sp-spin">{ICONS.sync}</span>, style: { top: "37%", right: "7%", ["--rot" as string]: "-6deg" } },
  { side: "r", tone: "blue", icon: ICONS.shield, text: ["Securing", "Your Data"], end: <span className="sp-tick">{ICONS.check}</span>, style: { top: "56%", right: "9.5%", ["--rot" as string]: "-3deg" } },
];

/** Full-screen launch screen. Eases toward 90% while your workspace loads, then completes and fades out once `ready`. */
export function Splash({ ready, note, onDone }: { ready: boolean; note?: string; onDone: () => void }) {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const readyRef = useRef(ready); readyRef.current = ready;

  useEffect(() => {
    const start = performance.now();
    let raf = 0; let shown = 0; let doneAt = 0;
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const target = readyRef.current && now - start > MIN_MS ? 100 : Math.min(90, (1 - Math.exp(-t / 1.6)) * 92);
      shown += (target - shown) * (target === 100 ? 0.18 : 0.08);
      setPct(Math.min(100, Math.round(shown + (target === 100 ? 0.5 : 0))));
      if (target === 100 && shown > 99.4) { if (!doneAt) { doneAt = now; setLeaving(true); setTimeout(onDone, 450); } return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  // WebKit can pause requestAnimationFrame while the Tauri window is launching.
  // Once the workspace is ready, never allow a cosmetic animation to block it.
  useEffect(() => {
    if (!ready || leaving) return;
    const id = setTimeout(() => { setPct(100); setLeaving(true); setTimeout(onDone, 450); }, 2_000);
    return () => clearTimeout(id);
  }, [ready, leaving, onDone]);

  const step = pct >= 96 ? 3 : pct >= 66 ? 2 : pct >= 30 ? 1 : 0;

  return (
    <div className={`splash ${leaving ? "out" : ""}`} role="status" aria-label="Loading Job Hunt OS">
      <div className="sp-glow" />
      {CARDS.map((c, i) => (
        <div key={i} className={`sp-card ${c.tone} ${c.side}`} style={{ ...c.style, animationDelay: `${i * 0.12}s` }}>
          <span className="sp-ico">{c.icon}</span>
          <span className="sp-txt">{c.text[0]}<br />{c.text[1]}</span>
          <span className="sp-end">{c.end}</span>
        </div>
      ))}

      <div className="sp-center">
        <Mark size={84} />
        <h1>Job Hunt <span>OS</span></h1>
        <div className="sp-sub">JOBS <i>•</i> ORGANIZE <i>•</i> GROW</div>
        <p className="sp-ready">Your AI-powered job search companion is getting ready…</p>

        <div className="sp-stage">
          <div className="sp-orbit o1"><i className="b1" /></div>
          <div className="sp-orbit o2"><i className="b2" /><i className="b3" /></div>
          <div className="sp-sphere"><Mark size={110} /></div>
          <div className="sp-plat"><b /><b /></div>
        </div>

        <div className="sp-prog">
          <div className="sp-prog-top"><span>{note ?? "Setting up your workspace…"}</span><span>{pct}%</span></div>
          <div className="sp-track"><div style={{ width: `${pct}%` }} /></div>
          <ol className="sp-steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? "done" : i === step ? "now" : ""}>
                <span className="sp-node">{i < step ? ICONS.check : i === step ? <em /> : null}</span>
                <span>{s.split(" ").length > 1 ? <>{s.slice(0, s.lastIndexOf(" "))}<br />{s.slice(s.lastIndexOf(" ") + 1)}</> : s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="sp-quote"><svg viewBox="0 0 24 24" width="16" height="16" fill="#7c5cff"><path d="M12 2l2.2 6.3L21 10l-6.8 1.7L12 18l-2.2-6.3L3 10l6.8-1.7Z" /></svg>“Organize today. Land tomorrow.”</div>
      </div>
    </div>
  );
}
