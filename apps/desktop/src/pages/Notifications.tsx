import { useCallback, useEffect, useMemo, useState } from "react";
import { BellIcon, CalendarDaysIcon, CheckIcon, ClockIcon, Cog6ToothIcon, FunnelIcon, SparklesIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { PageHead, Empty } from "../components/ui";
import { Logo } from "../components/Logo";
import { fmtInbox } from "../lib/format";
import Detail from "./notifications/Detail";
import { useSnooze } from "./notifications/snooze";
import { FILTER_OF, GROUPS, KIND, chipTone, groupOf, type Filter, type Icon } from "./notifications/meta";
import "./notifications/notifications.css";

const CHIPS: { id: Filter; label: string; icon: Icon }[] = [
  { id: "all", label: "All", icon: BellIcon },
  { id: "unread", label: "Unread", icon: SparklesIcon },
  { id: "followups", label: "Follow-ups", icon: FunnelIcon },
  { id: "interviews", label: "Interviews", icon: CalendarDaysIcon },
  { id: "deadlines", label: "Deadlines", icon: ClockIcon },
  { id: "agent", label: "Agent Alerts", icon: BellIcon },
  { id: "system", label: "System", icon: Squares2X2Icon },
];

export default function Notifications() {
  const { data, act } = useData();
  const { navigate, search, toast } = useUI();
  const [filter, setFilter] = useState<Filter>("all");
  const [selId, setSelId] = useState<string | null>(null);
  const wake = useCallback((id: string) => act.markNotification(id, false), [act]);
  const { snooze, hidden } = useSnooze(wake);

  const visible = useMemo(() => [...data.notifications].filter((n) => !hidden(n.id)).sort((a, b) => b.at - a.at), [data.notifications, hidden]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: visible.length, unread: 0, followups: 0, interviews: 0, deadlines: 0, agent: 0, system: 0 };
    visible.forEach((n) => { c[FILTER_OF[n.kind]]++; if (!n.read) c.unread++; });
    return c;
  }, [visible]);
  const q = search.trim().toLowerCase();
  const list = useMemo(() => visible.filter((n) => (filter === "all" || (filter === "unread" ? !n.read : FILTER_OF[n.kind] === filter)) && (!q || [n.title, n.body, n.company, n.role].some((v) => v?.toLowerCase().includes(q)))), [visible, filter, q]);
  const sel = list.find((n) => n.id === selId) ?? list[0];

  const pick = (id: string) => {
    setSelId(id);
    const n = data.notifications.find((x) => x.id === id);
    if (n && !n.read) act.markNotification(id, true);
  };
  const next = (id: string) => {
    const i = list.findIndex((n) => n.id === id);
    setSelId((list[i + 1] ?? list[i - 1])?.id ?? null);
  };
  useEffect(() => { if (selId && !list.some((n) => n.id === selId)) setSelId(null); }, [list, selId]);

  return (
    <div className="page nt-page">
      <PageHead title="Notifications" subtitle="Stay on top of alerts, reminders, and important updates for your job search.">
        <button className="btn" onClick={() => { act.markAllNotifications(); toast("All notifications marked as read"); }}><CheckIcon /> Mark all as read</button>
        <button className="icon-btn" style={{ width: 38, height: 38 }} onClick={() => navigate("settings")} aria-label="Notification settings"><Cog6ToothIcon /></button>
      </PageHead>

      <div className="nt-chips" role="tablist" aria-label="Filter notifications">
        {CHIPS.map((c) => (
          <button key={c.id} role="tab" aria-selected={filter === c.id} className={`nt-chip ${filter === c.id ? "on" : ""}`} onClick={() => setFilter(c.id)}>
            <c.icon />{c.label}<em>{counts[c.id]}</em>
          </button>
        ))}
      </div>

      <div className="nt-split">
        <div className="nt-list" role="listbox" aria-label="Notifications">
          {list.length === 0 && <Empty title="You're all caught up">No notifications match this view.</Empty>}
          {GROUPS.map((g) => {
            const items = list.filter((n) => groupOf(n) === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="nt-group"><span>{g}</span><em>{items.length}</em></div>
                {items.map((n) => {
                  const k = KIND[n.kind];
                  return (
                    <button key={n.id} role="option" aria-selected={sel?.id === n.id} className={`nt-row ${sel?.id === n.id ? "sel" : ""} ${n.read ? "" : "unread"}`} onClick={() => pick(n.id)}>
                      {n.kind === "interview" && n.company ? <span className="nt-ico plain"><Logo name={n.company} size={44} /></span> : <span className={`nt-ico ${k.tone}`}><k.icon /></span>}
                      <span className="nt-main">
                        <b>{n.title}</b>
                        {(n.company || n.role) && <small>{[n.company, n.role].filter(Boolean).join(" · ")}</small>}
                        <span className="nt-prev">{n.body}</span>
                      </span>
                      <span className="nt-side">
                        <time>{fmtInbox(n.at)}</time>
                        <span className={`nt-pill ${chipTone(n.chip)}`}>{n.chip}</span>
                      </span>
                      {!n.read && <i className="nt-dot" aria-label="Unread" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="nt-detail">
          {sel ? (
            <Detail key={sel.id} n={sel}
              onDone={() => { act.markNotification(sel.id, true); toast("Marked as done"); next(sel.id); }}
              onSnooze={() => { snooze(sel.id); act.markNotification(sel.id, true); toast("Snoozed for 1 hour"); next(sel.id); }} />
          ) : <Empty title="Nothing selected">Pick a notification to see its details.</Empty>}
        </div>
      </div>
    </div>
  );
}
