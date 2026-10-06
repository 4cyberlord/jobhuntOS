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
type CompanyUpsertResult = { ok: true; company: IntelligenceCompany; created?: boolean; matched_existing?: boolean };
type SourceUpsertResult = { ok: true; source: Record<string, unknown>; created?: boolean; previous_verification_status?: string | null };

function base() {
  return (process.env.COMPANY_INTELLIGENCE_API_URL || "https://jobhunt-company-intelligence-api.onrender.com").replace(/\/+$/, "");
}
function token() {
  const value = process.env.VERCEL_OIDC_TOKEN || process.env.COMPANY_INTELLIGENCE_WRITE_TOKEN;
  if (!value) throw new Error("Company Intelligence write authentication is unavailable.");
  return value;
}
export async function notifyCompanyIntelligenceLifecycle(phase: string, fields: Record<string, unknown>) {
  const url = process.env.LIFECYCLE_RELAY_URL?.trim();
  const eventToken = process.env.LIFECYCLE_EVENT_TOKEN?.trim();
  if (!url || !eventToken) return;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${eventToken}`, "content-type": "application/json" },
    body: JSON.stringify({ source: "company_intelligence", prefix: "🏢 COMPANY-INTEL", phase, ...fields }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
}
async function readJson<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `Company Intelligence returned ${r.status}.`);
  return body as T;
}
export function companyIntelligenceConfigured() {
  return true;
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
  legal_name?: string | null;
  aliases?: string[];
  priority?: number;
}) {
  const r = await fetch(`${base()}/v1/companies/upsert`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "job-hunt-os-api/1.0" },
    body: JSON.stringify({
      name: input.name,
      canonical_name: input.name,
      website: input.website ?? null,
      legal_name: input.legal_name ?? null,
      industry: input.industry ?? null,
      state: input.headquarters ?? null,
      aliases: input.aliases ?? [],
      priority: input.priority ?? 3,
      technical_employer: true,
      active: true,
    }),
  });
  return readJson<CompanyUpsertResult>(r);
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
  if (created.created) {
    await notifyCompanyIntelligenceLifecycle("company_discovered", {
      company: created.company.canonical_name,
      company_id: created.company.id,
      website: created.company.website ?? null,
      industry: created.company.industry ?? null,
    });
  }
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
  const result = await readJson<SourceUpsertResult>(r);
  const verified = e.source.official || e.original_posting?.official_source;
  if (result.created) {
    await notifyCompanyIntelligenceLifecycle("career_source_added", {
      company: e.company.name,
      company_id: companyId,
      provider,
      url: preferred,
      host,
      verified,
    });
  } else if (verified && result.previous_verification_status !== "verified") {
    await notifyCompanyIntelligenceLifecycle("career_source_verified", {
      company: e.company.name,
      company_id: companyId,
      provider,
      url: preferred,
      host,
    });
  }
  return result;
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


export async function companyIntelligenceDue(limit = 10) {
  const view = await companyIntelligenceView() as { companies?: Array<Record<string, unknown>> };
  const now = Date.now();
  const dueMs = (priority: number) => priority <= 1 ? 30 * 60 * 1000 : priority === 2 ? 60 * 60 * 1000 : priority === 3 ? 3 * 60 * 60 * 1000 : priority === 4 ? 6 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const companies = (view.companies ?? [])
    .filter((c) => c.active !== false && c.active !== 0 && c.technical_employer !== false && c.technical_employer !== 0)
    .filter((c) => {
      const verified = Number(c.verified_source_count ?? 0);
      const website = typeof c.website === "string" ? c.website : "";
      const checked = c.last_checked_at ? new Date(String(c.last_checked_at)).getTime() : 0;
      const priority = Number(c.priority ?? 3);
      return !website || verified === 0 || !checked || now - checked >= dueMs(priority);
    })
    .sort((a,b) => Number(a.priority ?? 3) - Number(b.priority ?? 3) || String(a.canonical_name ?? "").localeCompare(String(b.canonical_name ?? "")))
    .slice(0, Math.max(1, Math.min(limit, 25)));

  const out = [];
  for (const company of companies) {
    try {
      const detail = await companyIntelligenceDetail(String(company.id)) as { career_sources?: Array<Record<string, unknown>> };
      out.push({ company, career_sources: detail.career_sources ?? [], needs_enrichment: !company.website || Number(company.verified_source_count ?? 0) === 0 });
    } catch {
      out.push({ company, career_sources: [], needs_enrichment: true });
    }
  }
  return out;
}

export async function applyCompanyIntelligenceEnrichment(input: {
  company_id: string;
  name: string;
  legal_name?: string | null;
  website?: string | null;
  industry?: string | null;
  headquarters?: string | null;
  aliases?: string[];
  priority?: number;
  career_sources?: Array<{ url: string; provider?: string; verification_status?: string; source_type?: string; evidence_url?: string | null }>;
  ok?: boolean;
}) {
  const company = await upsertIntelligenceCompany({
    name: input.name,
    website: input.website,
    industry: input.industry,
    headquarters: input.headquarters,
    legal_name: input.legal_name,
    aliases: input.aliases,
    priority: input.priority,
  });

  let added = 0;
  for (const source of input.career_sources ?? []) {
    let host = "";
    try { host = new URL(source.url).hostname.toLowerCase(); } catch { continue; }
    const id = `src_${company.company.id}_${host.replace(/[^a-z0-9]+/g, "_").slice(0,80)}_${Math.abs(source.url.split("").reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0))}`;
    const r = await fetch(`${base()}/v1/career-sources/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "job-hunt-os-api/1.0" },
      body: JSON.stringify({
        id,
        company_id: company.company.id,
        url: source.url,
        host,
        source_type: source.source_type ?? "careers",
        provider: source.provider ?? "custom",
        verification_status: source.verification_status ?? "discovered",
        active: true,
        metadata: { evidence_url: source.evidence_url ?? null },
      }),
    });
    const result = await readJson<SourceUpsertResult>(r);
    if (result.created) {
      added++;
      await notifyCompanyIntelligenceLifecycle("career_source_added", {
        company: input.name,
        company_id: company.company.id,
        provider: source.provider ?? "custom",
        url: source.url,
        verified: (source.verification_status ?? "discovered") === "verified",
      });
    }
  }

  const status = await fetch(`${base()}/v1/companies/scan-status`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "content-type": "application/json", "user-agent": "job-hunt-os-api/1.0" },
    body: JSON.stringify({ company_id: company.company.id, ok: input.ok !== false }),
  });
  await readJson(status);

  return { ok: true, company_id: company.company.id, sources_added: added };
}
