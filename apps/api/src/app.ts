import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { agentOpportunitySchema, containsSensitiveKey, duplicateKey, GATE_STATUSES, normalizeIncoming, parseGatePayload, searchProfile, type LegacyGate } from "@job-hunt-os/contracts";
import { timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./auth.js";
import { updateFor, type LatestJson, type ReleaseAsset } from "./updates.js";
import { audit, authBlocked, claimPendingDeliveries, enrichCompanyById, enrichPending, database, gateDecisions, gateForDesktop, ingestGate, recordAuthFailure, recordDelivery, agentKeyOk, getGithub, createSession, endSession, getOwner, sessionValid, setGateStatus, upsertPending, WORKSPACE_COLLECTIONS, workspaceSync, FILE_CHUNK, commitFile, fileMeta, getFileChunk, putFileChunk, removeFile } from "./repository.js";

const sameKey = (given: string | undefined, wanted: string | undefined) => { if (!given || !wanted) return false; const a = Buffer.from(given), b = Buffer.from(wanted); return a.length === b.length && timingSafeEqual(a, b); };

/** Builds the API without listening, so it can run as a local server or inside a serverless function. */
export async function buildApp() {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.body"] }, trustProxy: !!process.env.VERCEL });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  // The desktop app (Tauri webview or the Vite dev server) calls /v1/desktop from another origin, so allow exactly those origins.
  const desktopOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", ...(process.env.DESKTOP_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [])]);
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/desktop") && !request.url.startsWith("/v1/auth")) return;
    const origin = request.headers.origin;
    if (origin && desktopOrigins.has(origin)) reply.header("Access-Control-Allow-Origin", origin).header("Vary", "Origin").header("Access-Control-Allow-Headers", "Authorization, Content-Type").header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  // /v1/agent takes the agent key; /v1/desktop takes a session token from signing in. Both are checked against hashes in the database,
  // compared in constant time. Repeated failures from one address are throttled (stored in MongoDB because serverless instances share no memory).
  // A valid session never pays for other people's failures: for /v1/desktop the token is checked first and only a bad one reaches the throttle.
  const ROLES: [string, (token: string | undefined) => Promise<boolean>, boolean][] = [["/v1/agent", agentKeyOk, true], ["/v1/desktop", sessionValid, false]];
  const bearer = (request: FastifyRequest) => request.headers.authorization?.replace(/^Bearer\s+/i, "");
  app.addHook("onRequest", async (request, reply) => {
    const role = ROLES.find(([prefix]) => request.url.startsWith(prefix));
    if (!role || request.method === "OPTIONS") return;
    const [, check, blockFirst] = role;
    if (blockFirst && await authBlocked(request.ip)) return reply.code(429).send({ error: "too many failed attempts, try again later" });
    if (await check(bearer(request))) return;
    if (!blockFirst && await authBlocked(request.ip)) return reply.code(429).send({ error: "too many failed attempts, try again later" });
    await recordAuthFailure(request.ip); return reply.code(401).send({ error: "unauthorized" });
  });
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
  // Sign-in for the desktop app: the owner's email + password (stored as a salted hash in the database) buy a session token.
  const loginBody = z.object({ email: z.string().max(200), password: z.string().min(1).max(200), keep: z.boolean().optional() });
  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const owner = await getOwner();
    if (!owner) return reply.code(503).send({ error: "sign-in is not set up on the server yet" });
    if (await authBlocked(request.ip)) return reply.code(429).send({ error: "too many failed attempts, try again later" });
    const body = loginBody.safeParse(request.body);
    if (!body.success) return reply.code(422).send({ error: "invalid payload" });
    const emailOk = sameKey(body.data.email.trim().toLowerCase(), owner.email.trim().toLowerCase());
    const passwordOk = verifyPassword(body.data.password, owner.passwordHash); // both checks always run
    if (!(emailOk && passwordOk)) { await recordAuthFailure(request.ip); return reply.code(401).send({ error: "incorrect email or password" }); }
    return { syncKey: await createSession(body.data.keep === false ? 1 : 90) };
  });
  // App updates from a private GitHub repo (see updates.ts). The token lives in the database and never leaves the server.
  const GH = "https://api.github.com";
  const ghHeaders = (token: string, accept = "application/vnd.github+json") => ({ Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "job-hunt-os-api" });
  app.get("/v1/desktop/update", async (request, reply) => {
    const q = z.object({ current: z.string().max(40), target: z.string().max(20), arch: z.string().max(20) }).safeParse(request.query);
    if (!q.success) return reply.code(422).send({ error: "invalid query" });
    const gh = await getGithub();
    if (!gh) return reply.code(503).send({ error: "updates are not set up on the server yet" });
    const rel = await fetch(`${GH}/repos/${gh.repo}/releases/latest`, { headers: ghHeaders(gh.token) });
    if (rel.status === 404) return reply.code(204).send(); // no release published yet
    if (!rel.ok) return reply.code(502).send({ error: "could not read releases" });
    const release = (await rel.json()) as { assets: ReleaseAsset[] };
    const manifest = release.assets.find((a) => a.name === "latest.json");
    if (!manifest) return reply.code(204).send();
    const m = await fetch(`${GH}/repos/${gh.repo}/releases/assets/${manifest.id}`, { headers: ghHeaders(gh.token, "application/octet-stream"), redirect: "follow" });
    if (!m.ok) return reply.code(502).send({ error: "could not read the update manifest" });
    const origin = `https://${request.headers.host}`;
    const out = updateFor({ latest: (await m.json()) as LatestJson, assets: release.assets, ...q.data, assetUrl: (id) => `${origin}/v1/desktop/update/asset/${id}` });
    return out ?? reply.code(204).send();
  });
  app.get("/v1/desktop/update/asset/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const gh = await getGithub();
    if (!gh || !Number.isInteger(id) || id <= 0) return reply.code(404).send({ error: "not found" });
    // GitHub answers with a short-lived signed link; hand that to the app so the download does not pass through this function
    const r = await fetch(`${GH}/repos/${gh.repo}/releases/assets/${id}`, { headers: ghHeaders(gh.token, "application/octet-stream"), redirect: "manual" });
    const to = r.headers.get("location");
    return r.status >= 300 && r.status < 400 && to ? reply.redirect(to, 302) : reply.code(404).send({ error: "not found" });
  });
  app.delete("/v1/desktop/session", async (request) => { await endSession(bearer(request)); return { ok: true }; });
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
      if (r.created && list.length === 1) await Promise.race([enrichCompanyById(r.gate_opportunity_id), new Promise((res) => setTimeout(res, 6000))]).catch(() => undefined);
    results.push({ ok: true, gate_opportunity_id: r.gate_opportunity_id, gate_status: r.gate_status, duplicate: r.duplicate, telegram_status: r.telegram_status });
    }
    return reply.code(summary.created ? 201 : 200).send({ success: summary.invalid < list.length, results, summary });
  });
  const deliveryBody = z.object({ channel: z.literal("telegram"), status: z.enum(["sent", "failed", "rate_limited"]), message_id: z.number().int().optional(), error: z.string().max(500).optional(), retry_after: z.number().int().min(0).max(86_400).optional() });
  app.post("/v1/agent/gate/:id/delivery", async (request, reply) => { const b = deliveryBody.safeParse(request.body); if (!b.success) return reply.code(422).send({ error: "invalid payload", details: b.error.flatten() }); const { channel: _c, ...outcome } = b.data; const ok = await recordDelivery((request.params as { id: string }).id, outcome as never); return ok ? reply.send({ success: true }) : reply.code(404).send({ error: "not found" }); });
  app.post("/v1/agent/gate/deliveries/claim", async (request) => { const limit = Math.min(20, Math.max(1, Number((request.body as { limit?: number })?.limit ?? 5))); return { items: await claimPendingDeliveries(limit) }; });
  app.post("/v1/agent/gate/enrich", async (request) => { const b = request.body as { limit?: number; force?: boolean } | undefined; return enrichPending(Math.min(9, Math.max(1, Number(b?.limit ?? 6))), b?.force === true); });
  app.get("/v1/agent/gate/decisions", async () => gateDecisions());
  app.get("/v1/desktop/gate/opportunities", async (request, reply) => { const since = (request.query as { since?: string }).since; if (since && Number.isNaN(Date.parse(since))) return reply.code(422).send({ error: "since must be an ISO date" }); return { items: await gateForDesktop(since) }; });
  const gateStatusBody = z.object({ gate_status: z.enum(GATE_STATUSES), linked_job_id: z.string().max(100).optional() });
  app.post("/v1/desktop/gate/:id/status", async (request, reply) => { const body = gateStatusBody.safeParse(request.body); if (!body.success) return reply.code(422).send({ error: "invalid payload", details: body.error.flatten() }); const ok = await setGateStatus((request.params as { id: string }).id, body.data.gate_status, body.data.linked_job_id); return ok ? reply.send({ success: true }) : reply.code(404).send({ error: "not found" }); });
  const workspaceBody = z.object({
    since: z.string().datetime().default("1970-01-01T00:00:00.000Z"),
    changes: z.array(z.object({ c: z.enum(WORKSPACE_COLLECTIONS), id: z.string().min(1).max(120), u: z.number().int().positive(), deleted: z.boolean().optional(), doc: z.record(z.string(), z.unknown()).optional() })).max(300).default([]),
  });
  app.post("/v1/desktop/workspace/sync", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const body = workspaceBody.safeParse(request.body);
    if (!body.success) return reply.code(422).send({ error: "invalid payload", details: body.error.flatten() });
    if (body.data.changes.some((ch) => !ch.deleted && !ch.doc)) return reply.code(422).send({ error: "a change needs a doc unless it is a deletion" });
    // Sealed vault entries (AES-GCM ciphertext) and the vault's salt/verifier legitimately use words like "secret", so only they are exempt from the key check.
    if (body.data.changes.some((ch) => ch.c !== "credentials" && ch.c !== "vault" && containsSensitiveKey(ch.doc))) return reply.code(400).send({ error: "sensitive fields are forbidden" });
    return workspaceSync(body.data.changes, body.data.since);
  });

  // Document files, in chunks (each request stays under the serverless body cap)
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: FILE_CHUNK + 4096 }, (_req, body, done) => done(null, body));
  type FileParams = { id: string; n?: string };
  app.put("/v1/desktop/files/:id/:n", async (request, reply) => { const { id, n } = request.params as FileParams; const ok = Buffer.isBuffer(request.body) && await putFileChunk(id, Number(n), request.body); return ok ? { ok: true } : reply.code(422).send({ error: "invalid chunk" }); });
  app.post("/v1/desktop/files/:id/commit", async (request, reply) => { const b = z.object({ chunks: z.number().int().min(1).max(400), size: z.number().int().min(0), mime: z.string().max(200) }).safeParse(request.body); if (!b.success) return reply.code(422).send({ error: "invalid payload" }); return (await commitFile((request.params as FileParams).id, b.data)) ? { ok: true } : reply.code(409).send({ error: "upload incomplete" }); });
  app.get("/v1/desktop/files/:id", async (request, reply) => { const m = await fileMeta((request.params as FileParams).id); return m ? { chunks: m.chunks, size: m.size, mime: m.mime } : reply.code(404).send({ error: "not found" }); });
  app.get("/v1/desktop/files/:id/:n", async (request, reply) => { const { id, n } = request.params as FileParams; const buf = await getFileChunk(id, Number(n)); return buf ? reply.header("Content-Type", "application/octet-stream").send(buf) : reply.code(404).send({ error: "not found" }); });
  app.delete("/v1/desktop/files/:id", async (request, reply) => (await removeFile((request.params as FileParams).id)) ? { ok: true } : reply.code(422).send({ error: "invalid id" }));
  return app;
}
