import { MongoClient, ObjectId, type Db } from "mongodb";
import { deriveFlags, softKey, type AgentOpportunity, type GateEnvelope, type GateStatus } from "@job-hunt-os/contracts";
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
