import { useEffect, useRef, useState } from "react";
import { Bars3BottomLeftIcon, CalendarDaysIcon, ClockIcon, DocumentDuplicateIcon, EllipsisHorizontalIcon, LinkIcon, MapPinIcon, PencilIcon, PhoneIcon, PlusIcon, TrashIcon, VideoCameraIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { Logo } from "../../components/Logo";
import { StatusPill } from "../../components/ui";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { addDays, fmtDuration, fmtRange, fmtWeekday, uid } from "../../lib/format";
import { copyToClipboard, openExternal } from "../../lib/tauri";
import type { CalEvent } from "../../lib/types";
import { kindMeta } from "./meta";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

export function EventDetail({ ev, onSelect }: { ev: CalEvent; onSelect: (id: string) => void }) {
  const { data, act } = useData();
  const { openModal, openJob, toast } = useUI();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [newPrep, setNewPrep] = useState<string | null>(null);
  const [notes, setNotes] = useState(ev.notes);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = kindMeta(ev.kind);
  const job = ev.jobId ? data.jobs.find((j) => j.id === ev.jobId) : undefined;
  const first = data.settings.profile.name.split(" ")[0] || "You";
  const done = ev.prep.filter((p) => p.done).length;
  const where = ev.format === "Video Call" ? ev.link : ev.location;

  useEffect(() => { setNotes(ev.notes); setMenu(false); setConfirm(false); setNewPrep(null); }, [ev.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!menu) return;
    const on = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) { setMenu(false); setConfirm(false); } };
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, [menu]);

  const saveNotes = () => { if (notes !== ev.notes) act.updateEvent(ev.id, { notes }); };
  const duplicate = () => {
    const copy = act.addEvent({ ...ev, id: undefined, start: addDays(ev.start, 1), end: addDays(ev.end, 1), prep: ev.prep.map((p) => ({ ...p, id: uid(), done: false })) } as never);
    toast("Event duplicated to the next day");
    setMenu(false);
    onSelect(copy.id);
  };
  const remove = () => {
    if (!confirm) return setConfirm(true);
    act.removeEvent(ev.id);
    toast("Event deleted");
  };
  const copy = async () => { if (where) { try { await copyToClipboard(where); toast("Copied to clipboard"); } catch { toast("Could not copy", "warn"); } } };
  const addPrep = () => {
    const t = (newPrep ?? "").trim();
    if (t) act.updateEvent(ev.id, { prep: [...ev.prep, { id: uid(), text: t, done: false }] });
    setNewPrep(null);
  };
  const FormatIcon = ev.format === "Phone" ? PhoneIcon : ev.format === "In Person" ? MapPinIcon : VideoCameraIcon;

  return (
    <div className="cal-detail">
      <div className="cal-d-top">
        <div className="cal-chips">
          <span className="cal-chip" style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}>{ev.kind === "deadline" ? "Deadline" : meta.label}</span>
          {ev.format !== "None" && <span className="cal-chip" style={{ color: "var(--teal, var(--blue))", background: "var(--blue-soft)" }}>{ev.format}</span>}
        </div>
        <button className="btn sm" onClick={() => openModal({ kind: "event", editId: ev.id })}><PencilIcon />Edit</button>
        <div className="cal-menu-wrap" ref={menuRef}>
          <button className="icon-btn sm" aria-label="More actions" onClick={() => setMenu((m) => !m)}><EllipsisHorizontalIcon /></button>
          {menu && (
            <div className="cal-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenu(false); openModal({ kind: "event", editId: ev.id }); }}><PencilIcon />Edit</button>
              <button role="menuitem" onClick={duplicate}><DocumentDuplicateIcon />Duplicate</button>
              <button role="menuitem" className="danger" onClick={remove}><TrashIcon />{confirm ? "Click again to confirm" : "Delete"}</button>
            </div>
          )}
        </div>
      </div>

      <div className="cal-d-title">
        {ev.company ? <Logo name={ev.company.split(" ")[0]} size={44} /> : <span className="cal-d-dot" style={{ background: meta.soft, color: meta.color }}><CalendarDaysIcon /></span>}
        <div>
          <h2>{ev.company || ev.title}</h2>
          <p>{ev.company ? (job ? `${job.role} – ${ev.title}` : ev.title) : meta.label}</p>
        </div>
      </div>

      <div className="cal-d-rows">
        <div><CalendarDaysIcon /><span>{fmtWeekday(ev.start)}</span></div>
        <div><ClockIcon /><span>{fmtRange(ev.start, ev.end)} ({fmtDuration(ev.start, ev.end)})</span></div>
        {ev.format !== "None" && (
          <div>
            <FormatIcon /><span>{ev.format}</span>
            {ev.format === "Video Call" && ev.link && <button className="btn sm cal-join" onClick={() => openExternal(ev.link!)}>Join Meeting</button>}
          </div>
        )}
        {where && (
          <div>
            {ev.format === "Video Call" ? <LinkIcon /> : <MapPinIcon />}
            {ev.format === "Video Call" ? <a className="cal-link" href={where} onClick={(e) => { e.preventDefault(); openExternal(where); }}>{where.replace(/^https?:\/\//, "")}</a> : <span>{where}</span>}
            <button className="icon-btn ghost sm cal-copy" aria-label="Copy" onClick={copy}><DocumentDuplicateIcon /></button>
          </div>
        )}
        {ev.description && <div className="top"><Bars3BottomLeftIcon /><span className="cal-desc">{ev.description}</span></div>}
      </div>

      {job && (
        <section>
          <h3>Related Job</h3>
          <div className="cal-job">
            <Logo name={job.company} size={40} />
            <div className="cal-job-info">
              <div><b>{job.role}</b><StatusPill status={job.status} /></div>
              <small>{job.company}{job.location ? ` · ${job.location}` : ""}</small>
            </div>
            <button className="icon-btn ghost sm" aria-label="Open job" onClick={() => openJob(job.id)}><ArrowTopRightOnSquareIcon /></button>
          </div>
        </section>
      )}

      {ev.attendees.length > 0 && (
        <section>
          <h3>Attendees</h3>
          <div className="cal-att">
            {ev.attendees.map((a, i) => {
              const you = /^(you|me)$/i.test(a.name);
              const name = you ? `${first} (You)` : a.name;
              return (
                <div key={i}>
                  <span className="cal-av" style={{ background: you ? "linear-gradient(135deg,#3b82f6,#7c3aed)" : "linear-gradient(135deg,#f59e0b,#ef4444)" }}>{initials(you ? data.settings.profile.name || "You" : a.name)}</span>
                  <div><b>{name}</b><small>{a.role}</small></div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="cal-prep-head">
          <h3>Preparation</h3>
          {ev.prep.length > 0 && <><span className="progress"><i style={{ width: `${(done / ev.prep.length) * 100}%` }} /></span><em>{done}/{ev.prep.length}</em></>}
        </div>
        <div className="cal-prep">
          {ev.prep.map((p) => (
            <label key={p.id} className={p.done ? "done" : ""}>
              <input type="checkbox" checked={p.done} onChange={() => act.togglePrep(ev.id, p.id)} />
              <span>{p.text}</span>
            </label>
          ))}
          {newPrep === null ? (
            <button className="cal-add-prep" onClick={() => setNewPrep("")}><PlusIcon />Add item</button>
          ) : (
            <input autoFocus className="cal-prep-input" placeholder="New checklist item, press Enter" value={newPrep} onChange={(e) => setNewPrep(e.target.value)} onBlur={addPrep}
              onKeyDown={(e) => { if (e.key === "Enter") addPrep(); if (e.key === "Escape") setNewPrep(null); }} />
          )}
        </div>
      </section>

      <section>
        <h3>Notes</h3>
        <div className="cal-notes">
          <Bars3BottomLeftIcon />
          <textarea rows={3} value={notes} placeholder="Add notes about this event..." onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
        </div>
      </section>
    </div>
  );
}
