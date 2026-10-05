import http from "node:http";
import pg from "pg";
import { SCHEMA_SQL, acknowledgeRecord, basicValidation, claimRecord, cleanupImported, deleteImported, enqueue, extractRecord, readyRecords, secureEqual } from "./gateway.mjs";
const { Pool } = pg;
if (!process.env.DATABASE_URL || !process.env.DELIVERY_TOKEN || !process.env.GATE_INGEST_TOKEN) throw new Error("DATABASE_URL, DELIVERY_TOKEN and GATE_INGEST_TOKEN are required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8, ssl: process.env.PGSSLMODE === "disable" ? false : undefined });
let queueReady = false;
let queueError = "queue initialization pending";
void pool.query(SCHEMA_SQL).then(() => { queueReady = true; queueError = ""; }).catch((error) => { queueError = error instanceof Error ? error.message : "queue initialization failed"; console.error("queue initialization failed", queueError); });
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const bearer = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1];
const deliveryAuthorized = (req) => secureEqual(bearer(req) ?? req.headers["x-delivery-token"], process.env.DELIVERY_TOKEN);
const bridgeAuthorized = (req) => secureEqual(bearer(req), process.env.GATE_INGEST_TOKEN);
const lifecycle = (phase, fields) => {
  const url = process.env.LIFECYCLE_RELAY_URL, token = process.env.LIFECYCLE_EVENT_TOKEN;
  if (!url || !token) return;
  void fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ source: "railway", prefix: "🚂 RAILWAY-GATE", phase, ...fields }), signal: AbortSignal.timeout(5000) })
    .then((response) => { if (!response.ok) console.warn(`lifecycle relay HTTP ${response.status}`); })
    .catch((error) => console.warn("lifecycle relay unavailable", error instanceof Error ? error.message : error));
};
const bodyOf = async (req) => { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) throw new Error("Payload too large"); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://railway.local"), path = url.pathname;
  if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true, service: "gate-delivery-gateway", version: "4.0", configured: true, bridge: queueReady ? "ready" : "postgres_pending" });
  if (!queueReady) return send(res, 503, { error: "discovery_queue_unavailable", detail: queueError.slice(0, 200) });
  try {
    if (req.method === "GET" && path === "/v1/opportunities") {
      if (!bridgeAuthorized(req)) return send(res, 401, { error: "unauthorized" });
      if (url.searchParams.get("status") !== "ready") return send(res, 422, { error: "only status=ready is supported" });
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
      return send(res, 200, { items: await readyRecords(pool, limit) });
    }
    const match = /^\/v1\/opportunities\/([0-9a-f-]{36})\/(claim|ack)$/.exec(path);
    if (match && req.method === "POST") {
      if (!bridgeAuthorized(req)) return send(res, 401, { error: "unauthorized" });
      const body = await bodyOf(req);
      if (match[2] === "claim") {
        const row = await claimRecord(pool, match[1], Number(body?.lease_seconds ?? 120));
        return row ? send(res, 200, row) : send(res, 409, { error: "not_ready_or_claimed" });
      }
      if (typeof body?.lease_token !== "string" || typeof body?.gate_opportunity_id !== "string") return send(res, 422, { error: "lease_token and gate_opportunity_id are required" });
      const row = await acknowledgeRecord(pool, match[1], body.lease_token, body.gate_opportunity_id, typeof body.fingerprint === "string" ? body.fingerprint : null);
      return row ? send(res, 200, { ok: true, status: "imported", ...row }) : send(res, 409, { error: "invalid_or_expired_lease" });
    }
    const deleteMatch = /^\/v1\/opportunities\/([0-9a-f-]{36})$/.exec(path);
    if (deleteMatch && req.method === "DELETE") {
      if (!bridgeAuthorized(req)) return send(res, 401, { error: "unauthorized" });
      const row = await deleteImported(pool, deleteMatch[1]);
      return row ? send(res, 200, { ok: true, deleted: true, ...row }) : send(res, 409, { error: "only_imported_records_may_be_deleted" });
    }
    if (req.method !== "POST" || !new Set(["/v1/deliver", "/api/gate"]).has(path)) return send(res, 404, { error: "not found" });
    if (!deliveryAuthorized(req)) return send(res, 401, { error: "unauthorized" });
    const record = extractRecord(await bodyOf(req));
    const invalid = basicValidation(record);
    if (invalid) return send(res, 422, { error: invalid });
    const queued = await enqueue(pool, record);
    console.log(`accepted queue_id=${queued.id} fingerprint=${queued.fingerprint}`);
    lifecycle("stored_in_railway", { company: record.company?.name, role: record.opportunity?.title });
    return send(res, 202, { ok: true, accepted: true, queue_id: queued.id, fingerprint: queued.fingerprint, status: "ready" });
  } catch (error) { const message = error instanceof Error ? error.message : "invalid request"; return send(res, message === "Payload too large" ? 413 : 400, { error: message.slice(0, 300) }); }
});
const cleanup = setInterval(() => void cleanupImported(pool).then((count) => { if (count) console.log(`cleaned imported=${count}`); }).catch((error) => console.error("bridge cleanup failed", error.message)), 60 * 60_000);
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`GATE gateway ready port=${port}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { clearInterval(cleanup); server.close(() => void pool.end().then(() => process.exit(0))); });
