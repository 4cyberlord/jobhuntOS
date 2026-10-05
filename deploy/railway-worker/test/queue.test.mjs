import assert from "node:assert/strict";
import test from "node:test";
import { CLAIM_SQL, boundedError, classifyApiResponse, retryDelayMs } from "../queue.mjs";
test("accepts only a persisted direct-ingestion response", () => { assert.deepEqual(classifyApiResponse(201, { success: true, stored: { ok: true, gate_opportunity_id: "mongo-1" } }), { kind: "stored", gateOpportunityId: "mongo-1" }); assert.equal(classifyApiResponse(200, { success: true, stored: { ok: false } }).kind, "terminal"); });
test("classifies validation and transient failures safely", () => { assert.equal(classifyApiResponse(422, { error: "bad source" }).kind, "terminal"); assert.equal(classifyApiResponse(429, {}).kind, "retry"); assert.equal(classifyApiResponse(503, {}).kind, "retry"); assert.equal(classifyApiResponse(401, {}).kind, "terminal"); assert.equal(retryDelayMs(1), 60_000); assert.equal(retryDelayMs(7), 3_600_000); });
test("claim query is locked and recovers abandoned delivery rows", () => { assert.match(CLAIM_SQL, /FOR UPDATE SKIP LOCKED/); assert.match(CLAIM_SQL, /status = 'delivering'/); assert.match(CLAIM_SQL, /attempt_count/); });
test("errors are bounded", () => { assert.equal(boundedError(" x\n y "), " x y "); assert.equal(boundedError("x".repeat(5000)).length, 1000); });
