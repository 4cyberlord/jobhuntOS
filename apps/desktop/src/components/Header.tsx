import { useMemo, useState } from "react";
import { BellIcon, ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI, type Route } from "../lib/ui";
import { Logo } from "./Logo";

const PLACEHOLDER: Record<Route, string> = {
  dashboard: "Search opportunities, companies, contacts...",
  kanban: "Search jobs, companies...",
  opportunities: "Search opportunities...",
  companies: "Search companies...",
  contacts: "Search contacts...",
  calendar: "Search events, jobs, companies...",
  documents: "Search documents, files, or content...",
  vault: "Search credentials, companies, or emails...",
  gate: "Search discovered opportunities, companies, skills...",
  inbox: "Search agent messages, jobs, companies...",
  insights: "Search opportunities, companies, contacts...",
  notifications: "Search notifications, companies, jobs...",
  settings: "Search settings, account, notifications...",
};
/** routes whose page filters its own list by the header query; others get a global results dropdown */
const SCOPED = new Set<Route>(["opportunities", "kanban", "companies", "contacts", "calendar", "documents", "vault", "gate", "inbox", "notifications", "settings"]);

export function initials(name: string) {
  return (() => { const p = name.split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?"; })();
}

export function Header() {
  const { route, navigate, back, forward, search, setSearch, openJob } = useUI();
  const { data } = useData();
  const [focus, setFocus] = useState(false);
  const unreadInbox = data.inbox.filter((message) => !message.read).length;
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || SCOPED.has(route)) return [];
    const out: { key: string; logo: string; title: string; sub: string; go: () => void }[] = [];
    data.jobs.filter((j) => `${j.company} ${j.role}`.toLowerCase().includes(q)).slice(0, 5).forEach((j) => out.push({ key: `j${j.id}`, logo: j.company, title: j.role, sub: `${j.company} · ${j.location}`, go: () => openJob(j.id) }));
    data.companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 3).forEach((c) => out.push({ key: `c${c.id}`, logo: c.name, title: c.name, sub: "Company", go: () => navigate("companies") }));
    data.contacts.filter((c) => `${c.name} ${c.company}`.toLowerCase().includes(q)).slice(0, 3).forEach((c) => out.push({ key: `p${c.id}`, logo: c.company || c.name, title: c.name, sub: `${c.role} · ${c.company}`, go: () => navigate("contacts") }));
    data.documents.filter((d) => !d.trashed && d.name.toLowerCase().includes(q)).slice(0, 3).forEach((d) => out.push({ key: `d${d.id}`, logo: d.company ?? d.name, title: d.name, sub: `Document · ${d.folder}`, go: () => navigate("documents", { doc: d.id }) }));
    data.credentials.filter((c) => c.portal.toLowerCase().includes(q)).slice(0, 2).forEach((c) => out.push({ key: `k${c.id}`, logo: c.portal, title: c.portal, sub: "Credential", go: () => navigate("vault", { cred: c.id }) }));
    return out;
  }, [search, route, data, navigate, openJob]);
  const name = data.settings.profile.name;
  const avatar = data.settings.profile.avatar;
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-left">
        <button className="icon-btn ghost" onClick={back} aria-label="Back"><ChevronLeftIcon /></button>
        <button className="icon-btn ghost" onClick={forward} aria-label="Forward"><ChevronRightIcon /></button>
      </div>
      <div className="global-search">
        <label>
          <MagnifyingGlassIcon />
          <input id="global-search" value={search} onChange={(e) => setSearch(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} placeholder={PLACEHOLDER[route]} autoComplete="off" />
          <kbd>⌘ {route === "documents" ? "F" : "K"}</kbd>
        </label>
        {focus && results.length > 0 && (
          <div className="search-results">
            {results.map((r) => (
              <button key={r.key} onMouseDown={() => { r.go(); setSearch(""); }}>
                <Logo name={r.logo} size={28} />
                <span><b>{r.title}</b><small>{r.sub}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="topbar-right">
        <button className="icon-btn ghost bell" onClick={() => navigate("inbox")} aria-label={unreadInbox ? `Agent Inbox, ${unreadInbox} unread` : "Agent Inbox"}>
          <BellIcon />
          {unreadInbox > 0 && <i>{unreadInbox > 99 ? "99+" : unreadInbox}</i>}
        </button>
        <button className={`avatar ${avatar ? "has-photo" : ""}`} onClick={() => navigate("settings")} aria-label="Account" title={name}>{avatar ? <img src={avatar} alt="" /> : initials(name)}</button>
      </div>
    </header>
  );
}
