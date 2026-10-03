import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { EllipsisHorizontalIcon, FunnelIcon, ListBulletIcon, MagnifyingGlassIcon, PlusIcon, RectangleStackIcon, ViewColumnsIcon } from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { PIPELINE, type Job, type Status } from "../lib/types";
import { Logo } from "../components/Logo";
import { StatusPill } from "../components/ui";
import { cardDate, fitOf, matchesQuery, stageLabel } from "./kanban/helpers";
import "./kanban/kanban.css";

type MenuState = { job: Job; x: number; y: number } | null;

function CardMenu({ menu, onClose }: { menu: NonNullable<MenuState>; onClose: () => void }) {
  const { act } = useData();
  const { openJob, toast } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("mousedown", down); window.removeEventListener("keydown", key); };
  }, [onClose]);
  const { job } = menu;
  const left = Math.min(menu.x, window.innerWidth - 210);
  const top = Math.min(menu.y, window.innerHeight - 330);
  return (
    <div className="kb-menu" ref={ref} style={{ left, top }} role="menu" aria-label={`Actions for ${job.company}`}>
      <button role="menuitem" onClick={() => { openJob(job.id); onClose(); }}>Open details</button>
      <hr />
      <small>Move to…</small>
      {PIPELINE.map((p) => (
        <button key={p.status} role="menuitem" disabled={job.status === p.status} onClick={() => { act.moveJob(job.id, p.status); toast(`Moved ${job.company} to ${p.name}`); onClose(); }}>
          {p.name}
        </button>
      ))}
      <hr />
      <button role="menuitem" className="danger" onClick={() => { act.moveJob(job.id, "dismissed"); toast(`Dismissed ${job.company}`); onClose(); }}>Dismiss</button>
    </div>
  );
}

export default function Kanban() {
  const { data, act } = useData();
  const { openJob, openModal, search, setSearch } = useUI();
  const [track, setTrack] = useState("");
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState<"" | Status>("");
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState<"board" | "list">("board");
  const [menu, setMenu] = useState<MenuState>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  const pipeline = useMemo(() => new Set<Status>(PIPELINE.map((p) => p.status)), []);
  const pool = useMemo(() => data.jobs.filter((j) => pipeline.has(j.status)), [data.jobs, pipeline]);
  const tracks = useMemo(() => [...new Set(pool.map((j) => j.track))].sort(), [pool]);
  const modes = useMemo(() => [...new Set(pool.map((j) => j.workMode))].sort(), [pool]);
  const filtered = useMemo(() => pool.filter((j) => (!track || j.track === track) && (!mode || j.workMode === mode) && (!status || j.status === status) && matchesQuery(j, search)), [pool, track, mode, status, search]);
  const filtering = !!(track || mode || status || search);
  const cols = PIPELINE.filter((c) => !status || c.status === status);

  const clear = () => { setTrack(""); setMode(""); setStatus(""); setSearch(""); };
  const openMenu = (job: Job, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu({ job, x: r.right - 190, y: r.bottom + 4 });
  };

  const onDrop = (e: DragEvent, s: Status) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    setOver(null); setDragId(null);
    const job = data.jobs.find((j) => j.id === id);
    if (job && job.status !== s) act.moveJob(job.id, s);
  };

  return (
    <div className="page kb-page">
      <div className="kb-bar">
        <h1>Kanban</h1>
        <label className="search-field kb-search">
          <MagnifyingGlassIcon />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search jobs, companies…" aria-label="Search jobs" />
        </label>
        <select className="kb-select" value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Filter by track">
          <option value="">All Tracks</option>
          {tracks.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="kb-select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Filter by location">
          <option value="">All Locations</option>
          {modes.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="kb-select" value={status} onChange={(e) => setStatus(e.target.value as "" | Status)} aria-label="Filter by status">
          <option value="">All Statuses</option>
          {PIPELINE.map((p) => <option key={p.status} value={p.status}>{p.name}</option>)}
        </select>
        <div className="kb-spacer" />
        <div className="kb-tools">
          <button className={`icon-btn ${filtering ? "on" : ""}`} onClick={clear} aria-label="Clear all filters" title={filtering ? "Clear filters" : "No filters active"}><FunnelIcon />{filtering && <i />}</button>
          <button className={`icon-btn ${compact ? "on" : ""}`} onClick={() => setCompact((v) => !v)} aria-pressed={compact} aria-label="Compact cards" title="Compact cards"><RectangleStackIcon /></button>
          <button className={`icon-btn ${view === "list" ? "on" : ""}`} onClick={() => setView((v) => (v === "board" ? "list" : "board"))} aria-label={view === "board" ? "Switch to list view" : "Switch to board view"} title={view === "board" ? "List view" : "Board view"}>{view === "board" ? <ListBulletIcon /> : <ViewColumnsIcon />}</button>
        </div>
        <button className="btn primary kb-add" onClick={() => openModal({ kind: "job" })}><PlusIcon /> Add Job</button>
      </div>

      {view === "board" ? (
        <div className={`kb-board ${compact ? "compact" : ""}`} style={status ? { gridTemplateColumns: "minmax(260px, 340px)" } : undefined}>
          {cols.map((c) => {
            const items = filtered.filter((j) => j.status === c.status);
            const total = pool.filter((j) => j.status === c.status).length;
            const dragging = dragId && data.jobs.find((j) => j.id === dragId)?.status !== c.status;
            return (
              <section key={c.status} className={`kb-col ${c.status} ${over === c.status ? "over" : ""}`} aria-label={`${c.name} column`}
                onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== c.status) setOver(c.status); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === c.status ? null : o)); }}
                onDrop={(e) => onDrop(e, c.status)}>
                <header className="kb-col-head">
                  <h2>{c.name}</h2><span>{filtering ? `${items.length}/${total}` : total}</span>
                  <button onClick={() => openModal({ kind: "job", preset: { status: c.status } })} aria-label={`Add job to ${c.name}`}><PlusIcon /></button>
                </header>
                <div className="kb-cards">
                  {items.map((j) => {
                    const d = cardDate(j);
                    const fit = fitOf(j.score);
                    const showFit = j.status === "saved" || (j.status === "preparing" && d.tone === "plain");
                    return (
                      <article key={j.id} className={`kb-card ${dragId === j.id ? "dragging" : ""}`} draggable tabIndex={0} role="button" aria-label={`${j.role} at ${j.company}`}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", j.id); e.dataTransfer.effectAllowed = "move"; setDragId(j.id); }}
                        onDragEnd={() => { setDragId(null); setOver(null); }}
                        onClick={() => openJob(j.id)}
                        onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJob(j.id); } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); openMenu(j, e.currentTarget); } }}>
                        <div className="kb-card-top">
                          <Logo name={j.company} size={compact ? 30 : 38} />
                          <div className="kb-card-body">
                            <b>{j.company}</b>
                            <div className="role">{j.role}</div>
                            <div className="meta">{j.pay} · {j.location}</div>
                          </div>
                        </div>
                        <button className="kb-dots" aria-label={`More actions for ${j.company}`} aria-haspopup="menu" aria-expanded={menu?.job.id === j.id} onClick={(e) => { e.stopPropagation(); openMenu(j, e.currentTarget); }}><EllipsisHorizontalIcon /></button>
                        <div className="kb-chips">
                          {showFit && <span className={`kb-chip ${fit.tone}`}>{fit.label}</span>}
                          <span className={`kb-chip stage ${j.status}`}>{stageLabel(j)}</span>
                          <span className={`kb-date ${d.tone === "red" ? "red" : ""}`}>{d.text}</span>
                        </div>
                      </article>
                    );
                  })}
                  {dragging && over === c.status && <div className="kb-drop">Drop to move to {c.name}</div>}
                  {items.length === 0 && !dragging && <div className="kb-empty">{filtering ? "No matching jobs" : "Nothing here yet"}</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="kb-list">
          <table>
            <thead><tr><th>Company</th><th>Role</th><th>Location</th><th>Pay</th><th>Stage</th><th>Fit</th><th>Date</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {filtered.map((j) => {
                const d = cardDate(j);
                const fit = fitOf(j.score);
                return (
                  <tr key={j.id} onClick={() => openJob(j.id)}>
                    <td><span className="who"><Logo name={j.company} size={28} />{j.company}</span></td>
                    <td>{j.role}</td>
                    <td className="muted">{j.location}</td>
                    <td className="muted">{j.pay}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select value={j.status} aria-label={`Stage for ${j.company}`} onChange={(e) => act.moveJob(j.id, e.target.value as Status)}>
                        {PIPELINE.map((p) => <option key={p.status} value={p.status}>{p.name}</option>)}
                      </select>
                    </td>
                    <td><span className={`kb-chip ${fit.tone}`}>{fit.label}</span></td>
                    <td style={d.tone === "red" ? { color: "var(--red)", fontWeight: 600 } : undefined}>{d.text}</td>
                    <td onClick={(e) => e.stopPropagation()}><StatusPill status={j.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="empty"><b>No matching jobs</b></div>}
        </div>
      )}
      {menu && <CardMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
