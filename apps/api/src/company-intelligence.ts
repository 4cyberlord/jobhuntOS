import type { GateEnvelope } from "@job-hunt-os/contracts";

type IntelligenceCompany = {
  id: string;
  canonical_name: string;
  legal_name?: string | null;
  website?: string | null;
  industry?: string | null;
  state?: string | null;
  country?: string | null;
};

type ResolveResult = { ok: true; company: IntelligenceCompany; matched_by?: string; confidence?: number };

function base() {
  const url = process.env.COMPANY_INTELLIGENCE_API_URL?.replace(/\/+$/, "");
  if (!url) throw new Error("COMPANY_INTELLIGENCE_API_URL is not configured.");
  return url;
}
function token() {
  const value = process.env.COMPANY_INTELLIGENCE_WRITE_TOKEN;
  if (!value) throw new Error("COMPANY_INTELLIGENCE_WRITE_TOKEN is not configured.");
  return value;
}
async function readJson<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Company Intelligence returned ${r.status}.`);
  return body as T;
}
export function companyIntelligenceConfigured() {
  return !!process.env.COMPANY_INTELLIGENCE_API_URL;
}
export async function companyIntelligenceView() {
  const r = await fetch(`${base()}/v1/company-intelligence`, { headers: { "user-agent": "job-hunt-os-api/1.0" } });
  return readJson<Record<string, unknown>>(r);
}
export async function resolveIntelligenceCompany(input: { name: string; website?: string | null; careers_url?: string | null }) {
  const q = new URLSearchParams({ name: input.name });
  if (input.website) q.set("website", input.website);
  if (input.careers_url) q.set("careers_url", input.careers_url);
  const r = await fetch(`${base()}/v1/companies/resolve?${q}`, { headers: { "user-agent": "job-hunt-os-api/1.0" } });
  if (r.status === 404) return null;
  return readJson<ResolveResult>(r);
}
export async function upsertIntelligenceCompany(input: {
  name: string;
  website?: string | null;
  careers_url?: string | null;
  industry?: string | null;
  headquarters?: string | null;
  aliases?: string[];
}) {
  const r = await fetch(`${base()}/v1/companies/upsert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "job-hunt-os-api/1.0" },
    body: JSON.stringify({
      name: input.name,
      canonical_name: input.name,
      website: input.website ?? null,
      industry: input.industry ?? null,
      state: input.headquarters ?? null,
      aliases: input.aliases ?? [],
      technical_employer: true,
      active: true,
    }),
  });
  return readJson<{ ok: true; company: IntelligenceCompany }>(r);
}
export async function ensureIntelligenceCompany(e: GateEnvelope) {
  const company = e.company as GateEnvelope["company"] & { intelligence_id?: string | null };
  if (company.intelligence_id) return company.intelligence_id;
  const resolved = await resolveIntelligenceCompany({
    name: company.name,
    website: company.website,
    careers_url: company.careers_url,
  }).catch(() => null);
  if (resolved?.company.id) return resolved.company.id;
  const created = await upsertIntelligenceCompany({
    name: company.name,
    website: company.website,
    careers_url: company.careers_url,
    industry: company.industry,
    headquarters: company.headquarters,
  });
  return created.company.id;
}
export async function registerCareerSource(e: GateEnvelope, companyId: string) {
  const preferred = e.company.careers_url || (e.source.official ? e.source.url : null) || e.original_posting?.source_url || null;
  if (!preferred) return null;
  let host = "";
  try { host = new URL(preferred).hostname.toLowerCase(); } catch { return null; }
  const id = `src_${companyId}_${host.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80)}`;
  const provider = e.source.provider || e.original_posting?.source_provider || "custom";
  const r = await fetch(`${base()}/v1/career-sources/upsert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "job-hunt-os-api/1.0" },
    body: JSON.stringify({
      id,
      company_id: companyId,
      url: preferred,
      host,
      source_type: e.company.careers_url ? "careers" : "posting_source",
      provider,
      verification_status: e.source.official || e.original_posting?.official_source ? "verified" : "discovered",
      active: true,
      metadata: { source_name: e.source.name, evidence_url: e.source.url },
    }),
  });
  return readJson<{ ok: true; source: Record<string, unknown> }>(r);
}

export async function recordIntelligenceDiscovery(e: GateEnvelope, gateId?: string) {
  const companyId = await ensureIntelligenceCompany(e);
  await registerCareerSource(e, companyId).catch(() => null);
  const location = [e.opportunity.location.city, e.opportunity.location.state, e.opportunity.location.country].filter(Boolean).join(", ");
  const r = await fetch(`${base()}/v1/discoveries/upsert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "job-hunt-os-api/1.0" },
    body: JSON.stringify({
      company_id: companyId,
      title: e.opportunity.title,
      apply_url: e.opportunity.application.apply_url,
      canonical_url: e.opportunity.application.apply_url,
      season: e.opportunity.season ?? null,
      location,
      work_arrangement: e.opportunity.work_arrangement,
      posting_status: e.opportunity.application.status,
      match_score: e.match.score,
      eligibility_risk: e.match.eligibility_risk?.level ?? null,
      gate_id: gateId ?? null,
      metadata: { source: e.source, fingerprint: e.metadata.fingerprint ?? null },
    }),
  });
  await readJson(r);
  return companyId;
}
export async function companyIntelligenceDetail(id: string) {
  const r = await fetch(`${base()}/v1/companies/${encodeURIComponent(id)}`, { headers: { "user-agent": "job-hunt-os-api/1.0" } });
  return readJson<Record<string, unknown>>(r);
}
