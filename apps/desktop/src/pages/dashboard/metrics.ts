import type { AppData, Job, Status } from "../../lib/types";
import { DAY, startOfDay } from "../../lib/format";

export const APPLIED_STATUSES: Status[] = ["applied", "interviewing", "offer", "rejected"];
export const ACTIVE_STATUSES: Status[] = ["saved", "preparing", "applied", "interviewing", "offer"];
export const RESPONDED: Status[] = ["interviewing", "offer", "rejected"];

/** Best-effort "date applied": the applied stamp for applied jobs, otherwise the date the job was added. */
export const appliedAt = (j: Job): number => {
  if (j.status === "applied" && j.dueAt && j.dueAt <= Date.now()) return j.dueAt;
  return Math.min(j.addedAt, Date.now());
};
export const isApp = (j: Job) => APPLIED_STATUSES.includes(j.status);
export const responseRate = (jobs: Job[]): number | null => {
  const apps = jobs.filter(isApp);
  return apps.length ? Math.round((apps.filter((j) => RESPONDED.includes(j.status)).length / apps.length) * 100) : null;
};

/** Latest sign of movement for a job: add/applied date or the newest activity line that mentions it. */
export function lastTouch(data: AppData, j: Job): number {
  const key = `${j.company} · ${j.role}`;
  let t = appliedAt(j);
  for (const a of data.activity) if (a.subtitle === key && a.at > t) t = a.at;
  return t;
}

export type Delta = { text: string; dir: "up" | "down" | "flat" };
export function delta(cur: number, prior: number, suffix = ""): Delta {
  if (!prior && !cur) return { text: "—", dir: "flat" };
  if (!prior) return { text: `↑ new${suffix}`, dir: "up" };
  const pct = Math.round(((cur - prior) / prior) * 100);
  if (pct === 0) return { text: "— no change", dir: "flat" };
  return { text: `${pct > 0 ? "↑ +" : "↓ "}${pct}%`, dir: pct > 0 ? "up" : "down" };
}
export function pointDelta(cur: number | null, prior: number | null): Delta {
  if (cur === null || prior === null) return { text: "—", dir: "flat" };
  const d = cur - prior;
  return d === 0 ? { text: "— no change", dir: "flat" } : { text: `${d > 0 ? "↑ +" : "↓ "}${d}%`, dir: d > 0 ? "up" : "down" };
}

export type WeekPoint = { start: number; end: number; label: string; apps: number; interviews: number; rate: number | null };
/** `n` rolling 7-day buckets ending today. Response rate is cumulative at the end of each bucket. */
export function weekSeries(data: AppData, n: number, fmt: (t: number) => string): WeekPoint[] {
  const today = startOfDay(Date.now());
  const out: WeekPoint[] = [];
  for (let k = 0; k < n; k++) {
    const start = today - (n - k) * 7 * DAY + DAY;
    const end = start + 7 * DAY;
    const apps = data.jobs.filter((j) => isApp(j) && appliedAt(j) >= start && appliedAt(j) < end).length;
    const interviews = data.events.filter((e) => e.kind === "interview" && e.start >= start && e.start < (k === n - 1 ? end + 7 * DAY : end)).length;
    const cohort = data.jobs.filter((j) => isApp(j) && appliedAt(j) < end);
    out.push({ start, end, label: fmt(start), apps, interviews, rate: responseRate(cohort) });
  }
  return out;
}
