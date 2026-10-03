import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowPathIcon, BellIcon, CalendarDaysIcon, CheckCircleIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, PlusIcon } from "@heroicons/react/24/outline";
import { Logo } from "../components/Logo";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { addDays, fmtRange, fmtShort, fmtTime, fmtWeekday, monthName, sameDay, startOfDay, startOfWeek } from "../lib/format";
import type { CalEvent, EventKind } from "../lib/types";
import { KINDS, kindMeta } from "./calendar/meta";
import { EventDetail } from "./calendar/EventDetail";
import "./calendar/calendar.css";

type View = "day" | "week" | "month";
type Filter = "all" | "interview" | "followup" | "deadline" | "assessment" | "personal";
const HOUR = 60;
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All Events" }, { id: "interview", label: "Interviews" }, { id: "followup", label: "Follow-ups" },
  { id: "deadline", label: "Deadlines" }, { id: "assessment", label: "Assessments" }, { id: "personal", label: "Other" },
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = (h: number) => (h === 0 ? "" : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`);

const shiftMonth = (t: number, n: number) => {
  const d = new Date(t);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
};
const monthGrid = (t: number) => {
  const d = new Date(t);
  const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
};

/** column-pack overlapping events: returns [event, col, cols] */
function layout(list: CalEvent[]) {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { ev: CalEvent; col: number; cols: number }[] = [];
  let cluster: { ev: CalEvent; col: number; cols: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => { cluster.forEach((c) => (c.cols = colEnds.length)); out.push(...cluster); cluster = []; colEnds = []; };
  for (const ev of sorted) {
    const end = Math.max(ev.end, ev.start + 20 * 60000);
    if (cluster.length && ev.start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= ev.start);
    if (col < 0) { col = colEnds.length; colEnds.push(end); } else colEnds[col] = end;
    cluster.push({ ev, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

export default function Calendar() {
  const { data } = useData();
  const { params, search, openModal, navigate, toast } = useUI();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(() => startOfDay(Date.now()));
  const [mini, setMini] = useState(() => startOfDay(Date.now()));
  const [selId, setSelId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<EventKind>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [addMenu, setAddMenu] = useState(false);
  const [now, setNow] = useState(Date.now());
  const gridRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const today = startOfDay(now);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => setMini(cursor), [cursor]);
  useEffect(() => {
    const id = params.event;
    if (!id) return;
    const ev = data.events.find((e) => e.id === id);
    if (ev) { setSelId(ev.id); setCursor(startOfDay(ev.start)); setFilter("all"); setHidden(new Set()); }
  }, [params.event]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!addMenu) return;
    const on = (e: MouseEvent) => { if (!addRef.current?.contains(e.target as Node)) setAddMenu(false); };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [addMenu]);

  // range
  const weekStart = startOfWeek(cursor);
  const days = useMemo(() => (view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : view === "day" ? [cursor] : monthGrid(cursor)), [view, cursor, weekStart]);
  const rangeStart = days[0];
  const rangeEnd = addDays(days[days.length - 1], 1);
  const title = view === "week" ? `${fmtShort(days[0])} – ${fmtShort(days[6])}, ${new Date(days[6]).getFullYear()}`
    : view === "day" ? fmtWeekday(cursor) : `${monthName(cursor)} ${new Date(cursor).getFullYear()}`;

  const q = search.trim().toLowerCase();
  const searched = useMemo(() => data.events.filter((e) => !q || e.title.toLowerCase().includes(q) || (e.company ?? "").toLowerCase().includes(q)), [data.events, q]);
  const inRange = useMemo(() => searched.filter((e) => e.start >= rangeStart && e.start < rangeEnd), [searched, rangeStart, rangeEnd]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: inRange.length, interview: 0, followup: 0, deadline: 0, assessment: 0, personal: 0 };
    inRange.forEach((e) => c[e.kind]++);
    return c;
  }, [inRange]);
  const visible = useMemo(() => inRange.filter((e) => !hidden.has(e.kind) && (filter === "all" || e.kind === filter)), [inRange, hidden, filter]);

  const selected = useMemo(() => {
    const found = selId ? data.events.find((e) => e.id === selId) : undefined;
    if (found) return found;
    const upcoming = [...data.events].filter((e) => e.end >= now).sort((a, b) => a.start - b.start)[0];
    return upcoming ?? [...data.events].sort((a, b) => b.start - a.start)[0];
  }, [selId, data.events, now]);

  // scroll to ~8 AM when switching to a time grid
  useEffect(() => { if (view !== "month" && gridRef.current) gridRef.current.scrollTop = 7.5 * HOUR; }, [view]);

  const go = (dir: -1 | 1) => setCursor((c) => (view === "day" ? addDays(c, dir) : view === "week" ? addDays(c, dir * 7) : startOfDay(shiftMonth(c, dir))));
  const toDay = () => setCursor(startOfDay(Date.now()));
  const addAt = (day: number, hour?: number, kind: EventKind = "interview") => {
    let h = hour;
    if (h === undefined) h = sameDay(day, Date.now()) ? Math.min(new Date().getHours() + 1, 22) : 9;
    const start = new Date(day); start.setHours(h, 0, 0, 0);
    const len = kind === "followup" || kind === "deadline" ? 30 : 60;
    openModal({ kind: "event", preset: { start: start.getTime(), end: start.getTime() + len * 60000, kind } });
  };
  const toggleCal = (k: EventKind) => setHidden((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const pickDate = (v: string) => { if (v) { const [y, m, d] = v.split("-").map(Number); setCursor(new Date(y, m - 1, d).getTime()); } };
  const openPicker = () => { const i = dateRef.current; if (!i) return; try { i.showPicker(); } catch { i.focus(); i.click(); } };

  const nowMin = (now - today) / 60000;

  const Card = ({ ev, col = 0, cols = 1, day }: { ev: CalEvent; col?: number; cols?: number; day: number }) => {
    const m = kindMeta(ev.kind);
    const startMin = Math.max(0, (ev.start - day) / 60000);
    const endMin = Math.min(1440, (ev.end - day) / 60000);
    const h = Math.max(((endMin - startMin) / 60) * HOUR - 2, 22);
    const long = h >= 52;
    return (
      <button
        className={`cal-ev k-${ev.kind} ${selected?.id === ev.id ? "sel" : ""}`}
        style={{ top: (startMin / 60) * HOUR + 1, height: h, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, ["--k" as string]: m.color }}
        onClick={(e) => { e.stopPropagation(); setSelId(ev.id); }}
        title={`${ev.title}${ev.company ? " · " + ev.company : ""}\n${fmtRange(ev.start, ev.end)}`}
      >
        {ev.kind === "interview" && ev.company && <Logo name={ev.company.split(" ")[0]} size={18} />}
        {ev.kind === "followup" && (ev.title.toLowerCase().includes("thank") ? <ArrowPathIcon className="cal-ev-ic" /> : <BellIcon className="cal-ev-ic" />)}
        <span className="cal-ev-t">
          <b>{ev.title}</b>
          {ev.company && ev.kind !== "interview" && h >= 40 && <b>{ev.company}</b>}
          {ev.kind === "interview" && ev.company && h >= 78 && <i>{ev.company}</i>}
          <i>{fmtRange(ev.start, ev.end)}</i>
          {ev.kind === "interview" && ev.format !== "None" && long && h >= 64 && <i>{ev.format}</i>}
        </span>
      </button>
    );
  };

  const dayCol = (day: number) => {
    const list = visible.filter((e) => sameDay(e.start, day));
    return (
      <div className="cal-col" key={day} onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        addAt(day, Math.max(0, Math.min(23, Math.floor((e.clientY - r.top) / HOUR))));
      }}>
        {layout(list).map(({ ev, col, cols }) => <Card key={ev.id} ev={ev} col={col} cols={cols} day={day} />)}
        {day === today && <div className="cal-now" style={{ top: (nowMin / 60) * HOUR }}><i /></div>}
      </div>
    );
  };

  const timeGrid = (
    <div className="cal-grid-scroll" ref={gridRef}>
      <div className="cal-grid" style={{ ["--cols" as string]: days.length }}>
        <div className="cal-gh">
          <span />
          {days.map((d) => (
            <button key={d} className={`cal-gh-d ${d === today ? "today" : ""}`} onClick={() => { setCursor(d); if (view === "week") setView("day"); }} aria-label={`Open ${fmtWeekday(d)}`}>
              <small>{DOW[new Date(d).getDay()]}</small><b>{new Date(d).getDate()}</b>
            </button>
          ))}
        </div>
        <div className="cal-gb" style={{ height: 24 * HOUR }}>
          <div className="cal-gutter">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR }}>{hourLabel(h)}</span>)}</div>
          {days.map((d) => dayCol(d))}
        </div>
      </div>
    </div>
  );

  const monthView = (
    <div className="cal-month">
      <div className="cal-m-head">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-m-grid">
        {days.map((d) => {
          const list = visible.filter((e) => sameDay(e.start, d)).sort((a, b) => a.start - b.start);
          const other = new Date(d).getMonth() !== new Date(cursor).getMonth();
          return (
            <div key={d} className={`cal-m-cell ${other ? "other" : ""} ${sameDay(d, cursor) ? "cur" : ""}`} onClick={() => { setCursor(d); }} onDoubleClick={() => addAt(d)}>
              <b className={d === today ? "today" : ""}>{new Date(d).getDate()}</b>
              {list.slice(0, 3).map((ev) => (
                <button key={ev.id} className={`cal-chipev k-${ev.kind} ${selected?.id === ev.id ? "sel" : ""}`} style={{ ["--k" as string]: kindMeta(ev.kind).color }} onClick={(e) => { e.stopPropagation(); setSelId(ev.id); setCursor(d); }} title={ev.title}>
                  <i />{fmtTime(ev.start).replace(":00", "")} {ev.company && ev.kind !== "interview" ? `${ev.title} · ${ev.company}` : ev.title}
                </button>
              ))}
              {list.length > 3 && <button className="cal-more" onClick={(e) => { e.stopPropagation(); setCursor(d); setView("day"); }}>+{list.length - 3} more</button>}
            </div>
          );
        })}
      </div>
    </div>
  );

  const miniDays = monthGrid(mini);
  const miniMonth = new Date(mini).getMonth();

  return (
    <div className="page cal-page">
      <div className="cal-head">
        <div>
          <h1>Calendar</h1>
          <p>Stay on top of your interviews, follow-ups, deadlines, and more.</p>
        </div>
        <div className="cal-actions">
          <button className="btn" onClick={toDay}>Today</button>
          <div className="cal-seg" role="tablist" aria-label="View">
            {(["day", "week", "month"] as View[]).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div>
          <div className="cal-date-wrap">
            <button className="icon-btn" aria-label="Jump to date" onClick={openPicker}><CalendarDaysIcon /></button>
            <input ref={dateRef} type="date" tabIndex={-1} aria-hidden onChange={(e) => pickDate(e.target.value)} />
          </div>
          <button className="icon-btn" aria-label="Refresh" onClick={() => { toDay(); setSelId(null); toast("Calendar refreshed"); }}><ArrowPathIcon /></button>
          <div className="cal-split" ref={addRef}>
            <button className="btn primary" onClick={() => addAt(cursor)}><PlusIcon />Add Event</button>
            <button className="btn primary chev" aria-label="Add event of type" aria-haspopup="menu" onClick={() => setAddMenu((m) => !m)}><ChevronDownIcon /></button>
            {addMenu && (
              <div className="cal-menu right" role="menu">
                {KINDS.map((k) => <button key={k.kind} role="menuitem" onClick={() => { setAddMenu(false); addAt(cursor, undefined, k.kind); }}><i style={{ background: k.color }} />{k.label === "Application Deadline" ? "Deadline" : k.label}</button>)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cal-body">
        <aside className="cal-left">
          <div className="cal-mini">
            <div className="cal-mini-head">
              <b>{monthName(mini)} {new Date(mini).getFullYear()}</b>
              <button className="icon-btn ghost sm" aria-label="Previous month" onClick={() => setMini((m) => shiftMonth(m, -1))}><ChevronLeftIcon /></button>
              <button className="icon-btn ghost sm" aria-label="Next month" onClick={() => setMini((m) => shiftMonth(m, 1))}><ChevronRightIcon /></button>
            </div>
            <div className="cal-mini-grid">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <small key={i}>{d}</small>)}
              {miniDays.map((d) => (
                <button key={d} className={`${new Date(d).getMonth() !== miniMonth ? "dim" : ""} ${d === today ? "today" : ""} ${sameDay(d, cursor) && d !== today ? "sel" : ""}`} onClick={() => setCursor(d)}>
                  {new Date(d).getDate()}
                </button>
              ))}
            </div>
          </div>
          <h4>My Calendars</h4>
          <div className="cal-cals">
            {KINDS.map((k) => (
              <label key={k.kind}>
                <input type="checkbox" checked={!hidden.has(k.kind)} onChange={() => toggleCal(k.kind)} style={{ ["--k" as string]: k.color }} className="cal-cb" />
                <span>{k.cal}</span>
              </label>
            ))}
          </div>
          <h4>Filters</h4>
          <div className="cal-filters">
            {FILTERS.map((f) => {
              const k = f.id === "all" ? undefined : kindMeta(f.id as EventKind);
              return (
                <button key={f.id} className={filter === f.id ? "on" : ""} onClick={() => setFilter(f.id)}>
                  <i style={{ borderColor: k?.color ?? "var(--blue)", color: k?.color ?? "var(--blue)" }}>
                    {f.id === "all" ? null : f.id === "interview" ? <CalendarDaysIcon /> : f.id === "followup" ? <BellIcon /> : f.id === "deadline" ? <ClockIcon /> : f.id === "assessment" ? <CheckCircleIcon /> : <CalendarDaysIcon />}
                  </i>
                  <span>{f.label}</span><em>{counts[f.id]}</em>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="cal-main">
          <div className="cal-main-head">
            <h2>{title}</h2>
            <div className="cal-nav">
              <button className="icon-btn ghost sm" aria-label="Previous" onClick={() => go(-1)}><ChevronLeftIcon /></button>
              <button className="icon-btn ghost sm" aria-label="Next" onClick={() => go(1)}><ChevronRightIcon /></button>
            </div>
            <span className="cal-spacer" />
            <button className="icon-btn ghost sm" aria-label="Add event" onClick={() => addAt(cursor)}><PlusIcon /></button>
          </div>
          {view === "month" ? monthView : timeGrid}
        </section>

        <aside className="cal-right">
          {selected ? <EventDetail key={selected.id} ev={selected} onSelect={(id) => navigate("calendar", { event: id })} /> : (
            <div className="cal-empty"><CalendarDaysIcon /><b>No events yet</b><p>Add an interview, follow-up or deadline to see its details here.</p><button className="btn primary" onClick={() => addAt(cursor)}><PlusIcon />Add Event</button></div>
          )}
        </aside>
      </div>
    </div>
  );
}
