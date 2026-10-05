/** Recover the original official Immuta posting and enrich the legacy-slotted GATE record.
 * Run once: npx tsx apps/api/scripts/backfill-immuta.ts [--dry-run]
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { createHash } from "node:crypto";
config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const POSTING_URL = "https://jobs.lever.co/immuta/b9b21075-74a4-4b64-8f1b-f0be1fb0b24d";
const EXTERNAL_ID = "gate-immuta-software-engineering-intern-summe";
const clean = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>|<\/li>|<\/h[1-6]>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
const section = (html: string, heading: string) => {
  const start = html.search(new RegExp(`<h2[^>]*>\\s*<strong>${heading}<\\/strong>`, "i"));
  if (start < 0) return "";
  const tail = html.slice(start);
  const end = tail.slice(10).search(/<h2[^>]*>/i);
  return end < 0 ? tail : tail.slice(0, end);
};
const list = (html: string) => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => clean(m[1])).filter(Boolean);

async function main() {
  const res = await fetch(POSTING_URL, { headers: { "User-Agent": "Job-Hunt-OS recovery capture/1.0" } });
  if (!res.ok) throw new Error(`Lever returned ${res.status}`);
  const html = await res.text();
  const start = html.indexOf('data-qa="job-description"');
  const end = html.indexOf('data-qa="btn-apply-bottom"', start);
  if (start < 0 || end < 0) throw new Error("Lever page layout changed; job description could not be isolated");
  const raw = clean(html.slice(start, end));
  if (raw.length < 500) throw new Error("Recovered posting is unexpectedly short");
  const capturedAt = new Date().toISOString();
  const hash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  const responsibilities = list(section(html, "YOUR INTERNSHIP")).map((value) => ({ value, provenance: "stated", confidence: 1 }));
  const technologies = list(section(html, "TOOLS &amp; TECHNOLOGIES")).map((x) => x.replace(/^•\s*/, ""));
  const requirements = list(section(html, "WHAT WE’RE LOOKING FOR"));
  const required = requirements.filter((x) => !/\bis a plus\b/i.test(x)).map((skill) => ({ skill, provenance: "stated", confidence: 1 }));
  const preferred = requirements.filter((x) => /\bis a plus\b/i.test(x)).map((skill) => ({ skill, provenance: "stated", confidence: 1 }));
  const patch = {
    "envelope.schema_version": "2.0",
    "envelope.original_posting": { canonical_url: POSTING_URL, source_url: POSTING_URL, source_provider: "Immuta Lever", official_source: true, captured_at: capturedAt, posting_status: "open", content_hash: hash, raw_title: "Full-Stack Engineering Internship - Summer 2027", raw_description: raw, raw_location: "Columbus, OH", snapshot_version: 2, recovery_capture: true },
    "envelope.structured_facts": { responsibilities, expected_outcomes: [], required_skills: required, preferred_skills: preferred, technologies, experience_requirements: {}, education: {}, compensation: { available: true, min: 25, max: 30, currency: "USD", period: "hour" }, eligibility: { f1: { status: "unknown" }, cpt: { status: "unknown" }, opt: { status: "unknown" }, sponsorship: { status: "unknown" } }, hiring_process: {}, contacts: [] },
    "envelope.opportunity.description_summary": raw.slice(0, 5000),
    "envelope.opportunity.work_arrangement": "hybrid",
    "envelope.compensation": { available: true, min: 25, max: 30, currency: "USD", period: "hour" },
    "envelope.source.official": true,
    "envelope.source.provider": "lever",
    "envelope.source.name": "Immuta Lever",
    "envelope.source.url": POSTING_URL,
    updatedAt: new Date(),
  };
  console.log(JSON.stringify({ externalId: EXTERNAL_ID, capturedAt, hash, postingCharacters: raw.length, responsibilities: responsibilities.length, technologies: technologies.length, requirements: required.length + preferred.length, dryRun: process.argv.includes("--dry-run") }, null, 2));
  if (process.argv.includes("--dry-run")) return;
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const updated = await client.db().collection("gate_opportunities").updateOne({ external_id: EXTERNAL_ID }, { $set: patch });
    if (updated.matchedCount !== 1) throw new Error(`Expected one Immuta record, found ${updated.matchedCount}`);
    console.log("Immuta recovery snapshot saved.");
  } finally { await client.close(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
