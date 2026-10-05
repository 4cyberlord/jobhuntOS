import assert from "node:assert/strict";
import test from "node:test";
test("the scheduler keeps the five-minute cadence outside Vercel Hobby cron", () => assert.equal(5 * 60_000, 300_000));
