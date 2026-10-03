import type { GateEnvelope, GateStatus } from "@job-hunt-os/contracts";

export type Status =
  | "pending_review"
  | "saved"
  | "preparing"
  | "applied"
  | "interviewing"
  | "offer"
  | "rejected"
  | "dismissed";

export const PIPELINE: { status: Status; name: string }[] = [
  { status: "saved", name: "Saved" },
  { status: "preparing", name: "Preparing" },
  { status: "applied", name: "Applied" },
  { status: "interviewing", name: "Interviewing" },
  { status: "offer", name: "Offer" },
];

export type Job = {
  id: string;
  company: string;
  role: string;
  location: string;
  workMode: "Remote" | "Hybrid" | "Onsite";
  pay: string;
  track: string;
  score: number;
  status: Status;
  url: string;
  addedAt: number;
  /** date shown on cards: applied date, interview date, offer date, or deadline */
  dueAt?: number;
  dueLabel?: string;
  about: string;
  notes: string;
  source: "agent" | "manual";
  /** Snapshot of the GATE discovery this job came from (match, eligibility, source, agent are never discarded). */
  gate?: { opportunityId: string; envelope: GateEnvelope };
  eligibility: { f1: string; cpt: string; citizen: boolean; usPerson: boolean; sponsorship: string };
};

export type Company = {
  id: string;
  name: string;
  website: string;
  industry: string;
  size: string;
  hq: string;
  notes: string;
};

export type Contact = {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  linkedin: string;
  jobId?: string;
  lastContacted?: number;
};

export type DocFolder = "Resumes" | "Cover Letters" | "Portfolios" | "Certificates" | "Applications" | "Company Specific" | "Other";
export const BASE_FOLDERS: DocFolder[] = ["Resumes", "Cover Letters", "Portfolios", "Certificates", "Applications", "Company Specific", "Other"];

export type DocVersion = { id: string; at: number; size: number; note: string };
export type DocItem = {
  id: string;
  name: string;
  description: string;
  /** upper-case extension: PDF, DOCX, TXT … */
  ext: string;
  mime: string;
  folder: string;
  company?: string;
  jobIds: string[];
  tags: string[];
  size: number;
  createdAt: number;
  modifiedAt: number;
  trashed?: boolean;
  /** true when real bytes live in IndexedDB under `${id}:${currentVersion}` */
  hasFile: boolean;
  currentVersion: string;
  versions: DocVersion[];
};

export type CredType = "Company" | "HR Platform" | "ATS" | "Social" | "Job Board";
export type Strength = "strong" | "medium" | "weak";
export type Credential = {
  id: string;
  portal: string;
  company?: string;
  domain: string;
  username: string;
  recoveryEmail: string;
  type: CredType;
  mfa: "none" | "authenticator" | "sms" | "email";
  /** AES-GCM sealed password (see lib/vault.ts); undefined = no password saved yet */
  secret?: { iv: string; ct: string };
  strength?: Strength;
  /** fingerprint of the password for reuse detection (salted, non reversible) */
  fingerprint?: string;
  notes: string;
  jobIds: string[];
  lastUsedAt: number;
  createdAt: number;
  activity: { id: string; at: number; action: string }[];
};

export type EventKind = "interview" | "followup" | "deadline" | "assessment" | "personal";
export type CalEvent = {
  id: string;
  title: string;
  company?: string;
  kind: EventKind;
  start: number;
  end: number;
  format: "Video Call" | "In Person" | "Phone" | "None";
  link?: string;
  location?: string;
  description: string;
  notes: string;
  jobId?: string;
  attendees: { name: string; role: string }[];
  prep: { id: string; text: string; done: boolean }[];
};

export type Task = {
  id: string;
  title: string;
  company?: string;
  subtitle: string;
  dueAt: number;
  priority: "High" | "Medium" | "Low" | "Today";
  icon: "mail" | "calendar" | "send" | "search";
  done: boolean;
  jobId?: string;
};

export type NotifKind = "interview" | "deadline" | "match" | "recruiter" | "followup" | "document" | "stale" | "reminder" | "weekly";
export type AppNotification = {
  id: string;
  kind: NotifKind;
  title: string;
  company?: string;
  role?: string;
  body: string;
  at: number;
  read: boolean;
  chip: string;
  jobId?: string;
  eventId?: string;
};

export type InboxKind = "research" | "applications" | "followups" | "interviews" | "insights" | "alerts";
export type InboxMessage = {
  id: string;
  kind: InboxKind;
  icon: "sparkle" | "mail" | "calendar" | "doc" | "bulb" | "chart" | "alert";
  title: string;
  preview: string;
  body: string;
  at: number;
  read: boolean;
  starred: boolean;
  /** job ids rendered as "Top Matches" inside the message */
  matches?: string[];
  /** GATE opportunity ids rendered as "Top Matches" (agent discoveries awaiting review) */
  gateMatches?: string[];
  /** optional call-to-action button shown under the message body */
  cta?: { label: string; route: string };
};

export type Settings = {
  profile: { name: string; email: string; title: string; location: string; phone: string; linkedin: string; website: string; bio: string; /** profile photo as a data URL */ avatar?: string };
  appearance: { theme: "light" | "dark" | "system"; density: "comfortable" | "compact"; fontScale?: number };
  notify: { interviews: boolean; deadlines: boolean; followups: boolean; agent: boolean; system: boolean };
  prefs: { roles: string; locations: string; salary: string; companies: string; keywords: string; level: string };
  agent: { active: boolean };
  /** notification id -> wake-up time (ms) for snoozed notifications */
  snoozed?: Record<string, number>;
};

/** A discovered opportunity in the GATE Inbox. `gateStatus` is the inbox lifecycle, NOT the application stage. */
export type GateOpportunity = {
  id: string;
  gateStatus: GateStatus;
  fingerprint: string;
  receivedAt: number;
  updatedAt: number;
  /** false until the user opens it in the GATE Inbox (drives the "new" dot) */
  seen: boolean;
  envelope: GateEnvelope;
  linkedJobId?: string;
  /** id assigned by the server when synced; used to report decisions back */
  remoteId?: string;
};

export type AppData = {
  gate: GateOpportunity[];
  jobs: Job[];
  companies: Company[];
  contacts: Contact[];
  documents: DocItem[];
  folders: string[];
  credentials: Credential[];
  events: CalEvent[];
  tasks: Task[];
  notifications: AppNotification[];
  inbox: InboxMessage[];
  activity: { id: string; at: number; icon: string; title: string; subtitle: string }[];
  settings: Settings;
  /** vault salt + verifier (ciphertext only; the master password never leaves the device) */
  vault?: { salt: string; verifier: { iv: string; ct: string } };
};
