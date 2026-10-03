import { useEffect, useMemo, useState } from "react";
import {
  AdjustmentsHorizontalIcon, ArrowRightIcon, BellAlertIcon, BookmarkIcon, BuildingOffice2Icon, CalendarDaysIcon, ChartBarIcon, CheckIcon, Cog6ToothIcon,
  DocumentIcon, DocumentTextIcon, EllipsisHorizontalIcon, EnvelopeIcon, ExclamationTriangleIcon, FunnelIcon, LightBulbIcon, MagnifyingGlassIcon,
  MapPinIcon, SparklesIcon, StarIcon, UserIcon, CurrencyDollarIcon, HashtagIcon, ClipboardDocumentIcon, PaperAirplaneIcon, CpuChipIcon, MagnifyingGlassCircleIcon, BriefcaseIcon,
} from "@heroicons/react/24/outline";
import { BookmarkIcon as BookmarkSolid, StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { fmtDateTime, fmtInbox, fmtShort, DAY } from "../lib/format";
import { copyToClipboard } from "../lib/tauri";
import { Logo } from "../components/Logo";
import { SearchField, Toggle } from "../components/ui";
import { isOpen, locationText, payText } from "../lib/gate";
import type { Route } from "../lib/ui";
import type { GateOpportunity, InboxKind, InboxMessage, Job } from "../lib/types";
import "./inbox/inbox.css";

const KINDS: { id: "all" | InboxKind; label: string; Icon: typeof SparklesIcon }[] = [
  { id: "all", label: "All", Icon: AdjustmentsHorizontalIcon },
  { id: "research", label: "Research", Icon: SparklesIcon },
  { id: "applications", label: "Applications", Icon: DocumentIcon },
  { id: "followups", label: "Follow-ups", Icon: MagnifyingGlassCircleIcon },
  { id: "interviews", label: "Interviews", Icon: CalendarDaysIcon },
  { id: "insights", label: "Insights", Icon: ChartBarIcon },
  { id: "alerts", label: "Alerts", Icon: BellAlertIcon },
];
const ICONS = { sparkle: SparklesIcon, mail: EnvelopeIcon, calendar: CalendarDaysIcon, doc: DocumentIcon, bulb: LightBulbIcon, chart: ChartBarIcon, alert: ExclamationTriangleIcon };
const ACT_ICONS: Record<string, typeof SparklesIcon> = { spark: SparklesIcon, doc: DocumentTextIcon, calendar: CalendarDaysIcon, key: BriefcaseIcon };

const Tile = ({ icon, lg }: { icon: InboxMessage["icon"]; lg?: boolean }) => {
  const I = ICONS[icon] ?? SparklesIcon;
  return <span className={`ibx-tile ${icon} ${lg ? "lg" : ""}`}><I /></span>;
};

export default function AgentInbox() {
  const { data, act } = useData();
  const ui = useUI();
  const { navigate, search, toast, openJob } = ui;
  const [kind, setKind] = useState<"all" | InboxKind>("all");
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [selId, setSelId] = useState<string | undefined>();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<"apply" | "dismiss" | null>(null);

  const list = useMemo(() => {
    const terms = [q, search].map((s) => s.trim().toLowerCase()).filter(Boolean);
    return data.inbox
      .filter((m) => (kind === "all" || m.kind === kind) && (!unreadOnly || !m.read) && (!starredOnly || m.starred))
      .filter((m) => terms.every((t) => `${m.title} ${m.preview} ${m.body}`.toLowerCase().includes(t)))
      .sort((a, b) => b.at - a.at);
  }, [data.inbox, kind, q, search, unreadOnly, starredOnly]);

  const msg = list.find((m) => m.id === selId) ?? list[0];
  const msgId = msg?.id;
  useEffect(() => { setSelecting(false); setPicked([]); setConfirm(null); setMore(false); }, [msgId]);

  const jobs = useMemo(() => (msg?.matches ?? []).map((id) => data.jobs.find((j) => j.id === id)).filter((j): j is Job => !!j), [msg, data.jobs]);
  const gates = useMemo(() => (msg?.gateMatches ?? []).map((id) => data.gate.find((g) => g.id === id)).filter((g): g is GateOpportunity => !!g), [msg, data.gate]);
  const openGateCount = data.gate.filter(isOpen).length;
  const prefs = data.settings.prefs;
  const active = data.settings.agent.active;
  const unreadCount = data.inbox.filter((m) => !m.read).length;

  const select = (m: InboxMessage) => { setSelId(m.id); if (!m.read) act.markInbox(m.id, true); };

  const draftFollowUp = () => {
    const pool = data.jobs.filter((j) => j.status === "applied" || j.status === "interviewing").sort((a, b) => (b.dueAt ?? 0) - (a.dueAt ?? 0));
    const hay = `${msg?.title ?? ""} ${msg?.preview ?? ""}`.toLowerCase();
    const job = pool.find((j) => hay.includes(j.company.toLowerCase())) ?? pool[0];
    if (!job) return toast("Apply to or interview for a job first, then I can draft a follow-up.", "warn");
    const name = data.settings.profile.name || "Your name";
    act.addInbox({
      kind: "followups", icon: "mail", title: `Follow-up draft: ${job.company}`,
      preview: `Template draft for ${job.role} at ${job.company}. Review and personalize before sending.`,
      body: `Subject: Following up on ${job.role}\n\nHi ${job.company} team,\n\nThank you again for the opportunity to be considered for the ${job.role} role. I remain very interested in the position and would love to hear about next steps.\n\nPlease let me know if I can provide anything else.\n\nBest regards,\n${name}\n\n(Template generated locally. Edit before sending; nothing is sent automatically.)`,
    });
    toast(`Draft template created for ${job.company}`);
    setKind("all"); setSelId(undefined);
  };
  const summarize = () => {
    const since = Date.now() - 7 * DAY;
    const added = data.jobs.filter((j) => j.addedAt >= since).length;
    const applied = data.jobs.filter((j) => j.status === "applied").length;
    const interviews = data.events.filter((e) => e.kind === "interview" && e.start >= since && e.start <= Date.now() + 7 * DAY).length;
    const pending = openGateCount;
    const openTasks = data.tasks.filter((t) => !t.done).length;
    act.addInbox({
      kind: "insights", icon: "sparkle", title: "Weekly Summary",
      preview: `${added} jobs added, ${applied} applied, ${interviews} interviews, ${pending} awaiting review.`,
      body: `Last 7 days, computed from your tracker:\n\n• ${added} jobs added\n• ${applied} jobs currently in Applied\n• ${interviews} interviews this week\n• ${pending} matches waiting for your review\n• ${openTasks} open tasks`,
    });
    toast("Weekly Summary added"); setKind("all"); setSelId(undefined);
  };
  const quick: { label: string; Icon: typeof SparklesIcon; run: () => void }[] = [
    { label: "Find more job matches", Icon: MagnifyingGlassIcon, run: () => navigate("gate") },
    { label: "Tailor my resume for a job", Icon: DocumentTextIcon, run: () => navigate("documents") },
    { label: "Draft a follow-up email", Icon: EnvelopeIcon, run: draftFollowUp },
    { label: "Research this company", Icon: BuildingOffice2Icon, run: () => navigate("companies") },
    { label: "Prepare for an interview", Icon: CalendarDaysIcon, run: () => navigate("calendar") },
    { label: "Summarize recent activity", Icon: ClipboardDocumentIcon, run: summarize },
  ];

  const dismissable = gates.filter(isOpen);
  const confirmApply = () => {
    const chosen = gates.filter((g) => picked.includes(g.id) && isOpen(g));
    chosen.forEach((g) => act.approveGate(g.id));
    act.addInbox({ kind: "applications", icon: "doc", title: `Approved ${chosen.length} to pipeline`, preview: chosen.map((g) => g.envelope.company.name).join(", "), body: `Added to Saved: ${chosen.map((g) => `${g.envelope.opportunity.title} (${g.envelope.company.name})`).join("; ")}.\n\nI only add roles to your pipeline. You review and submit each application yourself.` });
    toast(`${chosen.length} role${chosen.length === 1 ? "" : "s"} approved to Saved`);
    setSelecting(false); setPicked([]); setConfirm(null);
  };
  const confirmDismiss = () => {
    dismissable.forEach((g) => act.setGateStatus(g.id, "dismissed"));
    toast(`Dismissed ${dismissable.length} match${dismissable.length === 1 ? "" : "es"}`);
    setConfirm(null);
  };

  // email draft parsing for follow-ups
  const draft = msg?.kind === "followups" ? (() => {
    const m = /^Subject:\s*(.*)\n+([\s\S]*)$/.exec(msg.body);
    return m ? { subject: m[1], text: m[2].trim() } : { subject: "", text: msg.body };
  })() : null;

  return (
    <div className="page ibx">
      <div className="ibx-head">
        <div className="ibx-title">
          <h1>Agent Inbox</h1>
          <p>Your AI job search agent's updates, research, and actions in one place.</p>
        </div>
        <div className="ibx-chips" role="tablist" aria-label="Filter messages">
          {KINDS.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={kind === id} className={`ibx-chip ${kind === id ? "on" : ""}`} onClick={() => setKind(id)}><Icon />{label}</button>
          ))}
        </div>
        <div className="ibx-head-actions">
          <button className="btn" onClick={() => { act.markAllInbox(); toast("All messages marked read"); }} disabled={!unreadCount}>Mark all read</button>
          <button className="icon-btn" style={{ width: 38, height: 38 }} aria-label="Agent settings" onClick={() => navigate("settings", { section: "AI Agent" })}><Cog6ToothIcon /></button>
        </div>
      </div>

      <div className="ibx-grid">
        <section className="ibx-col ibx-list" aria-label="Messages">
          <div className="ibx-list-tools">
            <SearchField value={q} onChange={setQ} placeholder="Search messages..." />
            <button className="icon-btn" aria-label="Filter messages" aria-expanded={menu} onClick={() => setMenu((v) => !v)} style={{ width: 40, height: 40 }}><FunnelIcon /></button>
            {menu && (
              <div className="ibx-menu" role="menu">
                <button role="menuitemcheckbox" aria-checked={unreadOnly} onClick={() => setUnreadOnly((v) => !v)}>Unread only{unreadOnly && <CheckIcon className="ck" />}</button>
                <button role="menuitemcheckbox" aria-checked={starredOnly} onClick={() => setStarredOnly((v) => !v)}><StarIcon />Starred only{starredOnly && <CheckIcon className="ck" />}</button>
              </div>
            )}
          </div>
          <div className="ibx-rows">
            {list.length === 0 && <div className="empty"><b>No messages</b><p>Nothing matches the current filters.</p></div>}
            {list.map((m) => (
              <button key={m.id} className={`ibx-row ${m.read ? "" : "unread"} ${m.id === msgId ? "sel" : ""}`} onClick={() => select(m)}>
                <Tile icon={m.icon} />
                <span className="ibx-row-body">
                  <span className="ibx-row-top"><b>{m.starred && <StarSolid className="ibx-star-mini" />}{m.title}</b><span>{fmtInbox(m.at)}</span></span>
                  <p>{m.preview}</p>
                  {!m.read && <i className="ibx-dot" aria-label="Unread" />}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="ibx-col ibx-read" aria-label="Message">
          {!msg ? <div className="empty"><b>No message selected</b></div> : (
            <>
              <div className="ibx-read-head">
                <Tile icon={msg.icon} lg />
                <div><h2>{msg.title}</h2><small>{fmtDateTime(msg.at)}</small></div>
                <div className="ibx-read-actions">
                  <button className="icon-btn" aria-label="More actions" aria-expanded={more} onClick={() => setMore((v) => !v)}><EllipsisHorizontalIcon /></button>
                  {more && (
                    <div className="ibx-menu" style={{ top: 42, right: 0 }} role="menu">
                      <button onClick={() => { act.markInbox(msg.id, msg.read ? false : true); setMore(false); }}>{msg.read ? "Mark as unread" : "Mark as read"}</button>
                      <button onClick={() => { act.starInbox(msg.id); setMore(false); }}>{msg.starred ? "Remove star" : "Star message"}</button>
                      <button onClick={() => { void copyToClipboard(`${msg.title}\n\n${msg.body}`); toast("Message copied"); setMore(false); }}>Copy text</button>
                    </div>
                  )}
                  <button className={`icon-btn ${msg.starred ? "on" : ""}`} aria-label={msg.starred ? "Unstar" : "Star"} aria-pressed={msg.starred} onClick={() => act.starInbox(msg.id)}><StarIcon /></button>
                  <button className="btn" onClick={() => act.markInbox(msg.id, !msg.read)}>{msg.read ? "Mark as Unread" : "Mark as Read"}</button>
                </div>
              </div>

              <p className="ibx-hi">Hi there! 👋</p>
              {draft ? (
                <div className="ibx-draft">
                  <header>Email draft (template)<button className="btn sm" onClick={() => { void copyToClipboard(`${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.text}`); toast("Draft copied"); }}><ClipboardDocumentIcon />Copy draft</button></header>
                  {draft.subject && <div className="subj"><span>Subject: </span><b>{draft.subject}</b></div>}
                  <pre>{draft.text}</pre>
                </div>
              ) : <p className="ibx-text">{msg.body}</p>}
              {msg.cta && <div style={{ marginTop: 14 }}><button className="btn primary" onClick={() => navigate(msg.cta!.route as Route)}>{msg.cta.label}<ArrowRightIcon /></button></div>}

              {(jobs.length > 0 || gates.length > 0) && (
                <>
                  <div className="ibx-sec-head"><h3>Top Matches</h3><button className="btn sm" style={{ color: "var(--blue)", borderColor: "var(--blue-line)" }} onClick={() => navigate(gates.length ? "gate" : "opportunities")}>View All<ArrowRightIcon /></button></div>
                  <div className="ibx-match-list">
                    {gates.map((g) => {
                      const e = g.envelope;
                      const approved = g.gateStatus === "approved";
                      const gone = g.gateStatus === "dismissed";
                      const open = isOpen(g);
                      return (
                        <div key={g.id} className={`ibx-match ${selecting ? "has-check" : ""} ${picked.includes(g.id) ? "picked" : ""} ${gone ? "gone" : ""}`}>
                          {selecting && <input type="checkbox" aria-label={`Select ${e.opportunity.title} at ${e.company.name}`} checked={picked.includes(g.id)} disabled={!open} onChange={() => setPicked((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : [...p, g.id]))} />}
                          <Logo name={e.company.name} size={52} />
                          <div style={{ minWidth: 0 }}>
                            <h4>{e.opportunity.title}</h4><span className="co">{e.company.name}</span>
                            <small>{locationText(e)} &nbsp;•&nbsp; {{ remote: "Remote", hybrid: "Hybrid", onsite: "Onsite", unknown: "Onsite" }[e.opportunity.work_arrangement]}</small>
                          </div>
                          <div className="ibx-pay"><span>{payText(e)}</span><span className="ibx-score">{Math.round(e.match.score)}% match</span></div>
                          <div className="ibx-match-btns">
                            <button className="btn primary" onClick={() => navigate("gate", { item: g.id })}>View Details</button>
                            {gone ? <button className="btn" onClick={() => act.setGateStatus(g.id, "discovered")}>Undo</button>
                              : approved ? <button className="btn saved" disabled style={{ opacity: 1 }}><BookmarkSolid />Approved ✓</button>
                              : <button className="btn" onClick={() => { act.approveGate(g.id); toast(`Approved ${e.opportunity.title} at ${e.company.name}`); }}><BookmarkIcon />Approve</button>}
                          </div>
                        </div>
                      );
                    })}
                    {jobs.map((j) => {
                      const saved = j.status !== "pending_review" && j.status !== "dismissed";
                      const gone = j.status === "dismissed";
                      return (
                        <div key={j.id} className={`ibx-match ${selecting ? "has-check" : ""} ${picked.includes(j.id) ? "picked" : ""} ${gone ? "gone" : ""}`}>
                          {selecting && <input type="checkbox" aria-label={`Select ${j.role} at ${j.company}`} checked={picked.includes(j.id)} disabled={gone} onChange={() => setPicked((p) => (p.includes(j.id) ? p.filter((x) => x !== j.id) : [...p, j.id]))} />}
                          <Logo name={j.company} size={52} />
                          <div style={{ minWidth: 0 }}>
                            <h4>{j.role}</h4><span className="co">{j.company}</span>
                            <small>{j.location} &nbsp;•&nbsp; {j.workMode}</small>
                          </div>
                          <div className="ibx-pay"><span>{j.pay}</span><span className="ibx-score">{j.score}% match</span></div>
                          <div className="ibx-match-btns">
                            <button className="btn primary" onClick={() => openJob(j.id)}>View Details</button>
                            {gone ? <button className="btn" onClick={() => act.moveJob(j.id, "pending_review")}>Undo</button>
                              : saved ? <button className="btn saved" disabled style={{ opacity: 1 }}><BookmarkSolid />{j.status === "saved" ? "Saved" : j.status === "preparing" ? "Preparing" : "Saved"}</button>
                              : <button className="btn" onClick={() => { act.moveJob(j.id, "saved"); toast(`Saved ${j.role} at ${j.company}`); }}><BookmarkIcon />Save</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="ibx-ask">
                    {confirm === "apply" ? (
                      <>
                        <div><b>Approve {picked.length} role{picked.length === 1 ? "" : "s"} to your pipeline?</b><span>This only adds them to Saved. I never submit applications for you.</span></div>
                        <div className="row"><button className="btn primary" onClick={confirmApply}>Approve to Saved</button><button className="btn" onClick={() => setConfirm(null)}>Back</button></div>
                      </>
                    ) : confirm === "dismiss" ? (
                      <>
                        <div><b>Dismiss {dismissable.length} unsaved match{dismissable.length === 1 ? "" : "es"}?</b><span>Saved and in-progress jobs are kept. You can undo each from this list.</span></div>
                        <div className="row"><button className="btn danger" onClick={confirmDismiss}>Dismiss</button><button className="btn" onClick={() => setConfirm(null)}>Cancel</button></div>
                      </>
                    ) : selecting ? (
                      <>
                        <div><b>{picked.length} selected</b><span>Choose roles to approve. Nothing is submitted automatically.</span></div>
                        <div className="row"><button className="btn primary" disabled={!picked.length} onClick={() => setConfirm("apply")}>Approve selected to pipeline</button><button className="btn" onClick={() => { setSelecting(false); setPicked([]); }}>Cancel</button></div>
                      </>
                    ) : (
                      <>
                        <div><b>Would you like to add any of these roles to your pipeline?</b><span>Approved roles go to Saved. You always submit applications yourself.</span></div>
                        <div className="row"><button className="btn primary" onClick={() => setSelecting(true)}>Select and Approve</button><button className="btn" onClick={() => (dismissable.length ? setConfirm("dismiss") : toast("Nothing to dismiss: these roles are already approved or handled"))}>Dismiss</button></div>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <aside className="ibx-col ibx-side" aria-label="Agent panel">
          <div className="ibx-card ibx-agent">
            <span className="ibx-tile"><CpuChipIcon /></span>
            <div className="ibx-agent-top">
              <div><b>Agent Details</b><span className={`ibx-active ${active ? "" : "paused"}`}>{active ? "Active" : "Paused"}</span></div>
              <Toggle on={active} label="Agent active" onChange={(v) => { act.updateSettings("agent", { active: v }); toast(v ? "Agent resumed" : "Agent paused"); }} />
            </div>
            <p>Your AI agent continuously researches jobs, tracks applications, and helps you stay on top of your job search.</p>
          </div>
          <div className="ibx-card">
            <h3>Quick Actions</h3>
            <div className="ibx-qa">{quick.map(({ label, Icon, run }) => <button key={label} onClick={run}><i><Icon /></i>{label}</button>)}</div>
          </div>
          <div className="ibx-card">
            <div className="ibx-card-head"><h3>Related Filters</h3><button className="link" onClick={() => navigate("settings", { section: "Job Search Preferences" })}>Edit Preferences</button></div>
            <div className="ibx-rf">
              {([[UserIcon, "Roles", prefs.roles], [MapPinIcon, "Locations", prefs.locations], [CurrencyDollarIcon, "Salary Range", prefs.salary], [BuildingOffice2Icon, "Companies", prefs.companies], [HashtagIcon, "Keywords", prefs.keywords], [PaperAirplaneIcon, "Experience Level", prefs.level]] as const).map(([I, l, v]) => (
                <div key={l}><I /><span>{l}</span><em>{v || "Not set"}</em></div>
              ))}
            </div>
          </div>
          <div className="ibx-card">
            <div className="ibx-card-head"><h3>Recent Activity</h3><button className="link" onClick={() => navigate("notifications")}>View All</button></div>
            <div className="ibx-act">
              {data.activity.slice(0, 5).map((a) => { const I = ACT_ICONS[a.icon] ?? SparklesIcon; return <div key={a.id}><I /><span title={a.subtitle}>{a.title}{a.subtitle ? ` (${a.subtitle.split(" · ")[0]})` : ""}</span><em>{fmtInbox(a.at) === "Yesterday" ? "Yesterday" : fmtInbox(a.at).includes(":") ? fmtInbox(a.at) : fmtShort(a.at)}</em></div>; })}
              {data.activity.length === 0 && <span className="muted">No activity yet.</span>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
