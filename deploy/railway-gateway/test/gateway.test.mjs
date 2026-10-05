import assert from "node:assert/strict";
import test from "node:test";
import { SCHEMA_SQL, acknowledgeRecord, basicValidation, claimRecord, deleteImported, extractRecord, queueFingerprint, readyRecords, secureEqual, stableJson } from "../gateway.mjs";
const record = { company: { name: "Acme" }, opportunity: { title: "Intern", application: { apply_url: "https://careers.acme.test/1" } }, metadata: { fingerprint: "sha256:agent" } };
test("keeps an entire direct envelope or gate_record wrapper", () => { assert.equal(extractRecord({ gate_record: record }), record); assert.equal(extractRecord(record), record); assert.equal(basicValidation(record), null); });
test("rejects malformed discovery records before queueing", () => { assert.match(basicValidation({ company: {} }), /company.name/); assert.match(basicValidation({ company: { name: "A" }, opportunity: { title: "T", application: { apply_url: "http://bad" } } }), /HTTPS/); });
test("fingerprints are stable and supplied identities are retained", () => { assert.equal(queueFingerprint(record), "sha256:agent"); const a = { b: 1, a: [2, 3] }, b = { a: [2, 3], b: 1 }; assert.equal(stableJson(a), stableJson(b)); assert.equal(queueFingerprint(a), queueFingerprint(b)); });
test("uses timing-safe authorization and extends the deployed queue additively", () => { assert.equal(secureEqual("x", "x"), true); assert.equal(secureEqual("x", "y"), false); assert.match(SCHEMA_SQL, /fingerprint TEXT NOT NULL UNIQUE/); assert.match(SCHEMA_SQL, /ADD COLUMN IF NOT EXISTS lease_token/); assert.match(SCHEMA_SQL, /imported_at/); });
test("bridge operations use ready/claimed/imported states and a lease", async () => {
  const calls = []; const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: sql.includes("RETURNING q.id") ? [{ id: "id", fingerprint: "sha256:x", gate_record: record, lease_token: "lease" }] : sql.includes("RETURNING id, fingerprint, imported_at") ? [{ id: "id", fingerprint: "sha256:x" }] : sql.includes("RETURNING id, fingerprint") ? [{ id: "id", fingerprint: "sha256:x" }] : [] }; } };
  await readyRecords(pool, 5); const claimed = await claimRecord(pool, "id", 120); const acked = await acknowledgeRecord(pool, "id", "lease", "mongo", "sha256:x"); const deleted = await deleteImported(pool, "id");
  assert.equal(claimed.lease_token, "lease"); assert.equal(acked.fingerprint, "sha256:x"); assert.equal(deleted.id, "id");
  assert.match(calls[0].sql, /status = 'ready'/); assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/); assert.match(calls[1].sql, /status = 'claimed'/); assert.match(calls[2].sql, /status = 'imported'/); assert.match(calls[3].sql, /status = 'imported'/);
});
