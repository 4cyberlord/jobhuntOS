import type { ComponentType, SVGProps } from "react";
import { BellSnoozeIcon, CalendarDaysIcon, ChartBarIcon, ClipboardDocumentListIcon, ClockIcon, DocumentTextIcon, EnvelopeOpenIcon, SparklesIcon } from "@heroicons/react/24/outline";
import type { AppNotification, NotifKind, Settings } from "../../lib/types";

export type Icon = ComponentType<SVGProps<SVGSVGElement>>;
export type Filter = "all" | "unread" | "followups" | "interviews" | "deadlines" | "agent" | "system";

export const FILTER_OF: Record<NotifKind, Exclude<Filter, "all" | "unread">> = {
  interview: "interviews", deadline: "deadlines", followup: "followups", reminder: "followups", stale: "followups",
  match: "agent", recruiter: "agent", document: "system", weekly: "system",
  assessment: "agent", email_sync: "system",
};
export const NOTIFY_KEY: Record<Exclude<Filter, "all" | "unread">, keyof Settings["notify"]> = {
  interviews: "interviews", deadlines: "deadlines", followups: "followups", agent: "agent", system: "system",
};

export const KIND: Record<NotifKind, { icon: Icon; tone: string; tag: string }> = {
  interview: { icon: CalendarDaysIcon, tone: "blue", tag: "Interview Reminder" },
  deadline: { icon: CalendarDaysIcon, tone: "red", tag: "Deadline Alert" },
  match: { icon: SparklesIcon, tone: "purple", tag: "Agent Alert" },
  recruiter: { icon: EnvelopeOpenIcon, tone: "green", tag: "Recruiter Update" },
  followup: { icon: ClockIcon, tone: "amber", tag: "Follow-up" },
  document: { icon: ClipboardDocumentListIcon, tone: "purple", tag: "Action Needed" },
  stale: { icon: BellSnoozeIcon, tone: "gray", tag: "Stale Application" },
  reminder: { icon: DocumentTextIcon, tone: "blue", tag: "Reminder" },
  weekly: { icon: ChartBarIcon, tone: "purple", tag: "Weekly Review" },
  assessment: { icon: ClipboardDocumentListIcon, tone: "amber", tag: "Assessment" },
  email_sync: { icon: EnvelopeOpenIcon, tone: "green", tag: "Email Sync" },
};

export const chipTone = (chip: string): string => {
  const c = chip.toLowerCase();
  if (c === "today" || c.includes("action")) return "red";
  if (c === "tomorrow" || c === "reminder") return "blue";
  if (c === "new" || c === "weekly") return "purple";
  if (c === "unread" || c === "replied") return "green";
  if (c.startsWith("follow")) return "amber";
  return "gray";
};

export const groupOf = (n: AppNotification, now = Date.now()) => {
  const t0 = new Date(now).setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (n.at >= t0) return "Today";
  if (n.at >= t0 - day) return "Yesterday";
  if (n.at >= t0 - 7 * day) return "This Week";
  return "Earlier";
};
export const GROUPS = ["Today", "Yesterday", "This Week", "Earlier"];
