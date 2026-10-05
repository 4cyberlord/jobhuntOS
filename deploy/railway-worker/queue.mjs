const MAX_ERROR = 1000;
export const retryDelayMs = (attempt) => Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60_000;
export const boundedError = (value) => String(value ?? "Unknown delivery failure").replace(/\s+/g, " ").slice(0, MAX_ERROR);
export function classifyApiResponse(status, body) {
  if (status >= 200 && status < 300 && body?.success === true && body?.stored?.ok === true && body.stored.gate_opportunity_id) return { kind: "stored", gateOpportunityId: body.stored.gate_opportunity_id };
  if (status === 422) return { kind: "terminal", error: body?.error ?? "GATE payload rejected" };
  if (status === 401 || status === 403) return { kind: "terminal", error: "GATE API authorization failed" };
  if (status === 429 || status >= 500 || status === 0) return { kind: "retry", error: body?.error ?? `GATE API HTTP ${status || "network"}` };
  return { kind: "terminal", error: body?.error ?? `Unexpected GATE API HTTP ${status}` };
}
export const CLAIM_SQL = `
WITH candidate AS (
  SELECT id FROM gate_discovery_queue
  WHERE status = 'discovered'
     OR (status = 'retrying' AND last_attempt_at <= NOW() - (CASE
          WHEN attempt_count >= 4 THEN INTERVAL '1 hour'
          WHEN attempt_count = 3 THEN INTERVAL '15 minutes'
          WHEN attempt_count = 2 THEN INTERVAL '5 minutes'
          ELSE INTERVAL '1 minute' END))
     OR (status = 'delivering' AND last_attempt_at < NOW() - INTERVAL '2 minutes')
  ORDER BY discovered_at ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1
)
UPDATE gate_discovery_queue q SET status = 'delivering', attempt_count = COALESCE(q.attempt_count, 0) + 1, last_attempt_at = NOW(), updated_at = NOW()
FROM candidate WHERE q.id = candidate.id
RETURNING q.id, q.gate_record, q.fingerprint, q.attempt_count;`;
export async function claimOne(pool) { const result = await pool.query(CLAIM_SQL); return result.rows[0] ?? null; }
export async function markStored(pool, row, gateOpportunityId) { await pool.query("UPDATE gate_discovery_queue SET status = 'delivered', gate_opportunity_id = $2, delivered_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1", [row.id, gateOpportunityId]); }
export async function markFailure(pool, row, result) {
  const status = result.kind === "retry" && row.attempt_count < 6 ? "retrying" : "failed";
  await pool.query("UPDATE gate_discovery_queue SET status = $2, last_error = $3, updated_at = NOW() WHERE id = $1", [row.id, status, boundedError(result.error)]);
}
