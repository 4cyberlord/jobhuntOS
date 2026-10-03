import type { Job } from "../../lib/types";
import { DAY, daysSince, fmtShort, startOfDay } from "../../lib/format";

export const fitOf = (score: number): { label: string; tone: "green" | "amber" } => (score >= 85 ? { label: "High Fit", tone: "green" } : { label: "Medium", tone: "amber" });

export const stageLabel = (j: Job) => (j.status === "interviewing" ? j.dueLabel ?? "Interview" : j.status === "saved" ? "Saved" : j.status === "preparing" ? "Preparing" : j.status === "applied" ? "Applied" : j.status === "offer" ? "Offer" : j.status);

export const relAgo = (t: number) => {
  const d = daysSince(t);
  return d <= 0 ? "Today" : `${d}d ago`;
};

/** right-hand date text on a card, plus whether it is a due-soon (red) warning */
export function cardDate(j: Job): { text: string; tone: "red" | "plain" | "due" } {
  if (j.dueLabel === "Due" && j.dueAt) {
    const soon = startOfDay(j.dueAt) - startOfDay(Date.now()) <= 7 * DAY;
    return { text: `Due ${fmtShort(j.dueAt)}`, tone: soon ? "red" : "due" };
  }
  if ((j.status === "applied" || j.status === "offer" || j.status === "interviewing") && j.dueAt) return { text: fmtShort(j.dueAt), tone: "plain" };
  return { text: relAgo(j.addedAt), tone: "plain" };
}

export const matchesQuery = (j: Job, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || [j.company, j.role, j.location, j.track, j.pay].some((v) => v.toLowerCase().includes(s));
};
