// Railway worker: posts each opportunity in BACKFILL_JSON to the GATE relay, one request each.
// Service variables: RELAY_URL, GATE_INGEST_TOKEN (same value as on the Vercel relay), BACKFILL_JSON.
// The relay saves the record to the backend first, then notifies Telegram, so a rate limit can no longer lose a job.
// Set the service start command to:  node worker.mjs   (or paste this file's contents as the inline script)
const jobs = JSON.parse(process.env.BACKFILL_JSON ?? "[]");
const url = process.env.RELAY_URL;
const token = process.env.GATE_INGEST_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!url || !token) { console.error("RELAY_URL and GATE_INGEST_TOKEN are required"); process.exit(2); }
console.log(`START total=${jobs.length}`);
let sent = 0, failed = 0;
for (const [i, job] of jobs.entries()) {
  const label = `${i + 1}/${jobs.length} ${job.company?.name} - ${job.opportunity?.title}`;
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(job), signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    if (res.ok) { sent++; console.log(`OK ${label} :: ${body}`); } else { failed++; console.error(`FAILED ${label} HTTP ${res.status} :: ${body}`); }
  } catch (e) { failed++; console.error(`FAILED ${label} :: ${e.message}`); }
  await sleep(1500); // the relay queues and retries Telegram rate limits itself
}
console.log(`SUMMARY sent=${sent} failed=${failed} total=${jobs.length}`);
process.exit(failed ? 1 : 0);
