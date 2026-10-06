// Email sync engine: dedupe + classify + match + confidence-gated transitions + notifications.
// Microsoft retrieval is server-owned; this module only applies queued email metadata to local workspace state.
import type { AppData, AppNotification, AssessmentKind, CalEvent, Job, Status, Task } from "./types";
import { classifyEmail, type EmailLabel } from "./emailClassifier";
import { matchEmailToJobOrGate, isAmbiguousMatch } from "./emailMatcher";
import { isOpen, approve as approveGate } from "./gate";
import type { GateStatus } from "@job-hunt-os/contracts";
import { DAY, uid } from "./format";
export type EmailMessage = { id: string; internetMessageId?: string; conversationId?: string; subject: string; from?: { emailAddress: { address: string; name: string } }; sender?: { emailAddress: { address: string; name: string } }; receivedDateTime: string; bodyPreview?: string; body?: { contentType: string; content: string }; headers?: { name: string; value: string }[] };

export type EmailSyncResult = {
  processed: number;
  moved: { jobId: string; from: Status | null; to: Status; label: EmailLabel }[];
  needsConfirm: number;
  calendarCreated: number;
  errors: string[];
};

const AUTO_THRESHOLD = 0.85;
const CONFIRM_THRESHOLD = 0.6;
const MAX_PROCESSED = 2000;

function headersMap(m: EmailMessage): Record<string, string> {
  const h: Record<string, string> = {};
  for (const kv of m.headers ?? []) h[kv.name.toLowerCase()] = kv.value;
  return h;
}

function bodyText(m: EmailMessage): string {
  const raw = m.body?.content ?? m.bodyPreview ?? "";
  // Strip HTML tags if needed
  if (/<[^>]+>/.test(raw)) {
    try { const div = document.createElement("div"); div.innerHTML = raw; return (div.textContent ?? div.innerText ?? raw).slice(0, 80_000); } catch { return raw.replace(/<[^>]*>/g, " ").slice(0, 80_000); }
  }
  return raw.slice(0, 80_000);
}

function senderOf(m: EmailMessage): string {
  return m.from?.emailAddress?.address ?? m.sender?.emailAddress?.address ?? "";
}

function labelToStatus(label: EmailLabel, assessmentKind?: AssessmentKind): Status | null {
  switch (label) {
    case "application_confirmed": return "applied";
    case "assessment_invite": return "assessment";
    case "interview_invite": return "interviewing";
    case "rejection": return "rejected";
    case "offer": return "offer";
    default: return null;
  }
}

function isAllowedTransition(from: Status, to: Status): boolean {
  // Allow forward progress; allow offer from any stage; never auto-downgrade applied→saved
  const order: Record<Status, number> = { pending_review: 0, saved: 1, preparing: 2, applied: 3, assessment: 4, interviewing: 5, offer: 6, rejected: 7, dismissed: 8 };
  if (to === "offer") return true;
  if (to === "rejected") return true; // rejection can come at any point
  if (from === "dismissed" || from === "rejected") return false;
  return (order[to] ?? 99) >= (order[from] ?? 0);
}

function stageName(s: Status): string {
  const m: Record<Status, string> = { pending_review: "Pending review", saved: "Saved", preparing: "Preparing", applied: "Applied", assessment: "Assessment", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", dismissed: "Dismissed" };
  return m[s] ?? s;
}

function inferEventTime(m: EmailMessage, schedule?: { start?: number; end?: number; raw?: string; link?: string; location?: string }): { start: number; end: number } | null {
  if (schedule?.start) return { start: schedule.start, end: schedule.end ?? schedule.start + 60 * 60000 };
  // Try to parse body for ICS-like DTSTART
  const body = bodyText(m);
  const dt = body.match(/DTSTART[^:]*:(\d{8}T\d{6}Z?)/);
  if (dt) {
    const raw = dt[1];
    // 20261007T140000Z -> ISO
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}${raw.endsWith("Z") ? "Z" : ""}`;
    const n = Date.parse(iso);
    if (!Number.isNaN(n)) return { start: n, end: n + 60 * 60000 };
  }
  return null;
}

export async function syncEmails(data: AppData, opts: { dryRun?: boolean; messages?: EmailMessage[]; now?: number } = {}): Promise<{ data: AppData; result: EmailSyncResult }> {
  const now = opts.now ?? Date.now();
  const profileEmail = data.settings.profile?.email ?? "";
  const outlook = data.settings.outlook;
  const processed = new Set<string>(outlook?.processedIds ?? []);
  const result: EmailSyncResult = { processed: 0, moved: [], needsConfirm: 0, calendarCreated: 0, errors: [] };

  const messages = opts.messages ?? [];

  // The server queue is authoritative: a message may have arrived long before this device next opens,
  // so never discard it based on this device's last-sync timestamp.
  const inboxMessages = messages
    .sort((a, b) => Date.parse(a.receivedDateTime) - Date.parse(b.receivedDateTime));

  let jobs = [...data.jobs];
  let gate = [...data.gate];
  let events: CalEvent[] = [...data.events];
  let tasks: Task[] = [...data.tasks];
  let notifications = [...data.notifications];
  let inbox = [...data.inbox];
  let activity = [...data.activity];
  const newProcessed: string[] = [];

  for (const m of inboxMessages) {
    const msgId = m.internetMessageId ?? m.id;
    if (!msgId || processed.has(msgId)) continue;
    // Basic dedupe: if we already processed ConversationId+subject very recently, skip duplicate confirmations
    const key = `${m.conversationId}:${m.subject}`;
    // allow re-processing different messageIds even if same conversation (interview vs rejection distinct)
    void key;

    const from = senderOf(m);
    const subj = m.subject ?? "";
    const body = bodyText(m);
    const cls = classifyEmail({ subject: subj, bodyPreview: m.bodyPreview, body, from, headers: headersMap(m) });
    const targetStatus = labelToStatus(cls.label, cls.assessmentKind);
    const isCalendarOnly = cls.label === "reschedule" || cls.label === "cancellation" || cls.label === "deadline_reminder" || cls.label === "followup";
    const schedule = cls.schedule;

    // Always require a match to an existing Job/Gate for auto-move (never create new Job from email)
    const emailInfo = { subject: subj, body, from, bodyPreview: m.bodyPreview };
    const matched = matchEmailToJobOrGate({ ...data, gate, jobs } as AppData, emailInfo);
    const ambiguous = matched ? isAmbiguousMatch({ ...data, gate, jobs } as AppData, emailInfo, matched) : false;

    // Strong auto-move requires BOTH high classification confidence and high match confidence (unambiguous)
    const shouldAuto = !!targetStatus && 
      cls.confidence >= AUTO_THRESHOLD && 
      !!matched && 
      matched.score >= 0.85 && 
      !ambiguous;

    const needsConfirm = !!matched && 
      !shouldAuto && 
      (cls.confidence >= CONFIRM_THRESHOLD && matched.score >= 0.60);

    // Newsletter / unrelated -> skip with no side effects (but mark processed to avoid re-scanning)
    if (cls.label === "newsletter" || cls.label === "unrelated") {
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    // Calendar handling for assessment/interview or schedule events (even if status not auto-moved)
    const ensureCalendar = (jobId?: string, company?: string) => {
      const inferred = inferEventTime(m, schedule);
      const start = inferred?.start ?? schedule?.start;
      const end = inferred?.end ?? schedule?.end ?? (start ? start + (cls.label === "assessment_invite" ? 90 * 60000 : 60 * 60000) : undefined);
      if (!start || !end || Number.isNaN(start) || Number.isNaN(end)) return null;
      // Overlap check: flag prep
      const overlaps = events.some((ev) => !(end <= ev.start || start >= ev.end));
      const prep = overlaps ? [{ id: uid(), text: "Confirm time — overlaps with another event", done: false }] : [];
      const title = cls.label === "assessment_invite" ? `Assessment — ${company ?? "Opportunity"}` : cls.label === "interview_invite" ? `Interview — ${company ?? "Opportunity"}` : `Follow-up — ${company ?? subj}`;
      const kind: CalEvent["kind"] = cls.label === "assessment_invite" ? "assessment" : cls.label === "interview_invite" ? "interview" : "followup";
      const format: CalEvent["format"] = schedule?.link?.includes("zoom") || body.toLowerCase().includes("zoom") ? "Video Call" : schedule?.link?.includes("teams") ? "Video Call" : "None";
      const ev: CalEvent = {
        id: uid(), title, company, kind, start, end, format, link: schedule?.link, location: schedule?.location, description: `Source: Outlook email "${subj}" from ${from}`, notes: schedule?.raw ? `Extracted: ${schedule.raw}` : "", jobId, attendees: from ? [{ name: from, role: "" }] : [], prep,
      };
      events.push(ev);
      result.calendarCreated++;
      // Also create a task if it's an assessment due soon
      if (kind === "assessment") {
        tasks.unshift({ id: uid(), title: `Complete ${title}`, company, subtitle: schedule?.raw ?? `Due ${new Date(start).toLocaleDateString()}`, dueAt: start, priority: "High", icon: "calendar", done: false, jobId });
      }
      return ev;
    };

    const provenance = `Detected in your Outlook (${profileEmail || from}): "${subj}" from ${from} on ${new Date(m.receivedDateTime).toLocaleDateString()}`;
    const addNotification = (n: { title: string; body: string; chip: string; kind: AppNotification["kind"]; jobId?: string; eventId?: string }) => {
      notifications.unshift({ id: uid(), kind: n.kind, title: n.title, body: n.body, at: now, read: false, chip: n.chip, jobId: n.jobId, eventId: n.eventId });
    };

    // If calendar-only label, just create event + notification (no Kanban move)
    if (isCalendarOnly) {
      const jobId = matched?.kind === "job" ? matched.id : undefined;
      const company = jobId ? jobs.find((j) => j.id === jobId)?.company : matched?.kind === "gate" ? gate.find((g) => g.id === matched.id)?.envelope.company.name : undefined;
      const ev = ensureCalendar(jobId, company);
      addNotification({
        title: cls.label === "reschedule" ? "Interview rescheduled" : cls.label === "cancellation" ? "Interview cancelled" : cls.label === "deadline_reminder" ? "Assessment deadline reminder" : "Follow-up received",
        body: `${provenance}. ${ev ? `Added calendar: ${ev.title} on ${new Date(ev.start).toLocaleString()}.` : "No date could be parsed — open the email to confirm."}`,
        chip: "Calendar",
        kind: cls.label === "deadline_reminder" ? "deadline" : "interview",
        jobId, eventId: ev?.id,
      });
      activity.unshift({ id: uid(), at: now, icon: "calendar", title: "Calendar updated from email", subtitle: `${company ?? from} · ${subj.slice(0, 48)}` });
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    // No target status (e.g. followup already handled) -> just mark processed
    if (!targetStatus) {
      if (matched && needsConfirm) {
        // Low-confirmation application update without strong signal -> surface for review
        result.needsConfirm++;
        const jc = matched?.kind === "job" ? jobs.find((j) => j.id === matched.id) : undefined;
        const gc = matched?.kind === "gate" ? gate.find((g) => g.id === matched.id) : undefined;
        const company = jc?.company ?? gc?.envelope.company.name ?? from;
        addNotification({
          title: "Possible update — confirm",
          body: `${provenance} matched ${company} but confidence was ${(cls.confidence * 100).toFixed(0)}% (${cls.label}). Review and move manually if needed.`,
          chip: "Review",
          kind: "email_sync",
          jobId: jc?.id,
        });
      }
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    // Needs manual confirm (medium confidence) -> notification with CTA, no auto move
    if (!shouldAuto && matched) {
      if (needsConfirm) {
        result.needsConfirm++;
        const jc = matched.kind === "job" ? jobs.find((j) => j.id === matched.id) : undefined;
        const gc = matched.kind === "gate" ? gate.find((g) => g.id === matched.id) : undefined;
        const company = jc?.company ?? gc?.envelope.company.name ?? from;
        // Even without auto-move: create calendar if date found in assessment/interview email
        let ev: CalEvent | null = null;
        if ((cls.label === "assessment_invite" || cls.label === "interview_invite") && (schedule?.start || schedule?.link)) {
          ev = ensureCalendar(jc?.id, company);
        }
        // Always create a task for assessment deadlines found in email
        if (cls.label === "assessment_invite" && schedule?.start) {
          tasks.unshift({ id: uid(), title: `Complete assessment — ${company}`, subtitle: schedule.raw ?? `Due ${new Date(schedule.start).toLocaleDateString()}`, dueAt: schedule.start, priority: "High", icon: "calendar", done: false, jobId: jc?.id });
        }
        // Deadline reminders always create a task regardless of match confidence
        if (cls.label === "deadline_reminder" && schedule?.start) {
          tasks.unshift({ id: uid(), title: `Deadline: ${subj.slice(0, 60)}`, subtitle: `From ${from}`, dueAt: schedule.start, priority: "High", icon: "calendar", done: false, jobId: jc?.id });
        }
        addNotification({
          title: `Possible ${targetStatus === "assessment" ? "assessment" : targetStatus} — confirm`,
          body: `${provenance} suggests moving ${company} to ${stageName(targetStatus)} (confidence ${(cls.confidence * 100).toFixed(0)}%).${ev ? ` Calendar added: ${ev.title} on ${new Date(ev.start).toLocaleString()}.` : ""} Open the job to confirm the stage change.`,
          chip: "Review",
          kind: cls.label === "assessment_invite" ? "assessment" : "email_sync",
          jobId: jc?.id,
          eventId: ev?.id,
        });
        newProcessed.push(msgId);
        result.processed++;
        continue;
      }
      // low confidence -> skip auto
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    // No match at all -> unmatched notification
    if (!matched) {
      addNotification({
        title: "Unmatched email — review",
        body: `${provenance} could not be matched to any opportunity or pipeline job. If this is an application update, link it manually.`,
        chip: "Review",
        kind: "email_sync",
      });
      tasks.unshift({ id: uid(), title: `Review unmatched email: ${subj.slice(0, 56)}`, subtitle: `From ${from}`, dueAt: now + DAY, priority: "Medium", icon: "mail", done: false });
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    // Auto-move path
    const fromStatus: Status | null = matched.kind === "job" ? (jobs.find((j) => j.id === matched.id)?.status ?? null) : null;
    const gateObj = matched.kind === "gate" ? gate.find((g) => g.id === matched.id) : null;

    // If matched Gate is still discovered/reviewing and email says applied/assessment/interview/offer/rejected,
    // auto-approve first (creates Job in saved), then move that Job to target.
    let jobId = matched.kind === "job" ? matched.id : gateObj?.linkedJobId ?? null;
    let job = jobId ? jobs.find((j) => j.id === jobId) ?? null : null;

    if (matched.kind === "gate" && gateObj && !job) {
      if (isOpen(gateObj) && targetStatus) {
        const res = approveGate({ gate, jobs, companies: data.companies, contacts: data.contacts, documents: data.documents, folders: data.folders, credentials: data.credentials, events, tasks, notifications, inbox, activity, settings: data.settings } as AppData, gateObj.id, now);
        gate = res.data.gate;
        jobs = res.data.jobs;
        events = res.data.events;
        // refresh references after approve
        const updatedGate = gate.find((g) => g.id === gateObj.id);
        jobId = updatedGate?.linkedJobId ?? res.job?.id ?? null;
        job = jobId ? jobs.find((j) => j.id === jobId) ?? null : null;
        // If target was applied and we just approved to saved, we'll move to applied next
      } else {
        // Gate exists but no linked job and not open -> can't auto
        addNotification({ title: "Could not auto-advance — no pipeline job", body: `${provenance} matched Gate ${gateObj.envelope.company.name} but there is no linked job to move. Approve it to pipeline first.`, chip: "Review", kind: "email_sync" });
        newProcessed.push(msgId);
        result.processed++;
        continue;
      }
    }

    if (!job || !jobId) {
      addNotification({ title: "Could not auto-advance — missing job", body: `${provenance} matched but no job could be resolved.`, chip: "Review", kind: "email_sync" });
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    if (!isAllowedTransition(job.status, targetStatus)) {
      // e.g. trying to go applied -> saved (downgrade) — record but don't move
      addNotification({ title: "Email ignored — would downgrade stage", body: `${provenance} would move ${job.company} from ${stageName(job.status)} to ${stageName(targetStatus)}, which is not allowed automatically. Review manually if needed.`, chip: "Review", kind: "email_sync", jobId });
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }
    if (job.status === targetStatus) {
      // Already in target — just ensure provenance notification + calendar if assessment/interview
      if (targetStatus === "assessment" || targetStatus === "interviewing") {
        const ev = ensureCalendar(jobId, job.company);
        if (ev) addNotification({ title: `Confirmed ${stageName(targetStatus)} — calendar added`, body: `${provenance} already in ${stageName(targetStatus)}; added ${ev.title}.`, chip: "Calendar", kind: cls.label === "assessment_invite" ? "assessment" : "interview", jobId, eventId: ev.id });
      } else {
        addNotification({ title: `Already in ${stageName(targetStatus)}`, body: `${provenance} — no stage change needed.`, chip: "Info", kind: "email_sync", jobId });
      }
      job.notes = job.notes ? `${job.notes}\nAuto-confirmed in ${stageName(targetStatus)} via email ${new Date(m.receivedDateTime).toLocaleDateString()} — "${subj}"` : `Auto-confirmed in ${stageName(targetStatus)} via email ${new Date(m.receivedDateTime).toLocaleDateString()} — "${subj}"`;
      job.lastEmailId = msgId;
      jobs = jobs.map((j) => (j.id === jobId ? job! : j));
      newProcessed.push(msgId);
      result.processed++;
      continue;
    }

    // Perform the move
    const prev = job.status;
    const nextJob: Job = {
      ...job,
      status: targetStatus,
      assessmentKind: targetStatus === "assessment" ? (cls.assessmentKind ?? job.assessmentKind ?? "other") : job.assessmentKind,
      dueAt: targetStatus === "applied" || targetStatus === "assessment" || targetStatus === "interviewing" || targetStatus === "offer" ? now : job.dueAt,
      dueLabel: targetStatus === "applied" ? `Applied ${new Date(now).toLocaleDateString()}` : targetStatus === "assessment" ? "Assessment" : targetStatus === "interviewing" ? "Interview" : targetStatus === "offer" ? "Offer" : targetStatus === "rejected" ? "Rejected" : job.dueLabel,
      notes: job.notes ? `${job.notes}\nAuto-moved via Outlook email ${new Date(m.receivedDateTime).toLocaleDateString()} — "${subj}"` : `Auto-moved via Outlook email ${new Date(m.receivedDateTime).toLocaleDateString()} — "${subj}"`,
      lastEmailId: msgId,
    };
    jobs = jobs.map((j) => (j.id === jobId ? nextJob : j));

    // Calendar for assessment/interview
    let ev: CalEvent | null = null;
    if (targetStatus === "assessment" || targetStatus === "interviewing") {
      ev = ensureCalendar(jobId!, job.company);
    }

    const chip = targetStatus === "assessment" ? "Assessment" : targetStatus === "applied" ? "Applied" : targetStatus === "interviewing" ? "Interview" : targetStatus === "offer" ? "Offer" : "Stage";
    const kind: AppData["notifications"][number]["kind"] = targetStatus === "assessment" ? "assessment" : targetStatus === "interviewing" ? "interview" : targetStatus === "applied" ? "followup" : targetStatus === "offer" ? "recruiter" : "email_sync";
    addNotification({
      title: `Auto-moved to ${stageName(targetStatus)} — from email`,
      body: `${provenance} matched ${job.company} · ${job.role} → moved from ${stageName(prev)} to ${stageName(targetStatus)} (${cls.label}, ${(cls.confidence * 100).toFixed(0)}% confidence)${ev ? ` and added calendar: ${ev.title}.` : "."} Open the job to review or undo.`,
      chip,
      kind,
      jobId,
      eventId: ev?.id,
    });
    // Add inbox message for audit trail (optional)
    inbox.unshift({ id: uid(), kind: "applications", icon: "mail", title: `Email moved ${job.company} to ${stageName(targetStatus)}`, preview: subj.slice(0, 72), body: `${provenance}\n\nMatched: ${job.company} · ${job.role}\nAction: ${stageName(prev)} → ${stageName(targetStatus)}\nConfidence: ${(cls.confidence * 100).toFixed(0)}%`, at: now, read: false, starred: false });
    activity.unshift({ id: uid(), at: now, icon: "mail", title: `Email sync moved ${job.company}`, subtitle: `${stageName(prev)} → ${stageName(targetStatus)} via "${subj.slice(0, 40)}"` });
    if (activity.length > 60) activity = activity.slice(0, 60);
    if (inbox.length > 120) inbox = inbox.slice(0, 120);
    if (notifications.length > 140) notifications = notifications.slice(0, 140);

    result.moved.push({ jobId, from: prev, to: targetStatus, label: cls.label });
    newProcessed.push(msgId);
    result.processed++;
  }

  const allProcessed = [...processed, ...newProcessed].slice(-MAX_PROCESSED);
  const outlookState = {
    enabled: !!outlook?.enabled,
    userEmail: outlook?.userEmail ?? profileEmail,
      deltaLink: outlook?.deltaLink,
    lastSyncAt: now,
    lastSyncError: result.errors[0],
    processedIds: allProcessed,
  };

  const nextData: AppData = {
    ...data,
    gate, jobs, events, tasks, notifications, inbox, activity,
    settings: { ...data.settings, outlook: outlookState },
  };

  if (opts.dryRun) {
    // Don't persist cursor in dry-run caller; but return computed nextData for assertion
    return { data: nextData, result };
  }
  return { data: nextData, result };
}
