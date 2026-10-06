import { DataProvider } from "./lib/store";
import { UIProvider, useUI, type Route } from "./lib/ui";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { JobInspector } from "./components/JobInspector";
import { ModalHost } from "./components/ModalHost";
import { useData } from "./lib/store";
import { useCallback, useEffect, useState } from "react";
import { Splash } from "./components/Splash";
import { useGateSyncRunner } from "./lib/gateSync";
import { useWorkspacePhase, useWorkspaceStatus, useWorkspaceSyncRunner, workspaceSyncNow } from "./lib/workspaceSync";
import { stripSampleData } from "./lib/seed";
import { UpdateBanner } from "./components/UpdateBanner";
import { LoginScreen } from "./components/LoginScreen";

import Dashboard from "./pages/Dashboard";
import Kanban from "./pages/Kanban";
import Opportunities from "./pages/Opportunities";
import Companies from "./pages/Companies";
import CompanyIntelligence from "./pages/CompanyIntelligence";
import Contacts from "./pages/Contacts";
import Calendar from "./pages/Calendar";
import Documents from "./pages/Documents";
import Vault from "./pages/Vault";
import Gate from "./pages/Gate";
import AgentInbox from "./pages/AgentInbox";
import Insights from "./pages/Insights";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";

const PAGES: Record<Route, () => React.JSX.Element> = {
  dashboard: Dashboard, kanban: Kanban, opportunities: Opportunities, companies: Companies, "company-intelligence": CompanyIntelligence, contacts: Contacts, calendar: Calendar,
  documents: Documents, vault: Vault, gate: Gate, inbox: AgentInbox, insights: Insights, notifications: Notifications, settings: Settings,
};
/** pages that manage their own internal scrolling panes */
const FILL = new Set<Route>(["kanban", "calendar", "documents", "vault", "gate", "inbox", "notifications", "settings"]);

function Shell() {
  const { route, toasts } = useUI();
  const { data } = useData();
  const Page = PAGES[route];
  useGateSyncRunner();
  useEffect(() => {
    const t = data.settings.appearance.theme;
    document.documentElement.dataset.theme = t === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;
    document.documentElement.dataset.density = data.settings.appearance.density;
    document.documentElement.style.setProperty("--fs", String((data.settings.appearance.fontScale ?? 100) / 100));
  }, [data.settings.appearance]);
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Header />
        <main className={`content ${FILL.has(route) ? "fill" : ""}`} key={route}>
          <Page />
        </main>
      </div>
      <JobInspector />
      <ModalHost />
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>
    </div>
  );
}

export default function App() {
  return (
    <DataProvider>
      <UIProvider>
        <Boot />
      </UIProvider>
    </DataProvider>
  );
}

/** Loads your workspace from the server (behind the launch screen), then shows the app and keeps it synced. */
function Boot() {
  useWorkspaceSyncRunner();
  const ph = useWorkspacePhase();
  const st = useWorkspaceStatus();
  const { act } = useData();
  const [splashDone, setSplashDone] = useState(false);
  const done = useCallback(() => setSplashDone(true), []);
  const ready0 = ph.phase === "ready";
  // one-time housekeeping: sample records from the original demo are removed from your workspace (and so from the server)
  useEffect(() => { if (ready0) act.replaceWorkspace(stripSampleData); }, [ready0, act]);
  if (ph.phase === "needs-config") return <LoginScreen key="login" notice={ph.error} />;
  if (ph.phase === "error") return <LoginScreen key="login" notice={ph.error} />;
  const ready = ph.phase === "ready";
  return <>
    {ready && <Shell />}
    {ready && <UpdateBanner />}
    {ready && st.state === "error" && <div className="sync-banner" role="status">Changes not saved yet — {st.error} Retrying…{" "}<button className="btn sm" onClick={() => void workspaceSyncNow()}>Retry now</button></div>}
    {!splashDone && <Splash ready={ready} note={ph.migrating ? "Moving your data to your server…" : "Loading your workspace…"} onDone={done} />}
  </>;
}
