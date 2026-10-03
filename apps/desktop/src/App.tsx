import { DataProvider } from "./lib/store";
import { UIProvider, useUI, type Route } from "./lib/ui";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { JobInspector } from "./components/JobInspector";
import { ModalHost } from "./components/ModalHost";
import { useData } from "./lib/store";
import { useEffect } from "react";
import { useGateSyncRunner } from "./lib/gateSync";

import Dashboard from "./pages/Dashboard";
import Kanban from "./pages/Kanban";
import Opportunities from "./pages/Opportunities";
import Companies from "./pages/Companies";
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
  dashboard: Dashboard, kanban: Kanban, opportunities: Opportunities, companies: Companies, contacts: Contacts, calendar: Calendar,
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
        <Shell />
      </UIProvider>
    </DataProvider>
  );
}
