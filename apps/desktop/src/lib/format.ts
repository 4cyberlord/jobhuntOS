export const DAY = 86_400_000;
export const startOfDay = (t: number | Date) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const startOfWeek = (t: number | Date) => {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
};
export const addDays = (t: number, n: number) => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);
/** local ts for `dayOffset` days from today at hh:mm */
export const at = (dayOffset: number, h = 9, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const monthName = (t: number) => MONTHS_LONG[new Date(t).getMonth()];
export const weekdayShort = (t: number) => WEEKDAYS[new Date(t).getDay()];

export const fmtDate = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
export const fmtShort = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
export const fmtWeekday = (t: number) => `${weekdayShort(t)}, ${fmtDate(t)}`;
export const fmtTime = (t: number) => {
  const d = new Date(t);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
export const fmtRange = (a: number, b: number) => `${fmtTime(a)} – ${fmtTime(b)}`;
export const fmtDateTime = (t: number) => `${fmtDate(t)} at ${fmtTime(t)}`;
export const fmtDuration = (a: number, b: number) => {
  const mins = Math.round((b - a) / 60000);
  if (mins % 60 === 0) return `${mins / 60} hour${mins === 60 ? "" : "s"}`;
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
};
export const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
/** "10:24 AM" today, "Yesterday", else "Apr 12" */
export const fmtInbox = (t: number) => {
  const today = startOfDay(Date.now());
  if (startOfDay(t) === today) return fmtTime(t);
  if (startOfDay(t) === today - DAY) return "Yesterday";
  return fmtShort(t);
};
export const fmtAgo = (t: number) => {
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};
export const daysSince = (t: number) => Math.floor((startOfDay(Date.now()) - startOfDay(t)) / DAY);
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
/** value for <input type="datetime-local"> */
export const toLocalInput = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (s: string) => new Date(s).getTime();
