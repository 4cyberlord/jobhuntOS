import pg from "pg";
import { claimOne, classifyApiResponse, markFailure, markStored } from "./queue.mjs";

const { Pool, Client } = pg;
const required = ["DATABASE_URL", "GATE_API_URL", "AGENT_API_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, ssl: process.env.PGSSLMODE === "disable" ? false : undefined });
const apiUrl = `${process.env.GATE_API_URL.replace(/\/+$/, "")}/v1/agent/gate/opportunities`;
let draining = false;
let stopping = false;

async function submit(row) {
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.AGENT_API_KEY}` },
      body: JSON.stringify(row.gate_record), signal: AbortSignal.timeout(30_000),
    });
  } catch (error) { return { kind: "retry", error: error instanceof Error ? error.message : "Network failure" }; }
  let body;
  try { body = await response.json(); } catch { body = { error: "GATE API returned invalid JSON" }; }
  return classifyApiResponse(response.status, body);
}
async function drain() {
  if (draining || stopping) return;
  draining = true;
  try {
    for (;;) {
      const row = await claimOne(pool);
      if (!row) return;
      const outcome = await submit(row);
      if (outcome.kind === "stored") { await markStored(pool, row, outcome.gateOpportunityId); console.log(`stored queue_id=${row.id} fingerprint=${row.fingerprint}`); }
      else { await markFailure(pool, row, outcome); console.warn(`${outcome.kind} queue_id=${row.id} fingerprint=${row.fingerprint}`); }
    }
  } finally { draining = false; }
}
const listener = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === "disable" ? false : undefined });
await listener.connect();
await listener.query("LISTEN gate_opportunity_discovered");
listener.on("notification", () => { void drain().catch((error) => console.error("queue drain failed", error.message)); });
listener.on("error", (error) => console.error("queue listener error", error.message));
const scan = setInterval(() => { void drain().catch((error) => console.error("queue scan failed", error.message)); }, 60_000);
await drain();
console.log("GATE queue worker ready");
async function shutdown(signal) { stopping = true; clearInterval(scan); console.log(`received ${signal}; shutting down`); await listener.end().catch(() => undefined); await pool.end().catch(() => undefined); process.exit(0); }
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
