const url = process.env.RELAY_RETRY_URL;
const token = process.env.GATE_INGEST_TOKEN;
if (!url || !token) throw new Error("RELAY_RETRY_URL and GATE_INGEST_TOKEN are required");
const everyMs = 5 * 60_000;
let running = false;
async function drain() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Relay retry HTTP ${response.status}`);
    const result = await response.json();
    console.log(`relay outbox claimed=${result.claimed ?? 0} sent=${result.sent ?? 0} failed=${result.failed ?? 0}`);
  } catch (error) { console.error(`relay outbox trigger failed: ${error instanceof Error ? error.message : "unknown error"}`); }
  finally { running = false; }
}
await drain();
const timer = setInterval(() => void drain(), everyMs);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { clearInterval(timer); process.exit(0); });
