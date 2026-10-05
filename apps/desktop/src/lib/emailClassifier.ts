// Rules-first email → pipeline intent classifier. No network, no LLM required.
// Mirrors the plan's label set and confidence gating (≥0.85 auto-move).
import type { AssessmentKind } from "./types";

export type EmailLabel =
  | "application_confirmed"
  | "assessment_invite"
  | "interview_invite"
  | "rejection"
  | "offer"
  | "reschedule"
  | "cancellation"
  | "followup"
  | "deadline_reminder"
  | "newsletter"
  | "unrelated";

export type ClassifiedEmail = {
  label: EmailLabel;
  confidence: number; // 0..1
  assessmentKind?: AssessmentKind;
  reasons: string[];
  // extracted schedule (if any) for Calendar creation
  schedule?: { start?: number; end?: number; raw?: string; link?: string; location?: string };
};

// ATS / assessment domains we trust more heavily
const ATS_SENDERS = [
  "lever.co", "greenhouse.io", "workday", "ashbyhq.com", "ashby", "myworkday.com",
  "ycombinator.com", "ripplematch", "handshake", "indeed", "linkedin",
  "hackerrank", "hackerearth", "codility", "codesignal", "coderpad", "karat",
  "hirevue", "sparkhire", "modern hire",
];

const NEWSLETTER_HEADERS = ["list-unsubscribe", "list-id", "x-mailer"];

function norm(s: string) { return (s ?? "").toLowerCase(); }

function senderDomain(from?: string) {
  const m = (from ?? "").toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1] : "";
}

function hasAny(hay: string, needles: string[]) { return needles.some((n) => hay.includes(n)); }

function extractSchedule(subject: string, body: string): ClassifiedEmail["schedule"] | undefined {
  const text = `${subject}\n${body}`;
  // Look for Zoom/Teams/Meet links
  const linkMatch = text.match(/https?:\/\/[^\s]*?(zoom\.us|teams\.microsoft\.com|meet\.google\.com|whereby\.com)[^\s]*/i);
  const link = linkMatch?.[0];
  // Very permissive date/time: Oct 7, 2026 at 2pm PT, 2026-10-07T14:00, Monday Oct 7 2:00 PM
  const datePatterns = [
    // 2026-10-07T14:00
    /(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/,
    // October 7, 2026 at 2:00 PM or Oct 7 2pm
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})?[^a-z0-9]{0,20}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    // Monday, Oct 7 at 2pm
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[^a-z0-9]{0,10}(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})[^a-z0-9]{0,20}(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  ];
  let start: number | undefined;
  let raw: string | undefined;
  for (const re of datePatterns) {
    const m = text.match(re);
    if (m) {
      raw = m[0];
      // Try to parse via Date; if fails, keep undefined
      const d = new Date(m[0]);
      if (!Number.isNaN(d.getTime())) start = d.getTime();
      // If time-only like "2pm" without date, assume upcoming week — leave undefined for caller to infer
      break;
    }
  }
  if (!link && !start && !raw) return undefined;
  const end = start ? start + 60 * 60000 : undefined;
  // Location hint: zoom / teams / location line
  const locMatch = text.match(/(?:location|where|venue):\s*([^\n]{1,80})/i);
  const location = locMatch?.[1]?.trim().slice(0, 120);
  return { start, end, raw, link, location };
}

function assessmentKindFromText(hay: string): AssessmentKind | undefined {
  if (/\b(oa|online assessment)\b/i.test(hay) || /hackerrank|codility|codesignal/i.test(hay)) return "oa";
  if (/take[\s-]?home/i.test(hay) || /project|assignment/i.test(hay) && /assessment|challenge/i.test(hay)) return "take_home";
  if (/live coding|pairing|karat|coderpad/i.test(hay)) return "live_coding";
  if (/hirevue|spark ?hire/i.test(hay)) return "hirevue";
  if (/assessment|coding challenge|technical (screen|challenge)|oa\b/i.test(hay)) return "other";
  return undefined;
}

export function classifyEmail(input: { subject: string; bodyPreview?: string; body?: string; from?: string; headers?: Record<string, string> }): ClassifiedEmail {
  const subject = input.subject ?? "";
  const body = `${input.bodyPreview ?? ""}\n${input.body ?? ""}`;
  const hay = norm(`${subject} ${body}`);
  const sender = norm(input.from ?? "");
  const domain = senderDomain(sender);
  const headersLower = Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const reasons: string[] = [];

  // Filter marketing / newsletters first
  const hasUnsub = NEWSLETTER_HEADERS.some((h) => headersLower[h]);
  const newsletterHint = hasUnsub || hasAny(hay, ["unsubscribe", "view in browser", "you are receiving this because"]);
  const atsSender = ATS_SENDERS.some((d) => domain.includes(d) || sender.includes(d));
  if (newsletterHint && !atsSender && !hasAny(hay, ["application", "interview", "assessment", "offer", "rejected"])) {
    return { label: "newsletter", confidence: 0.88, reasons: ["newsletter header or unsubscribe hint"] };
  }

  // Cancellation / reschedule before more specific labels
  if (hasAny(hay, ["cancelled", "canceled", "withdrawn", "no longer under consideration"] ) && hasAny(hay, ["interview", "assessment", "meeting", "call"])) {
    return { label: "cancellation", confidence: 0.9, reasons: ["cancellation keyword"], schedule: extractSchedule(subject, body) };
  }
  if (hasAny(hay, ["rescheduled", "re-scheduled", "new time", "moved to", "updated invitation"])) {
    const sched = extractSchedule(subject, body);
    if (sched?.start || sched?.link) return { label: "reschedule", confidence: 0.86, reasons: ["reschedule keyword"], schedule: sched };
  }

  // Offer
  if (
    (hasAny(hay, ["congratulations", "we are pleased to offer", "offer of employment", "offer letter", "we'd like to offer you"]) && hasAny(hay, ["offer", "employment", "join", "position", "role"])) ||
    /offer\s+letter/i.test(hay) && atsSender
  ) {
    reasons.push("offer phrasing");
    if (atsSender) reasons.push("ats sender");
    return { label: "offer", confidence: atsSender ? 0.92 : 0.84, reasons, schedule: extractSchedule(subject, body) };
  }

  // Rejection
  if (
    hasAny(hay, ["unfortunately", "not moving forward", "decided to move forward with other candidates", "after careful consideration", "regret to inform"]) || /\bnot\s+(?:be\s+)?moving\s+forward\b/i.test(hay) ||
    (hasAny(hay, ["thank you for your interest", "thank you for applying"]) && hasAny(hay, ["not selected", "not proceeding", "other candidates", "at this time"]))
  ) {
    // Avoid misclassifying followups that thank but invite next step
    if (!hasAny(hay, ["interview", "assessment", "next step", "invite"])) {
      return { label: "rejection", confidence: atsSender ? 0.91 : 0.82, reasons: ["rejection phrasing"], schedule: undefined };
    }
  }
  if (/we have decided.*not.*move forward/i.test(hay)) return { label: "rejection", confidence: 0.89, reasons: ["rejection pattern"] };

  // Interview invite
  if (hasAny(hay, ["interview invitation", "invitation to interview", "schedule your interview", "interview scheduled", "invite you to interview", "next step is an interview"])) {
    const sched = extractSchedule(subject, body);
    const ak = assessmentKindFromText(hay);
    if (ak === "hirevue") return { label: "interview_invite", confidence: 0.9, reasons: ["interview invite + hirevue"], schedule: sched };
    return { label: "interview_invite", confidence: atsSender ? 0.92 : 0.86, reasons: ["interview invite phrasing"], schedule: sched };
  }
  if (hasAny(hay, ["interview"]) && hasAny(hay, ["scheduled", "calendar invite", "meeting invite", "zoom", "teams link"]) && !hasAny(hay, ["assessment", "oa"])) {
    return { label: "interview_invite", confidence: 0.84, reasons: ["interview + schedule"], schedule: extractSchedule(subject, body) };
  }

  // Assessment / OA / coding challenge
  const isAssessment =
    hasAny(hay, ["online assessment", "technical assessment", "coding assessment", "coding challenge", "oa ", " oa,", "take-home", "take home", "hackerrank", "codility", "codesignal"]) ||
    (hasAny(hay, ["assessment"]) && hasAny(hay, ["invite", "complete", "due", "link", "challenge"])) ||
    (atsSender && hasAny(hay, ["assessment"]) );
  if (isAssessment) {
    const kind = assessmentKindFromText(hay) ?? "other";
    const sched = extractSchedule(subject, body);
    const conf = atsSender ? 0.91 : hasAny(hay, ["hackerrank", "codility"]) ? 0.9 : 0.84;
    return { label: "assessment_invite", confidence: conf, assessmentKind: kind, reasons: ["assessment keywords", ...(atsSender ? ["ats sender"] : [])], schedule: sched };
  }

  // Application confirmed / received
  if (
    hasAny(hay, ["application received", "thank you for applying", "your application has been received", "we received your application", "application confirmation", "successfully applied", "application submitted"]) ||
    (atsSender && hasAny(hay, ["received", "submitted"]) && hasAny(hay, ["application"]))
  ) {
    return { label: "application_confirmed", confidence: atsSender ? 0.93 : 0.86, reasons: ["application confirmation", ...(atsSender ? ["ats sender"] : []) ] };
  }

  // Deadline / reminder / followup
  if (hasAny(hay, ["deadline", "due by", "complete by", "expires on", "remaining to complete"])) {
    return { label: "deadline_reminder", confidence: 0.78, reasons: ["deadline phrasing"], schedule: extractSchedule(subject, body) };
  }
  if (hasAny(hay, ["follow up", "follow-up", "checking in", "just following up"])) {
    return { label: "followup", confidence: 0.72, reasons: ["followup phrasing"] };
  }

  return { label: "unrelated", confidence: 0.6, reasons: ["no strong signal"] };
}
