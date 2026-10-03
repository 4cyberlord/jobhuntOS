import { BellIcon, BriefcaseIcon, BuildingOffice2Icon, CalendarDaysIcon, ChartBarIcon, InboxArrowDownIcon, Cog6ToothIcon, DocumentPlusIcon, DocumentTextIcon, InboxIcon, KeyIcon, LockClosedIcon, MagnifyingGlassIcon, PlusCircleIcon, Squares2X2Icon, UserGroupIcon, UserPlusIcon, ViewColumnsIcon, CalendarIcon } from "@heroicons/react/24/outline";
import type { ComponentType, SVGProps } from "react";
import { Mark } from "./Mark";
import { useData } from "../lib/store";
import { useUI, type Route } from "../lib/ui";
import { pickFiles } from "../lib/files";

const NAV: { route: Route; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { route: "gate", label: "GATE Inbox", icon: InboxArrowDownIcon },
  { route: "dashboard", label: "Dashboard", icon: Squares2X2Icon },
  { route: "kanban", label: "Kanban", icon: ViewColumnsIcon },
  { route: "opportunities", label: "Opportunities", icon: BriefcaseIcon },
  { route: "companies", label: "Companies", icon: BuildingOffice2Icon },
  { route: "contacts", label: "Contacts", icon: UserGroupIcon },
  { route: "calendar", label: "Calendar", icon: CalendarDaysIcon },
  { route: "documents", label: "Documents", icon: DocumentTextIcon },
  { route: "vault", label: "Credentials Vault", icon: LockClosedIcon },
  { route: "inbox", label: "Agent Inbox", icon: InboxIcon },
  { route: "insights", label: "Insights", icon: ChartBarIcon },
  { route: "notifications", label: "Notifications", icon: BellIcon },
  { route: "settings", label: "Settings", icon: Cog6ToothIcon },
];

export function Sidebar() {
  const { route, navigate, openModal, toast } = useUI();
  const { data, act } = useData();
  const badge: Partial<Record<Route, number>> = {
    gate: data.gate.filter((g) => g.gateStatus === "discovered" || g.gateStatus === "reviewing").length,
    inbox: data.inbox.filter((m) => !m.read).length,
    notifications: data.notifications.filter((n) => !n.read).length,
  };
  const addDocument = async () => {
    const files = await pickFiles();
    if (!files.length) return;
    await act.addFiles(files);
    toast(`${files.length} document${files.length > 1 ? "s" : ""} added`);
    navigate("documents");
  };
  return (
    <aside className="sidebar">
      <div className="traffic-space" data-tauri-drag-region />
      <div className="brand">
        <Mark size={30} />
        <b>Job Hunt OS</b>
      </div>
      <nav>
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <button key={r} className={route === r ? "active" : ""} onClick={() => navigate(r)}>
            <Icon />
            <span>{label}</span>
            {!!badge[r] && <em>{badge[r]}</em>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <section className="quick-add" aria-label="Quick Add">
          <b>Quick Add</b>
          <button onClick={() => openModal({ kind: "job" })}><PlusCircleIcon />Add Job</button>
          <button onClick={() => openModal({ kind: "event" })}><CalendarIcon />Add Event</button>
          <button onClick={() => openModal({ kind: "company" })}><BuildingOffice2Icon />Add Company</button>
          <button onClick={addDocument}><DocumentPlusIcon />Add Document</button>
          <button onClick={() => openModal({ kind: "credential" })}><KeyIcon />Add Credential</button>
          <button onClick={() => openModal({ kind: "contact" })}><UserPlusIcon />Add Contact</button>
        </section>
        <button className="side-search" onClick={() => document.getElementById("global-search")?.focus()}>
          <MagnifyingGlassIcon />
          <span>Search...</span>
          <kbd>⌘ K</kbd>
        </button>
      </div>
    </aside>
  );
}
