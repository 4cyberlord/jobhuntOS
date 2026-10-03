import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { agentOpportunitySchema, containsSensitiveKey, duplicateKey, GATE_STATUSES, normalizeIncoming, parseGatePayload, searchProfile, type LegacyGate } from "@job-hunt-os/contracts";
import { timingSafeEqual } from "node:crypto";
import { audit, authBlocked, claimPendingDeliveries, database, gateDecisions, gateForDesktop, ingestGate, recordAuthFailure, recordDelivery, setGateStatus, upsertPending } from "./repository.js";

const sameKey = (given: string | undefined, wanted: string | undefined) => { if (!given || !wanted) return false; const a = Buffer.from(given), b = Buffer.from(wanted); return a.length === b.length && timingSafeEqual(a, b); };

/** Builds the API without listening, so it can run as a local server or inside a serverless function. */
export async function buildApp() {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.body"] }, trustProxy: !!process.env.VERCEL });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  // The desktop app (Tauri webview or the Vite dev server) calls /v1/desktop from another origin, so allow exactly those origins.
  const desktopOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", ...(process.env.DESKTOP_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])]);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/desktop")) return;
    const origin = request.headers.origin;
    if (origin && desktopOrigins.has(origin)) reply.header("Access-Control-Allow-Origin", origin).header("Vary", "Origin").header("Access-Control-Allow-Headers", "Authorization, Content-Type").header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  // Bearer keys are compared in constant time. Repeated failures from one address are throttled (stored in MongoDB because
  // serverless instances share no memory), so guessing a key is impractical even though the API is public.
  const ROLES: [string, string][] = [["/v1/agent", "AGENT_API_KEY"], ["/v1/desktop", "DESKTOP_SYNC_KEY"]];
  app.addHook("onRequest", async (request, reply) => {
    const role = ROLES.find(([prefix]) => request.url.startsWith(prefix));
    if (!role || request.method === "OPTIONS") return;
    if (await authBlocked(request.ip)) return reply.code(429).send({ error: "too many failed attempts, try again later" });
    if (!sameKey(request.headers.authorization?.replace(/^Bearer\s+/i, ""), process.env[role[1]])) { await recordAuthFailure(request.ip); return reply.code(401).send({ error: "unauthorized" }); }
  });
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
  app.get("/health", async () => ({ ok: true }));
  app.get("/v1/agent/search-profile", async () => searchProfile);
  app.post("/v1/agent/opportunities", async (request, reply) => { if (containsSensitiveKey(request.body)) return reply.code(400).send({ error: "sensitive fields are forbidden" }); const parsed = agentOpportunitySchema.safeParse(request.body); if (!parsed.success) return reply.code(422).send({ error: "invalid payload", details: parsed.error.flatten() }); const item = await upsertPending(parsed.data, duplicateKey(parsed.data)); await audit("agent.opportunity.upsert", parsed.data.externalId); return reply.code(201).send({ id: item?._id, reviewStatus: "pending_review" }); });
  app.patch("/v1/agent/opportunities/:externalId", async (request, reply) => { const body = request.body as { postingStatus?: "open" | "closed" | "reposted" }; if (!body?.postingStatus) return reply.code(422).send({ error: "postingStatus required" }); const d = await database(); const result = await d.collection("opportunities").updateOne({ externalId: (request.params as { externalId: string }).externalId }, { $set: { postingStatus: body.postingStatus, updatedAt: new Date() } }); await audit("agent.opportunity.status", (request.params as { externalId: string }).externalId); return reply.send({ updated: result.matchedCount === 1 }); });
  app.get("/v1/agent/decisions", async () => { const d = await database(); return d.collection("opportunities").find({ reviewStatus: { $in: ["approved", "dismissed", "archived"] } }, { projection: { externalId: 1, reviewStatus: 1, updatedAt: 1 } }).toArray(); });
  app.get("/v1/desktop/notifications", async () => { const d = await database(); const alerts = await d.collection("notifications").find({ deliveredAt: null }).sort({ createdAt: 1 }).limit(20).toArray(); if (alerts.length) await d.collection("notifications").updateMany({ _id: { $in: alerts.map(a => a._id) } }, { $set: { deliveredAt: new Date() } }); return alerts.map(({ title, body, urgency, opportunityExternalId }) => ({ title, body, urgency, opportunityExternalId })); });
  async function handleGateIngest(request: FastifyRequest, reply: FastifyReply) {
    if (containsSensitiveKey(request.body)) return reply.code(400).send({ error: "sensitive fields are forbidden" });
    const parsed = parseGatePayload(request.body);
    if (!parsed.ok) return reply.code(422).send({ error: "invalid payload", details: parsed.error });
    const results = []; const summary = { received: parsed.items.length, created: 0, duplicates: 0, discarded: 0 };
    for (const item of parsed.items) {
      const r = await ingestGate(item);
      if (r.discarded) summary.discarded++; else if (r.duplicate) summary.duplicates++; else summary.created++;
      results.push({ gate_opportunity_id: r.gate_opportunity_id, gate_status: r.gate_status, duplicate: r.duplicate, ...(r.discarded ? { discarded: true } : {}), ...(r.existing_job_id ? { existing_job_id: r.existing_job_id } : {}) });
    }
    const code = summary.created ? 201 : 200;
    const isBatch = Array.isArray((request.body as { results?: unknown })?.results);
    return reply.code(code).send(isBatch ? { success: true, results, summary } : { success: true, result: results[0] });
  }
  app.post("/v1/agent/gate/opportunities", handleGateIngest);
  app.post("/v1/agent/gate/opportunities/batch", handleGateIngest);
  // Relay-era payloads (Railway worker / Vercel relay / Telegram backfill): normalized into full envelopes, then stored like any discovery.
  app.post("/v1/agent/gate/legacy", async (request, reply) => {
    if (containsSensitiveKey(request.body)) return reply.code(400).send({ error: "sensitive fields are forbidden" });
    const body = request.body as unknown;
    // notify:false (body or ?notify=0) marks Telegram as already delivered, so backfills are never re-sent
    const notify = (body as { notify?: boolean })?.notify === false || (request.query as { notify?: string })?.notify === "0" ? false : true;
    const list = Array.isArray(body) ? body : Array.isArray((body as { items?: unknown })?.items) ? (body as { items: unknown[] }).items : body && typeof body === "object" ? [body] : [];
    if (!list.length || list.length > 200) return reply.code(422).send({ error: "send 1-200 opportunities" });
    const results = []; const summary = { received: list.length, created: 0, duplicates: 0, invalid: 0 };
    for (const raw of list as (LegacyGate & { received_at?: string })[]) {
      const at = raw.received_at && !Number.isNaN(Date.parse(raw.received_at)) ? new Date(raw.received_at) : undefined;
      const n = normalizeIncoming(raw, { at });
      if (!n.ok) { summary.invalid++; results.push({ ok: false, error: n.error }); continue; }
      const r = await ingestGate(n.envelope, { telegramDelivered: notify === false });
      if (r.duplicate) summary.duplicates++; else summary.created++;
      results.push({ ok: true, gate_opportunity_id: r.gate_opportunity_id, gate_status: r.gate_status, duplicate: r.duplicate, telegram_status: r.telegram_status });
    }
    return reply.code(summary.created ? 201 : 200).send({ success: summary.invalid < list.length, results, summary });
  });
  const deliveryBody = z.object({ channel: z.literal("telegram"), status: z.enum(["sent", "failed", "rate_limited"]), message_id: z.number().int().optional(), error: z.string().max(500).optional(), retry_after: z.number().int().min(0).max(86_400).optional() });
  app.post("/v1/agent/gate/:id/delivery", async (request, reply) => { const b = deliveryBody.safeParse(request.body); if (!b.success) return reply.code(422).send({ error: "invalid payload", details: b.error.flatten() }); const { channel: _c, ...outcome } = b.data; const ok = await recordDelivery((request.params as { id: string }).id, outcome as never); return ok ? reply.send({ success: true }) : reply.code(404).send({ error: "not found" }); });
  app.post("/v1/agent/gate/deliveries/claim", async (request) => { const limit = Math.min(20, Math.max(1, Number((request.body as { limit?: number })?.limit ?? 5))); return { items: await claimPendingDeliveries(limit) }; });
  app.get("/v1/agent/gate/decisions", async () => gateDecisions());
  app.get("/v1/desktop/gate/opportunities", async (request, reply) => { const since = (request.query as { since?: string }).since; if (since && Number.isNaN(Date.parse(since))) return reply.code(422).send({ error: "since must be an ISO date" }); return { items: await gateForDesktop(since) }; });
  const gateStatusBody = z.object({ gate_status: z.enum(GATE_STATUSES), linked_job_id: z.string().max(100).optional() });
  app.post("/v1/desktop/gate/:id/status", async (request, reply) => { const body = gateStatusBody.safeParse(request.body); if (!body.success) return reply.code(422).send({ error: "invalid payload", details: body.error.flatten() }); const ok = await setGateStatus((request.params as { id: string }).id, body.data.gate_status, body.data.linked_job_id); return ok ? reply.send({ success: true }) : reply.code(404).send({ error: "not found" }); });
  return app;
}
