import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { agentOpportunitySchema, containsSensitiveKey, duplicateKey, GATE_STATUSES, normalizeIncoming, parseGatePayload, searchProfile, type LegacyGate } from "@job-hunt-os/contracts";
import { timingSafeEqual } from "node:crypto";
import { verifyPassword } from "./auth.js";
import { updateFor, type LatestJson, type ReleaseAsset } from "./updates.js";
import { audit, authBlocked, claimPendingDeliveries, enrichCompanyById, enrichPending, database, gateDecisions, gateForDesktop, ingestGate, recordAuthFailure, recordDelivery, agentKeyOk, getGithub, createSession, endSession, getOwner, sessionValid, setGateStatus, upsertPending, WORKSPACE_COLLECTIONS, workspaceSync, FILE_CHUNK, commitFile, fileMeta, getFileChunk, putFileChunk, removeFile, type GateIngestResult } from "./repository.js";
import { acknowledgeOutlookMessages, beginOutlookAuthorization, completeOutlookAuthorization, disconnectOutlook, markOutlookSyncError, outlookStatus, pollOutlookInbox, queuedOutlookMessages } from "./outlook.js";
import { importGateBridge } from "./gate-bridge.js";
import { companyWorkbookConfigured, syncCompanyIntelligenceWorkbook } from "./company-excel.js";

const sameKey = (given: string | undefined, wanted: string | undefined) => { if (!given || !wanted) return false; const a = Buffer.from(given), b = Buffer.from(wanted); return a.length === b.length && timingSafeEqual(a, b); };

const legacyGateResult = (r: GateIngestResult) => ({ gate_opportunity_id: r.gate_opportunity_id, gate_status: r.gate_status, duplicate: r.duplicate, ...(r.discarded ? { discarded: true } : {}), ...(r.existing_job_id ? { existing_job_id: r.existing_job_id } : {}) });
export function gateIngestView(r: GateIngestResult, includeOpportunity: boolean) {
  const legacy = legacyGateResult(r);
  const stored = { ok: !r.discarded, gate_opportunity_id: r.gate_opportunity_id, fingerprint: r.fingerprint ?? null, duplicate: r.duplicate, gate_status: r.gate_status, ...(r.discarded ? { discarded: true } : {}) };
  const delivery = {
    telegram: r.telegram ? { ...r.telegram } : { status: r.discarded ? "skipped" : "unknown" },
    desktop: { status: r.discarded ? "unavailable" : "available" },
  };
  return { legacy, stored, delivery, ...(includeOpportunity && r.opportunity ? { opportunity: r.opportunity } : {}) };
}

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
    // Microsoft redirects to this one endpoint without our desktop session; its opaque, one-use OAuth state is the authorization.
    if (request.url.startsWith("/v1/desktop/outlook/callback")) return;
    const role = ROLES.find(([prefix]) => request.url.startsWith(prefix));
    if (!role || request.method === "OPTIONS") return;
    const [, check, blockFirst] = role;
    if (blockFirst && await authBlocked(request.ip)) return reply.code(429).send({ error: "too many failed attempts, try again later" });
    if (await check(bearer(request))) return;
    if (!blockFirst && await authBlocked(request.ip)) return reply.code(429).send({ error: "too many failed attempts, try again later" });
    await recordAuthFailure(request.ip); return reply.code(401).send({ error: "unauthorized" });
  });
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store"); });
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/v1/internal/outlook/sync") && !request.url.startsWith("/v1/internal/gate-bridge/import") && !request.url.startsWith("/v1/internal/company-intelligence/sync")) return;
    const expected = request.url.startsWith("/v1/internal/gate-bridge/import") ? process.env.GATE_BRIDGE_CRON_SECRET : process.env.CRON_SECRET;
    if (!sameKey(request.headers.authorization?.replace(/^Bearer\s+/i, ""), expected)) return reply.code(401).send({ error: "unauthorized" });
  });
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
  // Outlook is deliberately server-owned: the desktop receives only queued message metadata, never Graph OAuth tokens.
  app.get("/v1/desktop/outlook/status", async () => outlookStatus());
  app.post("/v1/desktop/outlook/authorize", async (_request, reply) => {
    try { return await beginOutlookAuthorization(); } catch (e) { return reply.code(503).send({ error: e instanceof Error ? e.message : "Outlook is unavailable." }); }
  });
  app.get("/v1/desktop/outlook/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    try {
      if (q.error || !q.code || !q.state) throw new Error(q.error_description ?? q.error ?? "Microsoft did not complete authorization.");
      await completeOutlookAuthorization(q.code, q.state);
      return reply.type("text/html").send("<!doctype html><title>Outlook connected</title><body style='font-family:system-ui;padding:3rem'><h1>Outlook connected</h1><p>You can close this window and return to Job Hunt OS.</p></body>");
    } catch (e) { return reply.code(400).type("text/html").send(`<!doctype html><title>Outlook connection failed</title><body style='font-family:system-ui;padding:3rem'><h1>Outlook connection failed</h1><p>${String(e instanceof Error ? e.message : e).replace(/</g, "&lt;")}</p></body>`); }
  });
  app.post("/v1/desktop/outlook/sync", async (_request, reply) => {
    try { const poll = await pollOutlookInbox(); return { ...poll, messages: await queuedOutlookMessages() }; } catch (e) { await markOutlookSyncError(e); return reply.code(502).send({ error: e instanceof Error ? e.message : "Outlook sync failed." }); }
  });
  app.post("/v1/desktop/outlook/ack", async (request, reply) => {
    const body = z.object({ ids: z.array(z.string().min(1).max(500)).max(100) }).safeParse(request.body);
    if (!body.success) return reply.code(422).send({ error: "invalid acknowledgement" });
    await acknowledgeOutlookMessages(body.data.ids); return { ok: true };
  });
  app.delete("/v1/desktop/outlook", async () => { await disconnectOutlook(); return { ok: true }; });
  app.post("/v1/internal/outlook/sync", async (_request, reply) => {
    try { return await pollOutlookInbox(); } catch (e) { await markOutlookSyncError(e); return reply.code(502).send({ error: e instanceof Error ? e.message : "Outlook sync failed." }); }
  });
  app.get("/v1/desktop/company-intelligence/excel/status", async () => ({ configured: companyWorkbookConfigured() }));
  app.post("/v1/desktop/company-intelligence/excel/sync", async (_request, reply) => {
    if (!companyWorkbookConfigured()) return reply.code(503).send({ error: "Company Intelligence workbook is not configured." });
    try { return await syncCompanyIntelligenceWorkbook(); }
    catch (e) { return reply.code(502).send({ error: e instanceof Error ? e.message : "Workbook sync failed." }); }
  });
  app.post("/v1/internal/company-intelligence/sync", async (_request, reply) => {
    if (!companyWorkbookConfigured()) return reply.code(503).send({ error: "Company Intelligence workbook is not configured." });
    try { return await syncCompanyIntelligenceWorkbook(); }
    catch (e) { return reply.code(502).send({ error: e instanceof Error ? e.message : "Workbook sync failed." }); }
  });
  // Cloudflare invokes this every minute. The desktop never sees bridge URLs or credentials.
  app.post("/v1/internal/gate-bridge/import", async (request, reply) => {
    try { return await importGateBridge(); }
    catch (e) {
      request.log.error({ err: e instanceof Error ? e.message : "Bridge import failed." }, "gate bridge import failed");
      return reply.code(502).send({ error: e instanceof Error ? e.message : "Bridge import failed." });
    }
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
  app.get("/health", async () => ({ ok: true, service: "job-hunt-os-api", version: "2026.10.06-automated-cicd" }));
  app.get("/v1/agent/search-profile", async () => searchProfile);
  app.post("/v1/agent/opportunities", async (request, reply) => { if (containsSensitiveKey(request.body)) return reply.code(400).send({ error: "sensitive fields are forbidden" }); const parsed = agentOpportunitySchema.safeParse(request.body); if (!parsed.success) return reply.code(422).send({ error: "invalid payload", details: parsed.error.flatten() }); const item = await upsertPending(parsed.data, duplicateKey(parsed.data)); await audit("agent.opportunity.upsert", parsed.data.externalId); return reply.code(201).send({ id: item?._id, reviewStatus: "pending_review" }); });
  app.patch("/v1/agent/opportunities/:externalId", async (request, reply) => { const body = request.body as { postingStatus?: "open" | "closed" | "reposted" }; if (!body?.postingStatus) return reply.code(422).send({ error: "postingStatus required" }); const d = await database(); const result = await d.collection("opportunities").updateOne({ externalId: (request.params as { externalId: string }).externalId }, { $set: { postingStatus: body.postingStatus, updatedAt: new Date() } }); await audit("agent.opportunity.status", (request.params as { externalId: string }).externalId); return reply.send({ updated: result.matchedCount === 1 }); });
  app.get("/v1/agent/decisions", async () => { const d = await database(); return d.collection("opportunities").find({ reviewStatus: { $in: ["approved", "dismissed", "archived"] } }, { projection: { externalId: 1, reviewStatus: 1, updatedAt: 1 } }).toArray(); });
  app.get("/v1/desktop/notifications", async () => { const d = await database(); const alerts = await d.collection("notifications").find({ deliveredAt: null }).sort({ createdAt: 1 }).limit(20).toArray(); if (alerts.length) await d.collection("notifications").updateMany({ _id: { $in: alerts.map(a => a._id) } }, { $set: { deliveredAt: new Date() } }); return alerts.map(({ title, body, urgency, opportunityExternalId }) => ({ title, body, urgency, opportunityExternalId })); });
  async function handleGateIngest(request: FastifyRequest, reply: FastifyReply) {
    if (containsSensitiveKey(request.body)) return reply.code(400).send({ error: "sensitive fields are forbidden" });
    const parsed = parseGatePayload(request.body);
    if (!parsed.ok) {
      request.log.warn({ gateValidation: parsed.error, schemaVersion: (request.body as { schema_version?: unknown } | null)?.schema_version }, "GATE payload rejected");
      if (parsed.isBatch && parsed.errors) return reply.code(422).send({
        success: false, partial: false, error: "invalid payload", details: parsed.error,
        results: parsed.errors.map((e) => ({ ok: false, index: e.index, error: e.error })),
        summary: { received: parsed.received ?? parsed.errors.length, valid: 0, invalid: parsed.errors.length, created: 0, duplicates: 0, discarded: 0 },
      });
      return reply.code(422).send({ error: "invalid payload", details: parsed.error });
    }
    const results: Record<string, unknown>[] = [];
    let singleView: ReturnType<typeof gateIngestView> | undefined;
    const summary = { received: parsed.received, valid: parsed.items.length, invalid: parsed.errors.length, created: 0, duplicates: 0, discarded: 0 };
    for (const { index, item } of parsed.indexedItems) {
      const r = await ingestGate(item);
      if (r.discarded) summary.discarded++; else if (r.duplicate) summary.duplicates++; else summary.created++;
      const view = gateIngestView(r, false);
      if (!parsed.isBatch) singleView = gateIngestView(r, true);
      results.push({ ok: true, index, ...view.legacy, stored: view.stored, delivery: view.delivery });
    }
    results.push(...parsed.errors.map((e) => ({ ok: false, index: e.index, error: e.error })));
    results.sort((a, b) => Number(a.index) - Number(b.index));
    const code = summary.created ? 201 : 200;
    if (parsed.isBatch) return reply.code(code).send({ success: parsed.errors.length === 0, ...(parsed.errors.length ? { partial: true } : {}), results, summary });
    return reply.code(code).send({ success: true, result: singleView!.legacy, stored: singleView!.stored, delivery: singleView!.delivery, ...(singleView!.opportunity ? { opportunity: singleView!.opportunity } : {}) });
  }
  // GATE 2.x can include a bounded original-posting snapshot; stay below common serverless 4.5 MB request limits.
  app.post("/v1/agent/gate/opportunities", { bodyLimit: 4 * 1024 * 1024 }, handleGateIngest);
  app.post("/v1/agent/gate/opportunities/batch", { bodyLimit: 4 * 1024 * 1024 }, handleGateIngest);
  // Relay-era payloads (Railway worker / Vercel relay / Telegram backfill): normalized into full envelopes, then stored like any discovery.
  app.post("/v1/agent/gate/legacy", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
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
    results.push({ ok: true, gate_opportunity_id: r.gate_opportunity_id, gate_status: r.gate_status, duplicate: r.duplicate, telegram_status: r.telegram?.status });
    }
    return reply.code(summary.created ? 201 : 200).send({ success: summary.invalid < list.length, results, summary });
  });
  const deliveryBody = z.object({ channel: z.literal("telegram"), status: z.enum(["sent", "failed", "rate_limited"]), message_id: z.number().int().optional(), error: z.string().max(500).optional(), retry_after: z.number().int().min(0).max(86_400).optional() });
  app.post("/v1/agent/gate/:id/delivery", async (request, reply) => { const b = deliveryBody.safeParse(request.body); if (!b.success) return reply.code(422).send({ error: "invalid payload", details: b.error.flatten() }); const { channel: _c, ...outcome } = b.data; const ok = await recordDelivery((request.params as { id: string }).id, outcome as never); return ok ? reply.send({ success: true }) : reply.code(404).send({ error: "not found" }); });
  app.post("/v1/agent/gate/deliveries/claim", async (request) => { const limit = Math.min(20, Math.max(1, Number((request.body as { limit?: number })?.limit ?? 5))); return { items: await claimPendingDeliveries(limit) }; });
  app.post("/v1/agent/gate/enrich", async (request) => { const b = request.body as { limit?: number; force?: boolean } | undefined; return enrichPending(Math.min(9, Math.max(1, Number(b?.limit ?? 6))), b?.force === true); });
  app.get("/v1/agent/gate/decisions", async () => gateDecisions());
  app.get("/v1/desktop/company-intelligence", async (_request, reply) => {
    const base = (process.env.GATE_DISCOVERY_URL || "https://gate-discovery.4cyberlord.workers.dev").replace(/\/+$/, "");
    const response = await fetch(`${base}/company-intelligence`, { headers: { "user-agent": "job-hunt-os-api/1.0" } });
    if (!response.ok) return reply.code(502).send({ error: `company intelligence upstream returned ${response.status}` });
    return reply.send(await response.json());
  });
  app.get("/v1/desktop/gate/opportunities", async (request, reply) => { const q = request.query as { since?: string; after_id?: string }; if (q.since && Number.isNaN(Date.parse(q.since))) return reply.code(422).send({ error: "since must be an ISO date" }); return gateForDesktop(q.since, q.after_id); });
  const gateStatusBody = z.object({ gate_status: z.enum(GATE_STATUSES), linked_job_id: z.string().max(100).optional() });
  app.post("/v1/desktop/gate/:id/status", async (request, reply) => { const body = gateStatusBody.safeParse(request.body); if (!body.success) return reply.code(422).send({ error: "invalid payload", details: body.error.flatten() }); const ok = await setGateStatus((request.params as { id: string }).id, body.data.gate_status, body.data.linked_job_id); return ok ? reply.send({ success: true }) : reply.code(404).send({ error: "not found" }); });
  const workspaceBody = z.object({
    since: z.string().datetime().default("1970-01-01T00:00:00.000Z"),
    cursor_id: z.string().max(300).optional(),
    changes: z.array(z.object({ c: z.enum(WORKSPACE_COLLECTIONS), id: z.string().min(1).max(120), u: z.number().int().positive(), deleted: z.boolean().optional(), doc: z.record(z.string(), z.unknown()).optional() })).max(300).default([]),
  });
  app.post("/v1/desktop/workspace/sync", { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const body = workspaceBody.safeParse(request.body);
    if (!body.success) return reply.code(422).send({ error: "invalid payload", details: body.error.flatten() });
    if (body.data.changes.some((ch) => !ch.deleted && !ch.doc)) return reply.code(422).send({ error: "a change needs a doc unless it is a deletion" });
    // Sealed vault entries (AES-GCM ciphertext) and the vault's salt/verifier legitimately use words like "secret", so only they are exempt from the key check.
    if (body.data.changes.some((ch) => ch.c !== "credentials" && ch.c !== "vault" && containsSensitiveKey(ch.doc))) return reply.code(400).send({ error: "sensitive fields are forbidden" });
    return workspaceSync(body.data.changes, body.data.since, body.data.cursor_id);
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
