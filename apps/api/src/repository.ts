import { MongoClient, ObjectId, type Db } from "mongodb";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { deriveFlags, softKey, type AgentOpportunity, type GateEnvelope, type GateStatus } from "@job-hunt-os/contracts";
import { resolveWebsite } from "./company-site.js";
import { classifyIncoming, fingerprintOf, initialDelivery, MAX_DELIVERY_ATTEMPTS, mutableUpdate, nextDelivery, notificationFor, SENDING_LEASE_MS, USER_DECIDED, type DeliveryOutcome, type DeliveryState } from "./gate-ingest.js";
let db: Db | undefined;
export async function database() { if (db) return db; const uri = process.env.MONGODB_URI; if (!uri) throw new Error("MONGODB_URI is required"); const client = new MongoClient(uri); await client.connect(); db = client.db(); await Promise.all([db.collection("opportunities").createIndex({ externalId: 1 }, { unique: true }), db.collection("opportunities").createIndex({ duplicateKey: 1 }, { unique: true }), db.collection("audit_logs").createIndex({ createdAt: -1 }), db.collection("gate_opportunities").createIndex({ fingerprint: 1 }, { unique: true }), db.collection("gate_opportunities").createIndex({ external_id: 1 }), db.collection("gate_opportunities").createIndex({ gate_status: 1 }), db.collection("gate_opportunities").createIndex({ updatedAt: 1 }), db.collection("auth_failures").createIndex({ at: 1 }, { expireAfterSeconds: 900 }), db.collection("auth_failures").createIndex({ ip: 1, at: 1 }), db.collection("gate_opportunities").createIndex({ "delivery.telegram.status": 1, "delivery.telegram.next_retry_at": 1 })]); return db; }
export async function upsertPending(input: AgentOpportunity, key: string) { const d = await database(); const now = new Date(); const existing = await d.collection("opportunities").findOne({ $or: [{ externalId: input.externalId }, { duplicateKey: key }] }); const result = await d.collection("opportunities").findOneAndUpdate({ $or: [{ externalId: input.externalId }, { duplicateKey: key }] }, { $set: { ...input, duplicateKey: key, reviewStatus: existing?.reviewStatus ?? "pending_review", updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true, returnDocument: "after" }); if (!existing) await d.collection("notifications").insertOne({ opportunityExternalId: input.externalId, title: `New match: ${input.company.name}`, body: input.job.title, urgency: input.match.score >= 85 ? "high" : "normal", deliveredAt: null, createdAt: now }); return result; }
export async function audit(action: string, externalId?: string) { const d = await database(); await d.collection("audit_logs").insertOne({ action, externalId, createdAt: new Date() }); }

/* ───────── GATE inbox ───────── */
export type GateIngestResult = { gate_opportunity_id: string; gate_status: GateStatus; duplicate: boolean; discarded?: boolean; existing_job_id?: string; telegram_status?: string };
export async function ingestGate(item: GateEnvelope, opts: { telegramDelivered?: boolean } = {}): Promise<GateIngestResult & { created: boolean }> {
  const d = await database(); const c = d.collection("gate_opportunities"); const now = new Date();
  const fingerprint = fingerprintOf(item); const soft = softKey(item);
  const { external_id } = item.opportunity; const provider = item.source.provider;
  const existing = await c.findOne({ $or: [{ fingerprint }, ...(item.metadata.fingerprint ? [{ fingerprint: item.metadata.fingerprint }] : []), { external_id, provider }, { softKey: soft }] });
  const plan = classifyIncoming(existing ? { gate_status: existing.gate_status as GateStatus } : null, item);
  if (plan.action === "discard") { await audit("gate.opportunity.discarded", external_id); return { gate_opportunity_id: "", gate_status: "dismissed", duplicate: false, discarded: true, created: false }; }
  if (plan.action === "update" && existing) {
    await c.updateOne({ _id: existing._id }, { $set: { ...mutableUpdate(item, now), deliveredAt: null } });
    await audit("gate.opportunity.duplicate", external_id);
    return { gate_opportunity_id: String(existing._id), gate_status: plan.gate_status, duplicate: true, created: false, telegram_status: (existing.delivery?.telegram?.status as string | undefined) ?? "sent", ...(existing.linked_job_id ? { existing_job_id: String(existing.linked_job_id) } : {}) };
  }
  const flags = deriveFlags(item, now.getTime());
  const doc = { fingerprint, softKey: soft, external_id, provider, gate_status: plan.gate_status, flags, linked_job_id: null, delivery: { telegram: initialDelivery(!!opts.telegramDelivered, now) }, envelope: { ...item, agent: { ...item.agent, flags }, metadata: { ...item.metadata, fingerprint, gate_status: plan.gate_status } }, createdAt: now, updatedAt: now, deliveredAt: null };
  let id: string;
  try { id = String((await c.insertOne(doc)).insertedId); } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e; // lost a race on the unique fingerprint
    const won = await c.findOne({ fingerprint }); return { gate_opportunity_id: String(won?._id), gate_status: (won?.gate_status as GateStatus) ?? "discovered", duplicate: true, created: false };
  }
  await audit("gate.opportunity.created", external_id);
  const n = notificationFor(item, flags);
  if (n) await d.collection("notifications").insertOne({ ...n, opportunityExternalId: external_id, deliveredAt: null, createdAt: now });
  return { gate_opportunity_id: id, gate_status: plan.gate_status, duplicate: false, created: true, telegram_status: doc.delivery.telegram.status };
}
export async function gateDecisions() { const d = await database(); const rows = await d.collection("gate_opportunities").find({ gate_status: { $in: [...USER_DECIDED] } }, { projection: { external_id: 1, gate_status: 1, updatedAt: 1 } }).toArray(); return rows.map((r) => ({ gate_opportunity_id: String(r._id), external_id: r.external_id, gate_status: r.gate_status, updatedAt: r.updatedAt })); }
export async function gateForDesktop(since?: string) {
  const d = await database(); const c = d.collection("gate_opportunities");
  const rows = await c.find(since ? { updatedAt: { $gt: new Date(since) } } : { deliveredAt: null }).sort({ updatedAt: 1 }).limit(100).toArray();
  if (!since && rows.length) await c.updateMany({ _id: { $in: rows.map((r) => r._id) } }, { $set: { deliveredAt: new Date() } });
  return rows.map((r) => ({ gate_opportunity_id: String(r._id), fingerprint: r.fingerprint, gate_status: r.gate_status, received_at: (r.createdAt as Date).toISOString(), updated_at: (r.updatedAt as Date).toISOString(), envelope: { ...r.envelope, metadata: { ...r.envelope.metadata, gate_status: r.gate_status } } }));
}
export async function setGateStatus(id: string, gate_status: GateStatus, linked_job_id?: string) {
  if (!ObjectId.isValid(id)) return false;
  const d = await database(); const r = await d.collection("gate_opportunities").updateOne({ _id: new ObjectId(id) }, { $set: { gate_status, ...(linked_job_id ? { linked_job_id } : {}), updatedAt: new Date() } });
  if (r.matchedCount) await audit(`gate.status.${gate_status}`, id);
  return r.matchedCount === 1;
}

/* ───────── delivery outbox ───────── */
export async function recordDelivery(id: string, outcome: DeliveryOutcome) {
  if (!ObjectId.isValid(id)) return false;
  const c = (await database()).collection("gate_opportunities");
  const doc = await c.findOne({ _id: new ObjectId(id) }, { projection: { delivery: 1 } });
  if (!doc) return false;
  const state = nextDelivery(doc.delivery?.telegram as Partial<DeliveryState> | undefined, outcome);
  await c.updateOne({ _id: doc._id }, { $set: { "delivery.telegram": state } });
  await audit(`gate.delivery.telegram.${state.status}`, id);
  return true;
}
/** Atomically leases up to `limit` items that still need a Telegram message (pending, retryable failures, expired leases). */
export async function claimPendingDeliveries(limit: number) {
  const c = (await database()).collection("gate_opportunities"); const out = [];
  for (let i = 0; i < limit; i++) {
    const now = new Date();
    const doc = await c.findOneAndUpdate(
      { "delivery.telegram.status": { $in: ["pending", "rate_limited", "failed", "sending"] }, "delivery.telegram.retry_count": { $lt: MAX_DELIVERY_ATTEMPTS }, "delivery.telegram.next_retry_at": { $lte: now } },
      { $set: { "delivery.telegram.status": "sending", "delivery.telegram.next_retry_at": new Date(now.getTime() + SENDING_LEASE_MS), "delivery.telegram.updated_at": now } },
      { sort: { createdAt: 1 }, returnDocument: "after" });
    if (!doc) break;
    out.push({ gate_opportunity_id: String(doc._id), envelope: doc.envelope, attempt: (doc.delivery?.telegram?.retry_count ?? 0) + 1 });
  }
  return out;
}

/* ───────── failed-auth throttle ───────── */
export const MAX_AUTH_FAILURES = 30; // per address per 15 minutes (the TTL index expires entries)
/** Fails open: if MongoDB hiccups the throttle must not take the API down. */
export async function authBlocked(ip: string) {
  try { const c = (await database()).collection("auth_failures"); return (await c.countDocuments({ ip, at: { $gt: new Date(Date.now() - 900_000) } }, { limit: MAX_AUTH_FAILURES })) >= MAX_AUTH_FAILURES; } catch { return false; }
}
export async function recordAuthFailure(ip: string) { try { await (await database()).collection("auth_failures").insertOne({ ip, at: new Date() }); } catch { /* best effort */ } }

/* ───────── company website enrichment (drives real logos in the app) ───────── */
const RECHECK_MS = 7 * 86_400_000;
/** Verifies and stores `company.website` for one record. Records the attempt either way so failures are not retried constantly. */
export async function enrichCompanyById(id: string): Promise<string | undefined> {
  if (!ObjectId.isValid(id)) return undefined;
  const c = (await database()).collection("gate_opportunities");
  const doc = await c.findOne({ _id: new ObjectId(id) }, { projection: { envelope: 1 } });
  if (!doc) return undefined;
  const e = doc.envelope as GateEnvelope;
  const website = e.company.website || (await resolveWebsite(e.company.name, { applyUrl: e.opportunity.application.apply_url }));
  const now = new Date();
  await c.updateOne({ _id: doc._id }, { $set: { site_checked_at: now, ...(website && !e.company.website ? { "envelope.company.website": website, updatedAt: now } : {}) } });
  return website;
}
/** Works through records that still have no website. `updatedAt` is bumped on success so the desktop's cursor sync picks the change up. */
const NEEDS = { $or: [{ "envelope.company.website": { $exists: false } }, { "envelope.company.website": null }, { "envelope.company.website": "" }] };
export async function enrichPending(limit: number, force = false) {
  const c = (await database()).collection("gate_opportunities");
  const cutoff = new Date(Date.now() - RECHECK_MS);
  const filter = force ? NEEDS : { $and: [NEEDS, { $or: [{ site_checked_at: { $exists: false } }, { site_checked_at: { $lt: cutoff } }] }] };
  const docs = await c.find(filter, { projection: { envelope: 1 } }).limit(limit).toArray();
  const results: { company: string; website: string | null }[] = [];
  for (let i = 0; i < docs.length; i += 3) {
    await Promise.all(docs.slice(i, i + 3).map(async (d) => { const w = await enrichCompanyById(String(d._id)); results.push({ company: (d.envelope as GateEnvelope).company.name, website: w ?? null }); }));
  }
  const remaining = force ? Math.max(0, (await c.countDocuments(NEEDS)) - docs.length) : await c.countDocuments(filter);
  return { checked: docs.length, resolved: results.filter((r) => r.website).length, remaining, results };
}

/* ───────── workspace sync (jobs, companies, contacts, calendar, tasks, notifications, inbox, settings) ───────── */
export const WORKSPACE_COLLECTIONS = ["jobs", "companies", "contacts", "events", "tasks", "notifications", "inbox", "activity", "documents", "credentials", "gate", "settings", "folders", "vault"] as const;
export type WorkspaceCollection = (typeof WORKSPACE_COLLECTIONS)[number];
export type WorkspaceChange = { c: WorkspaceCollection; id: string; u: number; deleted?: boolean; doc?: unknown };
/** Last-writer-wins by the client's edit time `u`; a tie keeps what the server has so a replayed push never churns. */
export const incomingWins = (existingU: number | undefined, incomingU: number) => existingU === undefined || incomingU > existingU;
let wsIndexed = false;
const PAGE = 150; // keeps each response well under the 4.5MB serverless limit
/** Applies a batch of changes, then returns everything that changed on the server since `since` (ISO time). `next` is the new cursor. */
export async function workspaceSync(changes: WorkspaceChange[], since: string) {
  const c = (await database()).collection<{ _id: string; c: string; id: string; u: number; deleted: boolean; doc: unknown; at: Date }>("workspace");
  if (!wsIndexed) { await c.createIndex({ at: 1 }); wsIndexed = true; }
  let accepted = 0;
  for (const ch of changes) {
    const _id = `${ch.c}:${ch.id}`; const at = new Date();
    const set = { c: ch.c, id: ch.id, u: ch.u, deleted: !!ch.deleted, doc: ch.deleted ? null : ch.doc, at };
    try {
      const r = await c.updateOne({ _id, u: { $lt: ch.u } }, { $set: set });
      if (r.matchedCount) { accepted++; continue; }
      await c.insertOne({ _id, ...set }); accepted++; // no document yet
    } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; /* exists with an equal or newer u: server keeps its copy */ }
  }
  const rows = await c.find({ at: { $gt: new Date(since) } }).sort({ at: 1 }).limit(PAGE).toArray();
  const last = rows.at(-1)?.at;
  return {
    accepted,
    // step back 1ms so rows sharing the boundary instant are never skipped; seeing one twice is harmless (clients compare `u`)
    next: last ? new Date(last.getTime() - 1).toISOString() : since,
    more: rows.length === PAGE,
    changes: rows.map((r) => ({ c: r.c, id: r.id, u: r.u, deleted: r.deleted, doc: r.doc })),
  };
}

/* ───────── document file storage (chunked: serverless request bodies are capped at ~4.5MB) ───────── */
import { Binary } from "mongodb";
export const FILE_CHUNK = 3 * 1024 * 1024;
const validFileId = (id: string) => /^[A-Za-z0-9_:.-]{1,120}$/.test(id);
export async function putFileChunk(id: string, n: number, data: Buffer) {
  if (!validFileId(id) || !Number.isInteger(n) || n < 0 || n > 400 || data.length > FILE_CHUNK + 1024) return false;
  await (await database()).collection<{ _id: string; fileId: string; n: number; data: Binary }>("file_chunks").replaceOne({ _id: `${id}#${n}` }, { fileId: id, n, data: new Binary(data) }, { upsert: true });
  return true;
}
/** Seals an upload: records size/type/chunk count and removes any leftover chunks from an earlier, longer version. */
export async function commitFile(id: string, meta: { chunks: number; size: number; mime: string }) {
  if (!validFileId(id)) return false;
  const d = await database(); const chunks = d.collection("file_chunks");
  if ((await chunks.countDocuments({ fileId: id, n: { $lt: meta.chunks } })) !== meta.chunks) return false; // a chunk is missing
  await chunks.deleteMany({ fileId: id, n: { $gte: meta.chunks } });
  await d.collection("files").replaceOne({ _id: id } as never, { _id: id, ...meta, at: new Date() } as never, { upsert: true });
  return true;
}
export async function fileMeta(id: string) { return validFileId(id) ? ((await (await database()).collection("files").findOne({ _id: id } as never)) as { chunks: number; size: number; mime: string } | null) : null; }
export async function getFileChunk(id: string, n: number) {
  if (!validFileId(id)) return null;
  const row = await (await database()).collection<{ _id: string; data: Binary }>("file_chunks").findOne({ _id: `${id}#${n}` });
  return row ? Buffer.from(row.data.buffer) : null;
}
export async function removeFile(id: string) {
  if (!validFileId(id)) return false; const d = await database();
  await d.collection("file_chunks").deleteMany({ fileId: id }); await d.collection("files").deleteOne({ _id: id } as never); return true;
}

/* ───────── secrets live in the database (only MONGODB_URI, needed to reach it, stays in the environment) ─────────
   `secrets` holds the owner's email + salted password hash and the agent key's SHA-256; `sessions` holds SHA-256 of each signed-in
   device's token. Nothing here is reversible, so a copy of the database does not hand out working keys. */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function getOwner() { return (await (await database()).collection("secrets").findOne({ _id: "owner" } as never)) as { email: string; passwordHash: string } | null; }
export async function setOwner(email: string, passwordHash: string) { await (await database()).collection("secrets").updateOne({ _id: "owner" } as never, { $set: { email: email.trim().toLowerCase(), passwordHash, updatedAt: new Date() } }, { upsert: true }); }
export async function setAgentKey(key: string) { await (await database()).collection("secrets").updateOne({ _id: "agent_api_key" } as never, { $set: { hash: sha(key), updatedAt: new Date() } }, { upsert: true }); }
/** True when `given` is the agent key. Until one is stored in the database the AGENT_API_KEY environment variable is honoured as a transition. */
export async function agentKeyOk(given: string | undefined) {
  if (!given) return false;
  const row = (await (await database()).collection("secrets").findOne({ _id: "agent_api_key" } as never)) as { hash: string } | null;
  if (row) return sameHex(sha(given), row.hash);
  const env = process.env.AGENT_API_KEY;
  return !!env && sameHex(sha(given), sha(env));
}
let sessionIndexed = false;
const seen = new Map<string, number>(); // short-lived cache so a busy sync does not query the database on every request
export async function createSession(days: number) {
  const c = (await database()).collection<{ _id: string; createdAt: Date; expiresAt: Date }>("sessions");
  if (!sessionIndexed) { await c.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); sessionIndexed = true; }
  const token = `jh_${randomBytes(32).toString("base64url")}`; const now = new Date();
  await c.insertOne({ _id: sha(token), createdAt: now, expiresAt: new Date(now.getTime() + days * 86_400_000) });
  return token;
}
export async function sessionValid(token: string | undefined) {
  if (!token || !token.startsWith("jh_")) return false;
  const id = sha(token); const hit = seen.get(id);
  if (hit && hit > Date.now()) return true;
  const row = await (await database()).collection<{ _id: string; expiresAt: Date }>("sessions").findOne({ _id: id });
  if (!row || row.expiresAt.getTime() < Date.now()) { seen.delete(id); return false; }
  seen.set(id, Date.now() + 60_000);
  return true;
}
export async function endSession(token: string | undefined) { if (!token) return; const id = sha(token); seen.delete(id); await (await database()).collection<{ _id: string }>("sessions").deleteOne({ _id: id }); }

/** GitHub access for update delivery: a read-only fine-grained token for the private repo, kept in the database. */
export async function getGithub() { return (await (await database()).collection("secrets").findOne({ _id: "github" } as never)) as { token: string; repo: string } | null; }
export async function setGithub(token: string, repo: string) { await (await database()).collection("secrets").updateOne({ _id: "github" } as never, { $set: { token, repo, updatedAt: new Date() } }, { upsert: true }); }
