import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppData, AppNotification, CalEvent, Company, Contact, Credential, DocItem, InboxMessage, Job, Settings, Status, Task } from "./types";
import { emptyData, seed } from "./seed";
import { registerVaultPersist, setVaultMeta } from "./vault";
import { registerLogoUrls, registerWebsites } from "./logo";
import { deleteFile, putFile } from "./filedb";
import { uid } from "./format";
import { approve, ingest, isOpen, SAMPLE_GATE_IDS, setStatus, type IngestItem, type IngestSummary } from "./gate";
import { syncEmails } from "./emailSync";
import { acknowledgeOutlook, syncOutlookMailbox } from "./outlookSync";
import { parseGatePayload, type GateStatus } from "@job-hunt-os/contracts";

const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toUpperCase() : "FILE");
const baseName = (name: string) => name.replace(/\.[^/.]+$/, "");

export type Actions = ReturnType<typeof makeActions>;
function makeActions(set: (fn: (d: AppData) => AppData) => void, get: () => AppData) {
  const log = (d: AppData, icon: string, title: string, subtitle: string): AppData => ({
    ...d, activity: [{ id: uid(), at: Date.now(), icon, title, subtitle }, ...d.activity].slice(0, 60),
  });
  const ensureCompany = (d: AppData, name: string): AppData =>
    !name || d.companies.some((c) => c.name.toLowerCase() === name.toLowerCase())
      ? d
      : { ...d, companies: [...d.companies, { id: uid(), name, website: "", industry: "", size: "", hq: "", notes: "" }] };

  return {
    // jobs
    addJob(input: Partial<Job> & Pick<Job, "company" | "role">): Job {
      const job: Job = {
        id: uid(), location: "Remote · US", workMode: "Remote", pay: "—", track: "Engineering", score: 80, status: "saved", url: "", addedAt: Date.now(),
        about: "", notes: "", source: "manual", eligibility: { f1: "Review", cpt: "Unknown", citizen: false, usPerson: false, sponsorship: "Not stated" }, ...input,
      };
      set((d) => log(ensureCompany({ ...d, jobs: [job, ...d.jobs] }, job.company), "spark", "Job added", `${job.company} · ${job.role}`));
      return job;
    },
    updateJob: (id: string, patch: Partial<Job>) => set((d) => ({ ...d, jobs: d.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
    moveJob(id: string, status: Status, opts?: { assessmentKind?: import("./types").AssessmentKind }) {
      set((d) => {
        const job = d.jobs.find((j) => j.id === id);
        if (!job || job.status === status) {
          // allow updating assessmentKind even if status unchanged (e.g. OA -> take_home refinement)
          if (job && status === "assessment" && opts?.assessmentKind && job.assessmentKind !== opts.assessmentKind) {
            return { ...d, jobs: d.jobs.map((j) => (j.id === id ? { ...j, assessmentKind: opts.assessmentKind! } : j)) };
          }
          return d;
        }
        const patch: Partial<Job> = {
          status,
          assessmentKind: status === "assessment" ? (opts?.assessmentKind ?? job.assessmentKind ?? "other") : job.assessmentKind,
          dueLabel: status === "applied" ? "Applied" : status === "assessment" ? "Assessment" : status === "offer" ? "Offer" : status === "interviewing" ? (job.dueLabel ?? "Interview") : job.dueLabel,
          dueAt: status === "applied" || status === "assessment" || status === "offer" ? Date.now() : job.dueAt,
        };
        return log({ ...d, jobs: d.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }, status === "applied" ? "doc" : "spark", `Moved to ${status.replace("_", " ")}`, `${job.company} · ${job.role}`);
      });
    },
    removeJob: (id: string) => set((d) => ({ ...d, jobs: d.jobs.filter((j) => j.id !== id), credentials: d.credentials.map((c) => ({ ...c, jobIds: c.jobIds.filter((j) => j !== id) })), documents: d.documents.map((x) => ({ ...x, jobIds: x.jobIds.filter((j) => j !== id) })) })),

    // companies & contacts
    addCompany(c: Partial<Company> & { name: string }) {
      const company: Company = { id: uid(), website: "", industry: "", size: "", hq: "", notes: "", ...c };
      set((d) => ({ ...d, companies: [...d.companies, company] }));
      return company;
    },
    updateCompany: (id: string, patch: Partial<Company>) => set((d) => ({ ...d, companies: d.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    removeCompany: (id: string) => set((d) => ({ ...d, companies: d.companies.filter((c) => c.id !== id) })),
    addContact(c: Partial<Contact> & { name: string }) {
      const contact: Contact = { id: uid(), role: "", company: "", email: "", phone: "", linkedin: "", ...c };
      set((d) => ensureCompany({ ...d, contacts: [contact, ...d.contacts] }, contact.company));
      return contact;
    },
    updateContact: (id: string, patch: Partial<Contact>) => set((d) => ({ ...d, contacts: d.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    removeContact: (id: string) => set((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) })),

    // documents
    async addFiles(files: File[], opts: { folder?: string; company?: string; jobIds?: string[] } = {}): Promise<DocItem[]> {
      const created: DocItem[] = [];
      for (const file of files) {
        const id = uid();
        await putFile(`${id}:v1`, file);
        created.push({
          id, name: baseName(file.name), description: opts.folder ?? "Uploaded document", ext: extOf(file.name), mime: file.type || "application/octet-stream",
          folder: opts.folder && opts.folder !== "All Files" ? opts.folder : /resume|cv/i.test(file.name) ? "Resumes" : /cover/i.test(file.name) ? "Cover Letters" : "Other",
          company: opts.company, jobIds: opts.jobIds ?? [], tags: [], size: file.size, createdAt: Date.now(), modifiedAt: Date.now(), hasFile: true, currentVersion: "v1",
          versions: [{ id: "v1", at: Date.now(), size: file.size, note: "Initial upload" }],
        });
      }
      set((d) => log({ ...d, documents: [...created, ...d.documents] }, "doc", "Document uploaded", created.map((c) => c.name).join(", ")));
      return created;
    },
    updateDocument: (id: string, patch: Partial<DocItem>) => set((d) => ({ ...d, documents: d.documents.map((x) => (x.id === id ? { ...x, ...patch, modifiedAt: Date.now() } : x)) })),
    async addVersion(id: string, file: File, note = "New version") {
      const doc = get().documents.find((x) => x.id === id);
      if (!doc) return;
      const vid = `v${doc.versions.length + 1}`;
      await putFile(`${id}:${vid}`, file);
      set((d) => ({ ...d, documents: d.documents.map((x) => (x.id === id ? { ...x, hasFile: true, currentVersion: vid, size: file.size, modifiedAt: Date.now(), ext: extOf(file.name), mime: file.type || x.mime, versions: [...x.versions, { id: vid, at: Date.now(), size: file.size, note }] } : x)) }));
    },
    trashDocument: (id: string, trashed = true) => set((d) => ({ ...d, documents: d.documents.map((x) => (x.id === id ? { ...x, trashed } : x)) })),
    async deleteDocument(id: string) {
      const doc = get().documents.find((x) => x.id === id);
      if (doc) await Promise.all(doc.versions.map((v) => deleteFile(`${id}:${v.id}`).catch(() => undefined)));
      set((d) => ({ ...d, documents: d.documents.filter((x) => x.id !== id) }));
    },
    duplicateDocument: (id: string) => set((d) => {
      const src = d.documents.find((x) => x.id === id);
      return src ? { ...d, documents: [{ ...src, id: uid(), name: `${src.name} copy`, hasFile: false, createdAt: Date.now(), modifiedAt: Date.now(), versions: [{ id: "v1", at: Date.now(), size: src.size, note: "Duplicated" }], currentVersion: "v1" }, ...d.documents] } : d;
    }),
    addFolder: (name: string) => set((d) => (d.folders.includes(name) ? d : { ...d, folders: [...d.folders, name] })),

    // credentials
    addCredential(c: Partial<Credential> & { portal: string }) {
      const cred: Credential = { id: uid(), domain: "", username: "", recoveryEmail: "", type: "Company", mfa: "none", notes: "", jobIds: [], lastUsedAt: Date.now(), createdAt: Date.now(), activity: [{ id: uid(), at: Date.now(), action: "Created credential" }], ...c };
      set((d) => log({ ...d, credentials: [cred, ...d.credentials] }, "key", "Credential added", cred.portal));
      return cred;
    },
    updateCredential: (id: string, patch: Partial<Credential>, action?: string) => set((d) => ({ ...d, credentials: d.credentials.map((c) => (c.id === id ? { ...c, ...patch, activity: action ? [{ id: uid(), at: Date.now(), action }, ...c.activity] : c.activity } : c)) })),
    logCredential: (id: string, action: string) => set((d) => ({ ...d, credentials: d.credentials.map((c) => (c.id === id ? { ...c, lastUsedAt: Date.now(), activity: [{ id: uid(), at: Date.now(), action }, ...c.activity].slice(0, 50) } : c)) })),
    removeCredential: (id: string) => set((d) => ({ ...d, credentials: d.credentials.filter((c) => c.id !== id) })),

    // calendar & tasks
    addEvent(e: Partial<CalEvent> & Pick<CalEvent, "title" | "start" | "end" | "kind">) {
      const ev: CalEvent = { id: uid(), format: "None", description: "", notes: "", attendees: [], prep: [], ...e };
      set((d) => log({ ...d, events: [...d.events, ev] }, "calendar", "Event added", ev.title));
      return ev;
    },
    updateEvent: (id: string, patch: Partial<CalEvent>) => set((d) => ({ ...d, events: d.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
    removeEvent: (id: string) => set((d) => ({ ...d, events: d.events.filter((e) => e.id !== id) })),
    togglePrep: (eventId: string, prepId: string) => set((d) => ({ ...d, events: d.events.map((e) => (e.id === eventId ? { ...e, prep: e.prep.map((p) => (p.id === prepId ? { ...p, done: !p.done } : p)) } : e)) })),
    addTask(t: Partial<Task> & { title: string }) {
      const task: Task = { id: uid(), subtitle: "", dueAt: Date.now(), priority: "Medium", icon: "mail", done: false, ...t };
      set((d) => ({ ...d, tasks: [task, ...d.tasks] }));
    },
    toggleTask: (id: string) => set((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),

    // notifications & inbox
    markNotification: (id: string, read = true) => set((d) => ({ ...d, notifications: d.notifications.map((n) => (n.id === id ? { ...n, read } : n)) })),
    markAllNotifications: () => set((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) })),
    removeNotification: (id: string) => set((d) => ({ ...d, notifications: d.notifications.filter((n) => n.id !== id) })),
    addNotification: (n: Omit<AppNotification, "id" | "at" | "read"> & Partial<AppNotification>) => set((d) => ({ ...d, notifications: [{ id: uid(), at: Date.now(), read: false, ...n }, ...d.notifications] })),
    markInbox: (id: string, read = true) => set((d) => ({ ...d, inbox: d.inbox.map((m) => (m.id === id ? { ...m, read } : m)) })),
    starInbox: (id: string) => set((d) => ({ ...d, inbox: d.inbox.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)) })),
    markAllInbox: () => set((d) => ({ ...d, inbox: d.inbox.map((m) => ({ ...m, read: true })) })),
    addInbox: (m: Omit<InboxMessage, "id" | "at" | "read" | "starred">) => set((d) => ({ ...d, inbox: [{ id: uid(), at: Date.now(), read: false, starred: false, ...m }, ...d.inbox] })),

    // GATE inbox: discovered opportunities (separate lifecycle from the application stage)
    ingestGate(items: IngestItem[]): IngestSummary {
      const res = ingest(get(), items);
      set(() => res.data);
      return res.summary;
    },
    importGateJson(text: string): { ok: true; summary: IngestSummary } | { ok: false; error: string } {
      let raw: unknown;
      try { raw = JSON.parse(text); } catch { return { ok: false, error: "That is not valid JSON." }; }
      if (JSON.stringify(raw).match(/"[^"]*(password|secret|token|credential)[^"]*"\s*:/i)) return { ok: false, error: "Payloads containing password, secret, token or credential fields are rejected." };
      const parsed = parseGatePayload(raw);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const res = ingest(get(), parsed.items);
      set(() => res.data);
      return { ok: true, summary: res.summary };
    },
    /** Applies decisions the server already holds (made on another device or in Telegram). Only items still awaiting a decision here change. */
    applyServerDecisions(decisions: { remoteId: string; status: GateStatus }[]) {
      for (const x of decisions) {
        const g = get().gate.find((i) => i.remoteId === x.remoteId);
        if (!g || !isOpen(g) || g.gateStatus === x.status) continue;
        if (x.status === "approved") set(() => approve(get(), g.id).data);
        else set((d) => setStatus(d, g.id, x.status));
      }
    },
    setVault: (vault: AppData["vault"]) => set((d) => ({ ...d, vault })),
    /** Used by workspace sync to merge changes made on other devices. */
    replaceWorkspace: (fn: (d: AppData) => AppData) => set(fn),
    snapshot: () => get(),
    setGateStatus: (id: string, status: GateStatus) => set((d) => setStatus(d, id, status)),
    markGateSeen: (id: string) => set((d) => ({ ...d, gate: d.gate.map((g) => (g.id === id && !g.seen ? { ...g, seen: true } : g)) })),
    /** Approve to pipeline: creates the Job (stage Saved) + company upsert + deadline event. Returns the new/linked job. */
    approveGate(id: string): Job | undefined {
      const res = approve(get(), id);
      set(() => res.data);
      return res.job;
    },
    removeGate: (id: string) => set((d) => ({ ...d, gate: d.gate.filter((g) => g.id !== id) })),
    /** Retrieves server-queued Inbox metadata, then classifies and applies changes locally. */
    async syncOutlookEmails(opts?: { messages?: import("./emailSync").EmailMessage[] }): Promise<import("./emailSync").EmailSyncResult> {
      const batch = opts?.messages ? { messages: opts.messages } : await syncOutlookMailbox();
      const res = await syncEmails(get(), { messages: batch.messages });
      set(() => res.data);
      const ids = batch.messages.map((m) => m.id).filter(Boolean);
      if (ids.length) await acknowledgeOutlook(ids);
      return res.result;
    },

    // settings
    updateSettings: <K extends keyof Settings>(section: K, patch: Partial<Settings[K]>) =>
      set((d) => ({
        ...d,
        settings: {
          ...d.settings,
          [section]: { ...((d.settings[section] as unknown as object) ?? {}), ...(patch as unknown as object) } as Settings[K],
        },
      })),
    resetDemo: () => set((d) => ({ ...seed(), vault: d.vault })),
    /** Replace all state with an imported export (shape-validated). Returns false when the JSON is not a valid export. */
    importData(json: unknown): boolean {
      const o = json as Partial<AppData> | null;
      const arrays = ["jobs", "companies", "contacts", "documents", "credentials", "events", "tasks", "notifications", "inbox", "activity"] as const;
      if (!o || typeof o !== "object" || !arrays.every((k) => Array.isArray(o[k])) || typeof o.settings !== "object" || !o.settings) return false;
      const base = seed();
      set((d) => ({ ...base, ...(o as AppData), vault: d.vault, folders: Array.isArray(o.folders) ? o.folders : base.folders, settings: { ...base.settings, ...o.settings } }));
      return true;
    },
    clearAll: () => set((d) => ({ ...seed(), jobs: [], companies: [], contacts: [], documents: [], credentials: [], events: [], tasks: [], notifications: [], inbox: [], activity: [], settings: d.settings, vault: d.vault })),
  };
}

type Ctx = { data: AppData; act: Actions };
const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData);
  const ref = useRef(data);
  ref.current = data;
  // state is advanced synchronously through the ref so actions that read-then-write (ingest, approve) stay consistent
  const act = useMemo(() => makeActions((fn) => { ref.current = fn(ref.current); setData(ref.current); }, () => ref.current), []);
  // the server saves each company's verified website on the record; share it with every Logo in the app
  useEffect(() => {
    registerWebsites([
      ...data.gate.map((g): [string, string | null | undefined] => [g.envelope.company.name, g.envelope.company.website]),
      ...data.jobs.map((j): [string, string | null | undefined] => [j.company, j.gate?.envelope.company.website]),
      ...data.companies.map((c): [string, string | null | undefined] => [c.name, c.website]),
    ]);
    registerLogoUrls([
      ...data.gate.map((g): [string, string | null | undefined] => [g.envelope.company.name, g.envelope.company.logo_url]),
      ...data.jobs.map((j): [string, string | null | undefined] => [j.company, j.gate?.envelope.company.logo_url]),
    ]);
  }, [data.gate, data.jobs, data.companies]);
  // the vault's salt/verifier travel with the workspace; hand them to the vault module and save new ones through the store
  useEffect(() => { setVaultMeta(data.vault); }, [data.vault]);
  useEffect(() => { registerVaultPersist((vault) => act.setVault(vault)); }, [act]);
  return <DataCtx.Provider value={useMemo(() => ({ data, act }), [data, act])}>{children}</DataCtx.Provider>;
}
export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error("DataProvider missing");
  return c;
}
