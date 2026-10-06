import { MongoClient } from "mongodb";
import {
  resolveIntelligenceCompany,
  upsertIntelligenceCompany,
  recordIntelligenceDiscovery,
} from "../src/company-intelligence.js";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI is required");

const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const report = {
  started_at: new Date().toISOString(),
  companies_seen: 0,
  companies_linked: 0,
  companies_created_or_resolved: 0,
  company_failures: 0,
  gate_records_seen: 0,
  gate_records_backfilled: 0,
  gate_failures: 0,
};

try {
  const companies = await db.collection("workspace")
    .find({ c: "companies", deleted: { $ne: true } }, { projection: { id: 1, u: 1, doc: 1 } })
    .toArray();

  for (const row of companies) {
    report.companies_seen++;
    const doc = row.doc ?? {};
    const name = typeof doc.name === "string" ? doc.name.trim() : "";
    if (!name) continue;

    try {
      const website = typeof doc.website === "string" ? doc.website : undefined;
      const existingId = typeof doc.intelligenceId === "string" && doc.intelligenceId ? doc.intelligenceId : null;
      let intelligenceId = existingId;

      if (!intelligenceId) {
        const match = await resolveIntelligenceCompany({ name, website });
        if (match?.company.id) {
          intelligenceId = match.company.id;
        } else {
          const created = await upsertIntelligenceCompany({
            name,
            website,
            industry: typeof doc.industry === "string" ? doc.industry : undefined,
            headquarters: typeof doc.hq === "string" ? doc.hq : undefined,
            legal_name: typeof doc.legalName === "string" ? doc.legalName : undefined,
            aliases: Array.isArray(doc.aliases) ? doc.aliases.filter((x) => typeof x === "string") : undefined,
          });
          intelligenceId = created.company.id;
        }
        report.companies_created_or_resolved++;
      }

      if (intelligenceId && doc.intelligenceId !== intelligenceId) {
        const now = Date.now();
        await db.collection("workspace").updateOne(
          { _id: row._id },
          { $set: { doc: { ...doc, intelligenceId }, u: Math.max(Number(row.u || 0) + 1, now), at: new Date() } }
        );
        report.companies_linked++;
      }
    } catch (error) {
      report.company_failures++;
      console.error("company_migration_failed", name, error instanceof Error ? error.message : String(error));
    }
  }

  const gates = await db.collection("gate_opportunities")
    .find({}, { projection: { envelope: 1 } })
    .sort({ _id: 1 })
    .toArray();

  for (const row of gates) {
    report.gate_records_seen++;
    if (!row.envelope || typeof row.envelope !== "object") continue;
    try {
      await recordIntelligenceDiscovery(row.envelope, String(row._id));
      report.gate_records_backfilled++;
    } catch (error) {
      report.gate_failures++;
      console.error("gate_backfill_failed", String(row._id), error instanceof Error ? error.message : String(error));
    }
  }

  report.finished_at = new Date().toISOString();
  console.log("COMPANY_INTELLIGENCE_ONE_TIME_MIGRATION", JSON.stringify(report));
} finally {
  await client.close();
}
