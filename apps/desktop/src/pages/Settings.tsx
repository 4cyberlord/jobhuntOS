import { useEffect, useState, type ReactNode } from "react";
import {
  BellIcon, Cog6ToothIcon, CommandLineIcon, CreditCardIcon, InformationCircleIcon, MagnifyingGlassCircleIcon, PuzzlePieceIcon, QuestionMarkCircleIcon,
  ShieldCheckIcon, SparklesIcon, UserIcon, UsersIcon,
} from "@heroicons/react/24/outline";
import { PageHead } from "../components/ui";
import { useUI } from "../lib/ui";
import * as P from "./settings/Panes";
import "./settings/settings.css";

const SECTIONS: { name: string; desc: string; tone: string; Icon: typeof UserIcon; pane: (goto: (s: string) => void) => ReactNode }[] = [
  { name: "Account", desc: "Profile, email, plan, and security", tone: "blue", Icon: UserIcon, pane: (g) => <P.Account goto={g} /> },
  { name: "Appearance", desc: "Theme, density, and display", tone: "purple", Icon: SparklesIcon, pane: () => <P.Appearance /> },
  { name: "Notifications", desc: "Email, in-app, and push alerts", tone: "red", Icon: BellIcon, pane: () => <P.Notifications /> },
  { name: "Job Search Preferences", desc: "Roles, locations, salary, and filters", tone: "green", Icon: MagnifyingGlassCircleIcon, pane: () => <P.Prefs /> },
  { name: "AI Agent", desc: "Research, notifications, and automation", tone: "blue", Icon: Cog6ToothIcon, pane: () => <P.Agent /> },
  { name: "Integrations", desc: "Connect LinkedIn, Google, calendar, etc.", tone: "amber", Icon: PuzzlePieceIcon, pane: () => <P.Integrations /> },
  { name: "Data & Privacy", desc: "Data export, privacy settings, and history", tone: "blue", Icon: ShieldCheckIcon, pane: () => <P.Privacy /> },
  { name: "Team & Collaboration", desc: "Manage team members and permissions", tone: "purple", Icon: UsersIcon, pane: () => <P.Team /> },
  { name: "Billing & Plan", desc: "Subscription, usage, and invoices", tone: "red", Icon: CreditCardIcon, pane: () => <P.Billing /> },
  { name: "Keyboard Shortcuts", desc: "Customize shortcuts", tone: "green", Icon: CommandLineIcon, pane: () => <P.Shortcuts /> },
  { name: "Help & Support", desc: "Documentation and contact support", tone: "amber", Icon: QuestionMarkCircleIcon, pane: () => <P.Help /> },
  { name: "About", desc: "Version, updates, and legal", tone: "blue", Icon: InformationCircleIcon, pane: () => <P.About /> },
];

const hl = (text: string, q: string) => {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  return i < 0 ? text : <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
};

export default function Settings() {
  const { params, search } = useUI();
  const [sel, setSel] = useState(SECTIONS.find((s) => s.name === params.section)?.name ?? "Account");
  useEffect(() => { const s = SECTIONS.find((x) => x.name === params.section); if (s) setSel(s.name); }, [params.section]);
  const q = search.trim();
  const shown = q ? SECTIONS.filter((s) => `${s.name} ${s.desc}`.toLowerCase().includes(q.toLowerCase())) : SECTIONS;
  const cur = SECTIONS.find((s) => s.name === sel) ?? SECTIONS[0];
  return (
    <div className="page set">
      <PageHead title="Settings" subtitle="Customize your experience, manage your account, and configure preferences." />
      <div className="set-grid">
        <nav className="set-nav" aria-label="Settings sections">
          {shown.map(({ name, desc, tone, Icon }) => (
            <button key={name} className={sel === name ? "on" : ""} aria-current={sel === name} onClick={() => setSel(name)}>
              <span className={`set-tile ${tone}`}><Icon /></span>
              <span style={{ minWidth: 0 }}><b>{hl(name, q)}</b><small>{hl(desc, q)}</small></span>
            </button>
          ))}
          {shown.length === 0 && <div className="empty"><b>No settings match "{q}"</b></div>}
        </nav>
        <div className="set-pane" key={cur.name}>{cur.pane((s) => setSel(s))}</div>
      </div>
    </div>
  );
}
