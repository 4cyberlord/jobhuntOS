import { ArrowTopRightOnSquareIcon, CalendarDaysIcon, CheckIcon, ChevronRightIcon, ClockIcon, BuildingOffice2Icon, LightBulbIcon, VideoCameraIcon, UserGroupIcon, MapPinIcon, PhoneIcon, EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import type { AppNotification, CalEvent } from "../../lib/types";
import { Logo } from "../../components/Logo";
import { Progress } from "../../components/ui";
import { openExternal, saveBlob } from "../../lib/tauri";
import { fmtShort, fmtDuration, fmtRange, fmtWeekday, fmtTime, startOfDay } from "../../lib/format";
import { FILTER_OF, KIND, NOTIFY_KEY, type Icon } from "./meta";

const meetingName = (e: CalEvent) => {
  const l = (e.link ?? "").toLowerCase();
  if (l.includes("meet.google")) return "Google Meet";
  if (l.includes("zoom")) return "Zoom";
  if (l.includes("teams")) return "Microsoft Teams";
  return e.format === "In Person" ? e.location ?? "On-site" : e.link ? new URL(e.link, "https://x").host : "";
};
const stamp = (t: number) => { const d = Math.round((startOfDay(Date.now()) - startOfDay(t)) / 86_400_000); return `${d === 0 ? "Today" : d === 1 ? "Yesterday" : fmtShort(t)} at ${fmtTime(t)}`; };
const tz = () => new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() ?? "";
const ics = (e: CalEvent) => {
  const f = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Job Hunt OS//EN", "BEGIN:VEVENT", `UID:${e.id}@jobhuntos`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(e.start)}`, `DTEND:${f(e.end)}`, `SUMMARY:${e.title}${e.company ? ` - ${e.company}` : ""}`, e.link ? `URL:${e.link}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
};

function InfoTile({ icon: I, label, value, sub }: { icon: Icon; label: string; value: string; sub?: string }) {
  return (
    <div className="nt-tile">
      <span className="nt-tile-ico"><I /></span>
      <div><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div>
    </div>
  );
}

export default function Detail({ n, onDone, onSnooze }: { n: AppNotification; onDone: () => void; onSnooze: () => void }) {
  const { data, act } = useData();
  const { navigate, openJob, toast } = useUI();
  const ev = n.eventId ? data.events.find((e) => e.id === n.eventId) : undefined;
  const job = n.jobId ? data.jobs.find((j) => j.id === n.jobId) : undefined;
  const company = n.company ?? job?.company;
  const kind = KIND[n.kind];
  const KI = kind.icon;
  const done = ev ? ev.prep.filter((p) => p.done).length : 0;
  const when = ev ? Math.round((startOfDay(ev.start) - startOfDay(Date.now())) / 86_400_000) : 0;

  const goCompany = () => navigate("companies", company ? { company } : {});
  const quick: { icon: Icon; label: string; run: () => void; show: boolean }[] = [
    { icon: BuildingOffice2Icon, label: "View company profile", show: !!company, run: goCompany },
    { icon: LightBulbIcon, label: "See interview preparation tips", show: n.kind === "interview" || n.kind === "reminder", run: () => void openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${company ?? ""} interview preparation tips`)}`) },
    { icon: VideoCameraIcon, label: ev?.link ? `Open ${meetingName(ev) || "meeting"} link` : "Open meeting link", show: !!ev?.link, run: () => void openExternal(ev!.link!) },
    { icon: CalendarDaysIcon, label: "Add to my calendar", show: !!ev, run: () => { saveBlob(new Blob([ics(ev!)], { type: "text/calendar" }), `${ev!.title.replace(/\W+/g, "-")}.ics`); toast("Calendar file saved"); } },
    { icon: UserGroupIcon, label: n.kind === "match" ? "Review matches in Agent Inbox" : "View all interviews", show: n.kind === "match" || n.kind === "interview", run: () => (n.kind === "match" ? navigate("inbox") : navigate("calendar")) },
  ];

  const text = ev
    ? `Your ${ev.title.toLowerCase()} with ${ev.company ?? company} ${when === 0 ? "is today" : when === 1 ? "is tomorrow" : `is on ${fmtWeekday(ev.start)}`} at ${fmtTime(ev.start)} (${tz()}). This is a ${fmtDuration(ev.start, ev.end)} session.${ev.description ? ` ${ev.description}` : ""}`
    : n.body;

  return (
    <div className="nt-detail-scroll">
      <section className="nt-panel">
        <div className="nt-d-top">
          <span className={`nt-tag ${kind.tone}`}><KI />{kind.tag}</span>
          <span className="nt-d-time">{stamp(n.at)}</span>
          <EllipsisVerticalIcon className="nt-dots" aria-hidden />
          {!n.read && <i className="nt-dot" aria-label="Unread" />}
        </div>
        <h2 className="nt-d-title">{n.title}</h2>
        <p className="nt-d-sub">{ev ? `Your ${ev.title.toLowerCase()} is scheduled for ${when === 0 ? "today" : when === 1 ? "tomorrow" : fmtWeekday(ev.start)}.` : n.body}</p>

        {(company || job) && (
          <div className="nt-co">
            <Logo name={company ?? "?"} size={44} />
            <div><b>{company}</b><span>{n.role ?? job?.role ?? ""}</span></div>
            {ev && <span className="nt-badge green">Interview</span>}
            {!ev && job && <span className="nt-badge blue">{job.status.replace("_", " ")}</span>}
            {(job?.url || ev?.link) && <button className="icon-btn ghost" aria-label="Open link" onClick={() => void openExternal((ev?.link ?? job?.url)!)}><ArrowTopRightOnSquareIcon /></button>}
          </div>
        )}

        {ev && (
          <div className="nt-tiles">
            <InfoTile icon={CalendarDaysIcon} label="Date" value={fmtWeekday(ev.start)} />
            <InfoTile icon={ClockIcon} label="Time" value={fmtRange(ev.start, ev.end)} sub={`(${tz()})`} />
            <InfoTile icon={ev.format === "Phone" ? PhoneIcon : ev.format === "In Person" ? MapPinIcon : VideoCameraIcon} label="Format" value={ev.format === "None" ? "—" : ev.format} sub={meetingName(ev)} />
          </div>
        )}
        {ev && <p className="nt-text">{text}</p>}

        {ev && (
          <>
            <div className="nt-prep-head">
              <h3>Preparation Checklist</h3>
              {ev.prep.length > 0 && <span><Progress value={done} max={ev.prep.length} tone="green" /><em>{done} of {ev.prep.length} completed</em></span>}
            </div>
            <ul className="nt-prep">
              {ev.prep.map((p) => (
                <li key={p.id}>
                  <label className={p.done ? "done" : ""}>
                    <input type="checkbox" checked={p.done} onChange={() => act.togglePrep(ev.id, p.id)} />
                    <span>{p.text}</span>
                  </label>
                  <ChevronRightIcon />
                </li>
              ))}
              {ev.prep.length === 0 && <li className="nt-none">No checklist items for this event.</li>}
            </ul>
          </>
        )}

        <div className="nt-actions">
          {job && <button className="btn primary" onClick={() => openJob(job.id)}><ArrowTopRightOnSquareIcon /> View Job Details</button>}
          {ev && <button className="btn" onClick={() => navigate("calendar", { event: ev.id })}><CalendarDaysIcon /> Open in Calendar</button>}
          {n.kind === "match" && <button className="btn primary" onClick={() => navigate("inbox")}>Open Agent Inbox</button>}
          {n.kind === "document" && <button className="btn primary" onClick={() => navigate("documents")}>Open Documents</button>}
          {!job && !ev && n.kind === "weekly" && <button className="btn primary" onClick={() => navigate("insights")}>Open Insights</button>}
          <button className="btn" onClick={onSnooze}><ClockIcon /> Snooze</button>
          <button className="btn done" onClick={onDone}><CheckIcon /> Mark as Done</button>
        </div>
      </section>

      <div className="nt-lower">
        <section className="nt-panel nt-quick">
          <h3>Quick Actions</h3>
          {quick.filter((q) => q.show).map((q) => (
            <button key={q.label} onClick={q.run}><q.icon /><span>{q.label}</span><ChevronRightIcon /></button>
          ))}
        </section>
        <section className="nt-panel nt-prefs">
          <div className="nt-prefs-head"><h3>Notification Settings</h3><button className="link" onClick={() => navigate("settings")}>Manage <ChevronRightIcon /></button></div>
          <p>Manage your notification preferences.</p>
          {([["interviews", "Interview reminders", CalendarDaysIcon], ["deadlines", "Application deadlines", ClockIcon], ["followups", "Follow-up reminders", CheckIcon], ["agent", "Agent alerts (new matches)", LightBulbIcon], ["system", "System notifications", BuildingOffice2Icon]] as const).map(([k, label, I]) => {
            const on = data.settings.notify[NOTIFY_KEY[k]];
            return (
              <div key={k} className={`nt-pref ${FILTER_OF[n.kind] === k ? "cur" : ""}`}>
                <I /><span>{label}</span>
                <button role="switch" aria-checked={on} aria-label={label} className={`nt-onoff ${on ? "on" : ""}`} onClick={() => act.updateSettings("notify", { [k]: !on })}>{on ? "On" : "Off"}</button>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
