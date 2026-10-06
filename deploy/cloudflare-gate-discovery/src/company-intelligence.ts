export type IntelligenceCandidate = {
  url: string;
  title?: string;
  source: "company_intelligence";
  discovered_at: string;
  company_id: string;
  company_name: string;
  allowed_host: string;
};

export type CompanyRow = {
  id: string;
  canonical_name: string;
  legal_name: string | null;
  state: string | null;
  website: string | null;
  industry: string | null;
  technical_employer: number;
  priority: number;
  active: number;
  last_checked_at: number | null;
  last_success_at: number | null;
  next_check_at: number | null;
  consecutive_failures: number;
};

export type CareerSourceRow = {
  id: string;
  company_id: string;
  url: string;
  host: string;
  source_type: string;
  provider: string;
  verification_status: string;
  active: number;
  last_checked_at: number | null;
  last_success_at: number | null;
  last_http_status: number | null;
  consecutive_failures: number;
};

type IntelligenceEnv = {
  TAVILY_API_KEY: string;
  SEASON: string;
  GATE_JOURNAL: D1Database;
  CANDIDATES: Queue<unknown>;
};

const TECH_TERMS = [
  "software engineer", "software engineering", "software developer", "backend", "frontend",
  "full stack", "platform engineer", "cloud engineer", "infrastructure", "devops",
  "site reliability", "security engineer", "cybersecurity", "data engineer",
  "machine learning", "ai engineer", "mobile engineer", "ios engineer", "technology intern"
];

const canonicalUrl = (value: string) => {
  const u = new URL(value);
  u.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "gh_src"].forEach((k) => u.searchParams.delete(k));
  return u.toString();
};

const hostMatches = (host: string, allowed: string) =>
  host === allowed || host.endsWith("." + allowed);

const sha256 = async (value: string) =>
  "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("");

async function tavily(env: IntelligenceEnv, query: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 10,
      topic: "general",
      include_answer: false
    })
  });
  if (!response.ok) throw new Error("tavily_http_" + response.status);
  return response.json() as Promise<{ results?: Array<{ url?: string; title?: string }> }>;
}

function dueSeconds(priority: number) {
  if (priority <= 1) return 2 * 60 * 60;
  if (priority === 2) return 6 * 60 * 60;
  if (priority === 3) return 12 * 60 * 60;
  return 24 * 60 * 60;
}

export async function scanCompanyIntelligence(env: IntelligenceEnv) {
  const now = Math.floor(Date.now() / 1000);
  const companies = await env.GATE_JOURNAL.prepare(
    "SELECT * FROM gate_companies WHERE active=1 AND technical_employer=1 AND (next_check_at IS NULL OR next_check_at <= ?) ORDER BY priority ASC, COALESCE(last_checked_at,0) ASC LIMIT 20"
  ).bind(now).all<CompanyRow>();

  let checked = 0, successful = 0, discovered = 0, queued = 0, alreadyKnown = 0, failed = 0;

  for (const company of companies.results ?? []) {
    checked++;
    const sources = await env.GATE_JOURNAL.prepare(
      "SELECT * FROM gate_career_sources WHERE company_id=? AND active=1 ORDER BY CASE verification_status WHEN 'verified' THEN 0 ELSE 1 END, id"
    ).bind(company.id).all<CareerSourceRow>();

    let companyOk = false;
    try {
      for (const career of sources.results ?? []) {
        const sourceHost = career.host.toLowerCase();
        const query = `site:${sourceHost} "${env.SEASON}" (intern OR internship) (software OR engineering OR technology OR data OR security OR "machine learning")`;
        const body = await tavily(env, query);
        let sourceOk = true;

        for (const row of body.results ?? []) {
          if (!row.url) continue;
          let url: URL;
          try { url = new URL(row.url); } catch { continue; }
          if (url.protocol !== "https:" || !hostMatches(url.hostname.toLowerCase(), sourceHost)) continue;

          const title = row.title?.trim() || "";
          const hay = `${title} ${url.pathname}`.toLowerCase();
          if (!/intern|co-op|student|early.career/.test(hay)) continue;
          if (!TECH_TERMS.some((term) => hay.includes(term.split(" ")[0])) && !/software|engineer|technology|data|security|cloud|platform|developer|machine/.test(hay)) continue;

          discovered++;
          const clean = canonicalUrl(row.url);
          const key = await sha256(clean);
          const existing = await env.GATE_JOURNAL.prepare(
            "SELECT state FROM gate_journal WHERE url_hash=?"
          ).bind(key).first<{ state: string }>();
          if (existing) { alreadyKnown++; continue; }

          const candidate: IntelligenceCandidate = {
            url: clean,
            title: row.title,
            source: "company_intelligence",
            discovered_at: new Date().toISOString(),
            company_id: company.id,
            company_name: company.canonical_name,
            allowed_host: sourceHost
          };
          await env.CANDIDATES.send(candidate);
          queued++;
        }

        await env.GATE_JOURNAL.prepare(
          "UPDATE gate_career_sources SET last_checked_at=?, last_success_at=?, last_http_status=200, consecutive_failures=0, verification_status=CASE WHEN verification_status='discovered' THEN 'verified' ELSE verification_status END, updated_at=? WHERE id=?"
        ).bind(now, now, now, career.id).run();
        companyOk = sourceOk || companyOk;
      }

      const next = now + dueSeconds(company.priority);
      await env.GATE_JOURNAL.prepare(
        "UPDATE gate_companies SET last_checked_at=?, last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END, next_check_at=?, consecutive_failures=CASE WHEN ? THEN 0 ELSE consecutive_failures+1 END, updated_at=? WHERE id=?"
      ).bind(now, companyOk ? 1 : 0, now, next, companyOk ? 1 : 0, now, company.id).run();
      if (companyOk) successful++; else failed++;
    } catch (error) {
      failed++;
      const next = now + Math.min(dueSeconds(company.priority), 60 * 60);
      await env.GATE_JOURNAL.prepare(
        "UPDATE gate_companies SET last_checked_at=?, next_check_at=?, consecutive_failures=consecutive_failures+1, updated_at=? WHERE id=?"
      ).bind(now, next, now, company.id).run();
      for (const career of sources.results ?? []) {
        await env.GATE_JOURNAL.prepare(
          "UPDATE gate_career_sources SET last_checked_at=?, consecutive_failures=consecutive_failures+1, updated_at=? WHERE id=?"
        ).bind(now, now, career.id).run();
      }
      console.warn("company intelligence scan failed", company.id, String(error));
    }
  }

  return { checked, successful, discovered, queued, already_known: alreadyKnown, failed };
}

export async function companyIntelligenceView(env: Pick<IntelligenceEnv, "GATE_JOURNAL">) {
  const summary = await env.GATE_JOURNAL.prepare(`
    SELECT
      COUNT(*) AS companies,
      SUM(CASE WHEN technical_employer=1 THEN 1 ELSE 0 END) AS technical_employers,
      SUM(CASE WHEN active=1 THEN 1 ELSE 0 END) AS active_companies,
      SUM(CASE WHEN consecutive_failures>0 THEN 1 ELSE 0 END) AS companies_with_failures
    FROM gate_companies
  `).first<Record<string, number>>();

  const sources = await env.GATE_JOURNAL.prepare(`
    SELECT
      COUNT(*) AS career_sources,
      SUM(CASE WHEN verification_status='verified' AND active=1 THEN 1 ELSE 0 END) AS verified_sources,
      SUM(CASE WHEN consecutive_failures>0 AND active=1 THEN 1 ELSE 0 END) AS failing_sources
    FROM gate_career_sources
  `).first<Record<string, number>>();

  const companies = await env.GATE_JOURNAL.prepare(`
    SELECT c.*,
      COUNT(s.id) AS source_count,
      SUM(CASE WHEN s.verification_status='verified' AND s.active=1 THEN 1 ELSE 0 END) AS verified_source_count,
      SUM(CASE WHEN s.consecutive_failures>0 AND s.active=1 THEN 1 ELSE 0 END) AS failing_source_count
    FROM gate_companies c
    LEFT JOIN gate_career_sources s ON s.company_id=c.id
    GROUP BY c.id
    ORDER BY c.priority ASC, c.canonical_name ASC
    LIMIT 500
  `).all<Record<string, unknown>>();

  return {
    generated_at: new Date().toISOString(),
    summary: { ...(summary ?? {}), ...(sources ?? {}) },
    companies: companies.results ?? []
  };
}

export async function upsertCompanyIntelligence(env: Pick<IntelligenceEnv, "GATE_JOURNAL">, input: unknown) {
  const body = input as {
    id?: unknown; name?: unknown; legal_name?: unknown; state?: unknown; website?: unknown;
    industry?: unknown; priority?: unknown; career_sources?: unknown;
  };
  if (!body || typeof body.id !== "string" || typeof body.name !== "string") throw new Error("id_and_name_required");
  const id = body.id.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
  if (!id) throw new Error("invalid_id");
  const priority = Math.min(5, Math.max(1, Number(body.priority ?? 3) || 3));
  const website = typeof body.website === "string" ? body.website.slice(0, 500) : null;
  await env.GATE_JOURNAL.prepare(`
    INSERT INTO gate_companies (id, canonical_name, legal_name, state, website, industry, priority, active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
    ON CONFLICT(id) DO UPDATE SET canonical_name=excluded.canonical_name, legal_name=excluded.legal_name,
      state=excluded.state, website=excluded.website, industry=excluded.industry, priority=excluded.priority,
      active=1, updated_at=unixepoch()
  `).bind(
    id, body.name.slice(0, 200),
    typeof body.legal_name === "string" ? body.legal_name.slice(0, 250) : null,
    typeof body.state === "string" ? body.state.slice(0, 40) : null,
    website,
    typeof body.industry === "string" ? body.industry.slice(0, 120) : null,
    priority
  ).run();

  const list = Array.isArray(body.career_sources) ? body.career_sources : [];
  for (const raw of list.slice(0, 20)) {
    if (typeof raw !== "string") continue;
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (u.protocol !== "https:") continue;
    const url = canonicalUrl(u.toString());
    const host = u.hostname.toLowerCase();
    const provider =
      host.includes("greenhouse") ? "greenhouse" :
      host.includes("lever") ? "lever" :
      host.includes("myworkdayjobs") ? "workday" :
      host.includes("ashbyhq") ? "ashby" :
      host.includes("smartrecruiters") ? "smartrecruiters" : "custom";
    const sourceId = await sha256(id + "|" + url);
    await env.GATE_JOURNAL.prepare(`
      INSERT INTO gate_career_sources (id, company_id, url, host, source_type, provider, verification_status, active, updated_at)
      VALUES (?, ?, ?, ?, 'careers', ?, 'discovered', 1, unixepoch())
      ON CONFLICT(company_id,url) DO UPDATE SET host=excluded.host, provider=excluded.provider, active=1, updated_at=unixepoch()
    `).bind(sourceId, id, url, host, provider).run();
  }

  return { ok: true, id };
}
