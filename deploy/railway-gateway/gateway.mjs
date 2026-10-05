import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
export const queueFingerprint = (record) => {
  const supplied = record?.identity?.fingerprint ?? record?.metadata?.fingerprint;
  return typeof supplied === "string" && supplied.trim() ? supplied.trim() : `sha256:${createHash("sha256").update(stableJson(record)).digest("hex")}`;
};
export const secureEqual = (left, right) => {
  if (!left || !right) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const extractRecord = (body) => body?.gate_record && typeof body.gate_record === "object" ? body.gate_record : body;
export function basicValidation(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "A GATE opportunity object is required";
  if (!record.company?.name || !record.opportunity?.title) return "company.name and opportunity.title are required";
  const url = record.opportunity?.application?.apply_url ?? record.original_posting?.canonical_url;
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return "an HTTPS apply or canonical posting URL is required";
  return null;
}
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS gate_discovery_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_record JSONB NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  gate_opportunity_id TEXT,
  telegram_message_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE gate_discovery_queue ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE gate_discovery_queue ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE gate_discovery_queue ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS gate_discovery_queue_ready_idx ON gate_discovery_queue (status, discovered_at, id);
CREATE INDEX IF NOT EXISTS gate_discovery_queue_imported_idx ON gate_discovery_queue (imported_at) WHERE status = 'imported';
`;
export async function enqueue(pool, record) {
  const id = randomUUID(), fingerprint = queueFingerprint(record);
  const canonicalUrl = record?.original_posting?.canonical_url ?? record?.opportunity?.application?.apply_url;
  const payloadSha256 = createHash("sha256").update(stableJson(record)).digest("hex");
  const result = await pool.query(
    `INSERT INTO gate_discovery_queue (id, gate_record, fingerprint, company_name, job_title, canonical_url, payload_sha256, status)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, 'ready')
     ON CONFLICT (fingerprint) DO UPDATE SET
       gate_record = EXCLUDED.gate_record, company_name = EXCLUDED.company_name, job_title = EXCLUDED.job_title,
       canonical_url = EXCLUDED.canonical_url, payload_sha256 = EXCLUDED.payload_sha256,
       status = CASE WHEN gate_discovery_queue.status = 'claimed' AND gate_discovery_queue.lease_expires_at > NOW() THEN 'claimed' ELSE 'ready' END,
       lease_token = CASE WHEN gate_discovery_queue.status = 'claimed' AND gate_discovery_queue.lease_expires_at > NOW() THEN gate_discovery_queue.lease_token ELSE NULL END,
       lease_expires_at = CASE WHEN gate_discovery_queue.status = 'claimed' AND gate_discovery_queue.lease_expires_at > NOW() THEN gate_discovery_queue.lease_expires_at ELSE NULL END,
       imported_at = NULL, last_error = NULL, updated_at = NOW()
     RETURNING id`,
    [id, JSON.stringify(record), fingerprint, record.company.name, record.opportunity.title, canonicalUrl, payloadSha256],
  );
  const queueId = result.rows[0]?.id ?? id;
  await pool.query("SELECT pg_notify('gate_opportunity_discovered', $1)", [queueId]);
  return { id: queueId, fingerprint };
}

export async function readyRecords(pool, limit) {
  const result = await pool.query(
    `SELECT id, fingerprint, company_name, job_title, canonical_url, discovered_at
       FROM gate_discovery_queue
      WHERE status = 'ready' OR (status = 'claimed' AND lease_expires_at <= NOW())
      ORDER BY discovered_at ASC, id ASC LIMIT $1`, [limit]);
  return result.rows;
}

export async function claimRecord(pool, id, leaseSeconds = 120) {
  const token = randomUUID();
  const result = await pool.query(
    `WITH candidate AS (
       SELECT id FROM gate_discovery_queue
        WHERE id = $1 AND (status = 'ready' OR (status = 'claimed' AND lease_expires_at <= NOW()))
        FOR UPDATE SKIP LOCKED
     )
     UPDATE gate_discovery_queue q
        SET status = 'claimed', lease_token = $2, lease_expires_at = NOW() + ($3 * INTERVAL '1 second'),
            attempt_count = COALESCE(attempt_count, 0) + 1, last_attempt_at = NOW(), updated_at = NOW()
       FROM candidate WHERE q.id = candidate.id
     RETURNING q.id, q.fingerprint, q.gate_record, q.lease_token, q.lease_expires_at`, [id, token, Math.min(300, Math.max(30, leaseSeconds))]);
  const row = result.rows[0];
  return row ? { id: row.id, fingerprint: row.fingerprint, envelope: row.gate_record, lease_token: row.lease_token, lease_expires_at: row.lease_expires_at } : null;
}

export async function acknowledgeRecord(pool, id, leaseToken, gateOpportunityId, fingerprint) {
  const result = await pool.query(
    `UPDATE gate_discovery_queue SET status = 'imported', gate_opportunity_id = $3, imported_at = NOW(),
       delivered_at = NOW(), lease_token = NULL, lease_expires_at = NULL, last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'claimed' AND lease_token = $2
        AND ($4::text IS NULL OR fingerprint = $4)
      RETURNING id, fingerprint, imported_at`, [id, leaseToken, gateOpportunityId, fingerprint ?? null]);
  return result.rows[0] ?? null;
}

export async function deleteImported(pool, id) {
  const result = await pool.query("DELETE FROM gate_discovery_queue WHERE id = $1 AND status = 'imported' RETURNING id, fingerprint", [id]);
  return result.rows[0] ?? null;
}

export async function cleanupImported(pool) {
  const result = await pool.query("DELETE FROM gate_discovery_queue WHERE status = 'imported' AND imported_at <= NOW() - INTERVAL '24 hours'");
  return result.rowCount ?? 0;
}
