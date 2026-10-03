import { useMemo, useState } from "react";
import { PlusIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Field, Modal } from "../../components/ui";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { fromLocalInput, toLocalInput, uid } from "../../lib/format";
import type { CalEvent, EventKind } from "../../lib/types";
import { FORMATS, KINDS } from "./meta";
import "./calendar.css";

export function EventModal({ preset, editId, onClose }: { preset?: Record<string, unknown>; editId?: string; onClose: () => void }) {
  const { data, act } = useData();
  const { toast, navigate } = useUI();
  const existing = editId ? data.events.find((e) => e.id === editId) : undefined;

  const init = useMemo(() => {
    if (existing) return existing;
    const p = (preset ?? {}) as Partial<CalEvent>;
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    const kind: EventKind = p.kind ?? "interview";
    const start = p.start ?? now.getTime();
    const len = kind === "followup" || kind === "deadline" ? 30 : 60;
    return {
      id: "", title: "", company: "", kind, start, end: p.end ?? start + len * 60000, format: (kind === "interview" ? "Video Call" : "None") as CalEvent["format"],
      link: "", location: "", description: "", notes: "", jobId: undefined, attendees: [], prep: [], ...p,
    } as CalEvent;
  }, [existing, preset]);

  const [f, setF] = useState({
    title: init.title, kind: init.kind, company: init.company ?? "", jobId: init.jobId ?? "",
    start: toLocalInput(init.start), end: toLocalInput(init.end), format: init.format,
    where: init.format === "Video Call" ? init.link ?? "" : init.location ?? init.link ?? "",
    description: init.description,
  });
  const [attendees, setAttendees] = useState(init.attendees.map((a) => ({ ...a })));
  const [prep, setPrep] = useState(init.prep.map((p) => ({ ...p })));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const s = fromLocalInput(f.start);
  const e = fromLocalInput(f.end);
  const err = !f.title.trim() ? "" : isNaN(s) || isNaN(e) ? "Enter a valid start and end." : e <= s ? "End must be after the start." : "";
  const ok = f.title.trim() && !isNaN(s) && !isNaN(e) && e > s;

  const pickJob = (id: string) => {
    const j = data.jobs.find((x) => x.id === id);
    setF((v) => ({ ...v, jobId: id, company: j && !v.company.trim() ? j.company : v.company }));
  };

  const save = () => {
    if (!ok) return;
    const where = f.where.trim();
    const patch: Partial<CalEvent> = {
      title: f.title.trim(), kind: f.kind, company: f.company.trim() || undefined, jobId: f.jobId || undefined,
      start: s, end: e, format: f.format, description: f.description.trim(),
      link: f.format === "Video Call" ? where || undefined : undefined,
      location: f.format === "In Person" || f.format === "Phone" ? where || undefined : undefined,
      attendees: attendees.filter((a) => a.name.trim()).map((a) => ({ name: a.name.trim(), role: a.role.trim() })),
      prep: prep.filter((p) => p.text.trim()).map((p) => ({ ...p, text: p.text.trim() })),
    };
    if (existing) {
      act.updateEvent(existing.id, patch);
      toast("Event updated");
      onClose();
    } else {
      const ev = act.addEvent({ ...(patch as CalEvent), title: patch.title!, start: s, end: e, kind: f.kind });
      toast("Event added");
      onClose();
      navigate("calendar", { event: ev.id });
    }
  };
  const del = () => {
    if (!existing) return;
    if (!confirmDel) return setConfirmDel(true);
    act.removeEvent(existing.id);
    toast("Event deleted");
    onClose();
  };

  return (
    <Modal
      wide
      title={existing ? "Edit Event" : "Add Event"}
      subtitle={existing ? "Update the details of this event." : "Schedule an interview, follow-up, deadline or more."}
      onClose={onClose}
      footer={
        <>
          {existing && <button className="btn danger-ghost" style={{ marginRight: "auto" }} onClick={del}><TrashIcon />{confirmDel ? "Click again to confirm" : "Delete"}</button>}
          {err && <span className="form-error" style={{ alignSelf: "center" }}>{err}</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ok} onClick={save}>{existing ? "Save Changes" : "Add Event"}</button>
        </>
      }
    >
      <form className="form-grid" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        <Field label="Title"><input autoFocus value={f.title} onChange={(ev) => set("title", ev.target.value)} placeholder="e.g. Technical Round" /></Field>
        <Field label="Type">
          <select value={f.kind} onChange={(ev) => set("kind", ev.target.value as EventKind)}>{KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
        </Field>
        <Field label="Company">
          <input list="cal-companies" value={f.company} onChange={(ev) => set("company", ev.target.value)} placeholder="Optional" />
          <datalist id="cal-companies">{data.companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <Field label="Related job">
          <select value={f.jobId} onChange={(ev) => pickJob(ev.target.value)}>
            <option value="">None</option>
            {data.jobs.map((j) => <option key={j.id} value={j.id}>{j.company} · {j.role}</option>)}
          </select>
        </Field>
        <Field label="Starts"><input type="datetime-local" value={f.start} onChange={(ev) => set("start", ev.target.value)} /></Field>
        <Field label="Ends"><input type="datetime-local" value={f.end} onChange={(ev) => set("end", ev.target.value)} /></Field>
        <Field label="Format">
          <select value={f.format} onChange={(ev) => set("format", ev.target.value as CalEvent["format"])}>{FORMATS.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        {f.format !== "None" ? (
          <Field label={f.format === "Video Call" ? "Meeting link" : f.format === "Phone" ? "Phone number / dial-in" : "Location"}>
            <input value={f.where} onChange={(ev) => set("where", ev.target.value)} placeholder={f.format === "Video Call" ? "https://meet.google.com/…" : ""} />
          </Field>
        ) : <span />}
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Description"><textarea rows={3} value={f.description} onChange={(ev) => set("description", ev.target.value)} placeholder="What is this about?" /></Field>
        </div>

        <div className="cal-edit-list" style={{ gridColumn: "1 / -1" }}>
          <div className="cal-edit-head"><b>Attendees</b><button type="button" className="btn sm" onClick={() => setAttendees((a) => [...a, { name: "", role: "" }])}><PlusIcon />Add</button></div>
          {attendees.map((a, i) => (
            <div className="cal-edit-row" key={i}>
              <input aria-label="Attendee name" placeholder="Name" value={a.name} onChange={(ev) => setAttendees((l) => l.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <input aria-label="Attendee role" placeholder="Role (e.g. Recruiter)" value={a.role} onChange={(ev) => setAttendees((l) => l.map((x, j) => (j === i ? { ...x, role: ev.target.value } : x)))} />
              <button type="button" className="icon-btn ghost" aria-label="Remove attendee" onClick={() => setAttendees((l) => l.filter((_, j) => j !== i))}><XMarkIcon /></button>
            </div>
          ))}
        </div>

        <div className="cal-edit-list" style={{ gridColumn: "1 / -1" }}>
          <div className="cal-edit-head"><b>Preparation checklist</b><button type="button" className="btn sm" onClick={() => setPrep((p) => [...p, { id: uid(), text: "", done: false }])}><PlusIcon />Add item</button></div>
          {prep.map((p, i) => (
            <div className="cal-edit-row prep" key={p.id}>
              <input type="checkbox" aria-label="Done" checked={p.done} onChange={() => setPrep((l) => l.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
              <input aria-label="Checklist item" placeholder="e.g. Review data structures" value={p.text} onChange={(ev) => setPrep((l) => l.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))} />
              <button type="button" className="icon-btn ghost" aria-label="Remove item" onClick={() => setPrep((l) => l.filter((_, j) => j !== i))}><XMarkIcon /></button>
            </div>
          ))}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
