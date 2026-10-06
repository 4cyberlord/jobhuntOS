import { companyIntelligenceView, scanCompanyIntelligence, upsertCompanyIntelligence } from "./company-intelligence";
import { reserveTavilyCredit, TAVILY_DAILY_LIMIT } from "./usage";
interface Env { TAVILY_API_KEY: string; RUN_TOKEN: string; RAILWAY_BRIDGE_URL: string; RAILWAY_DELIVERY_TOKEN: string; GATE_IMPORT_URL: string; GATE_BRIDGE_CRON_SECRET: string; LIFECYCLE_RELAY_URL: string; LIFECYCLE_EVENT_TOKEN: string; WATCH_ID: string; SEASON: string; COUNTRY: string; GATE_STATUS: KVNamespace; CANDIDATES: Queue<Candidate>; GATE_JOURNAL: D1Database; }
type Candidate = { url: string; title?: string; source: "tavily" | "company_intelligence"; discovered_at: string; company_id?: string; company_name?: string; allowed_host?: string };
type Posting = { url: string; raw: string; title: string; provider: string };
const MAX_POSTING_BYTES = 2_000_000;
const SKILLS = ["PHP", "Laravel", "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust", "Dart", "Flutter", "React", "Angular", "Vue", "Node.js", "Next.js", "SQL", "PostgreSQL", "PostGIS", "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "Linux", "Terraform", "GraphQL", "REST", "Machine Learning", "TensorFlow", "PyTorch"];
const CANDIDATE_PROFILE = {
  degree: "B.S. Computer Science, Mathematics minor", graduation: "May 2028", experience_years: 10,
  skills: new Set(["PHP","Laravel","JavaScript","TypeScript","Python","Dart","Flutter","React","Next.js","SQL","PostgreSQL","PostGIS","Redis","Docker","Git","Linux","REST"]),
  evidence: ["10+ years full-stack software engineering", "GHADAS: Next.js, Laravel, PostgreSQL/PostGIS, Redis, Docker", "MantleCall: Next.js + Laravel", "RyyHub: Laravel + Flutter", "Pewbeam/Rhema open-source contributor", "Taught 250+ students application development"]
};
function assessProfile(raw: string, skills: string[]) {
  const matched = skills.filter((skill) => CANDIDATE_PROFILE.skills.has(skill));
  const missing = skills.filter((skill) => !CANDIDATE_PROFILE.skills.has(skill));
  const technicalFit = skills.length ? Math.round((matched.length / skills.length) * 100) : 70;
  const educationFit = /computer science|software engineering|related field|bachelor|university|college|student/i.test(raw) ? 100 : 80;
  const experienceFit = /intern(ship)?|student|early career/i.test(raw) ? 100 : 85;
  const projectFit = matched.length ? Math.min(100, 70 + matched.length * 5) : 75;
  const score = Math.round(technicalFit * 0.55 + experienceFit * 0.15 + educationFit * 0.10 + projectFit * 0.20);
  const fitLevel = score >= 95 ? "perfect" : score >= 85 ? "strong" : score >= 70 ? "good" : score >= 50 ? "partial" : "low";
  const badge = score >= 95 ? "PERFECT MATCH" : score >= 85 ? "STRONG MATCH" : score >= 70 ? "GOOD MATCH" : score >= 50 ? "PARTIAL MATCH" : "LOW MATCH";
  const usPerson = /\bU\.S\. person\b|\bUS person\b/i.test(raw);
  const citizen = /U\.S\. citizen|US citizen|citizenship required/i.test(raw);
  const eligibilityRisk = usPerson || citizen ? "high" : "unknown";
  const eligibilityReason = usPerson ? "Posting appears to state a U.S.-person requirement; verify exact employer language." : citizen ? "Posting appears to state a U.S.-citizenship requirement; verify exact employer language." : "F-1/CPT/sponsorship policy is not inferred when the posting does not state it.";
  return { score, fitLevel, badge, technicalFit, educationFit, experienceFit, projectFit, matched, missing, eligibilityRisk, eligibilityReason };
}
const queries = ['"Summer 2027" "Software Engineer Intern"', '"Summer 2027" "Software Engineering Intern"', 'site:boards.greenhouse.io "Summer 2027" intern software', 'site:jobs.lever.co "Summer 2027" intern software'];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Best-effort only: lifecycle delivery can never block discovery or queueing. */
async function lifecycle(env: Env, body: Record<string, unknown>) {
  const response = await fetch(env.LIFECYCLE_RELAY_URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.LIFECYCLE_EVENT_TOKEN}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`lifecycle_relay_${response.status}`);
}
const sha256 = async (value: string) => `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
const canonicalUrl = (value: string) => { const u = new URL(value); u.hash = ""; ["utm_source", "utm_medium", "utm_campaign", "gh_src"].forEach((k) => u.searchParams.delete(k)); return u.toString(); };
const allowedHost = (hostname: string, allowed?: string) => (!!allowed && (hostname === allowed || hostname.endsWith(`.${allowed}`))) || ["greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com", "smartrecruiters.com"].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) || /^(jobs|careers)\./.test(hostname);
const providerOf = (host: string) => host.includes("greenhouse") ? "greenhouse" : host.includes("lever") ? "lever" : host.includes("workday") ? "workday" : host.includes("ashby") ? "ashby" : "company_careers";
const textOnly = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const literal = (skill: string) => new RegExp(`(?<![A-Za-z0-9_])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "i");
function candidateUrl(raw: string, allowed?: string) { try { const u = new URL(raw); return u.protocol === "https:" && allowedHost(u.hostname.toLowerCase(), allowed); } catch { return false; } }
function fromTitle(title: string, candidateTitle?: string) { const source = title || candidateTitle || ""; const at = /Job Application for (.+?) at (.+?)(?:\s*[|–-]|$)/i.exec(source); if (at) return { title: at[1].trim(), company: at[2].trim() }; const split = /^(.+?)\s+[|–-]\s+(.+)$/.exec(source); return { title: split?.[1]?.trim() || candidateTitle || title, company: split?.[2]?.trim() || null }; }
async function fetchOfficial(url: string, allowed?: string): Promise<Posting> { let current = canonicalUrl(url); for (let redirects = 0; redirects < 4; redirects++) { const parsed = new URL(current); if (parsed.protocol !== "https:" || !allowedHost(parsed.hostname.toLowerCase(), allowed)) throw new Error("unverified_official_posting_url"); const response = await fetch(current, { redirect: "manual", headers: { "user-agent": "GATE-Cloudflare-Watcher/3.0" } }); if ([301, 302, 303, 307, 308].includes(response.status)) { const next = response.headers.get("location"); if (!next) throw new Error("posting_redirect_missing_location"); current = new URL(next, current).toString(); continue; } if (!response.ok) throw new Error(`posting_http_${response.status}`); const length = Number(response.headers.get("content-length") || 0); if (length > MAX_POSTING_BYTES) throw new Error("posting_too_large"); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > MAX_POSTING_BYTES) throw new Error("posting_too_large"); const html = new TextDecoder().decode(bytes), raw = textOnly(html); if (raw.length < 200) throw new Error("posting_too_short"); return { url: canonicalUrl(current), raw, title: textOnly(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ""), provider: providerOf(parsed.hostname) }; } throw new Error("posting_redirect_limit"); }
async function completeRecord(candidate: Candidate, posting: Posting, env: Env) {
  const facts = fromTitle(posting.title, candidate.title);
  if (!facts.company || !facts.title) throw new Error("company_or_title_not_stated");
  const skills = SKILLS.filter((skill) => literal(skill).test(posting.raw));
  const assessment = assessProfile(posting.raw, skills);
  const arrangement = /\bhybrid\b/i.test(posting.raw) ? "hybrid" : /\bremote\b/i.test(posting.raw) ? "remote" : /\bon[ -]?site\b/i.test(posting.raw) ? "onsite" : "unknown";
  const employment = /\bintern(ship)?\b/i.test(posting.raw) ? "internship" : /\bfull[ -]?time\b/i.test(posting.raw) ? "full_time" : /\bpart[ -]?time\b/i.test(posting.raw) ? "part_time" : "unknown";
  const now = new Date().toISOString();
  const fingerprint = await sha256(`${facts.company.toLowerCase()}|${facts.title.toLowerCase()}|${posting.url}`);
  const contentHash = await sha256(posting.raw);
  const skillFacts = skills.map((skill) => ({ skill, provenance: "stated", confidence: 0.8 }));
  const satisfied = assessment.matched.map((skill) => ({ requirement: skill, evidence: `Posting mentions ${skill}`, profile_evidence: `Candidate profile includes ${skill}`, confidence: 0.9 }));
  const gaps = assessment.missing.map((skill) => ({ requirement: skill, type: "technical_skill", status: "not_in_profile", reason: "Skill is stated in the posting but is not currently present in the candidate profile.", severity: "review" }));
  const evidence = CANDIDATE_PROFILE.evidence.filter((item) => assessment.matched.some((skill) => item.toLowerCase().includes(skill.toLowerCase()))).slice(0, 12);
  return {
    event: "gate.opportunity.discovered", schema_version: "2.0",
    identity: { fingerprint, external_job_id: null, is_duplicate: false, record_type: "new" },
    search: { watch_id: env.WATCH_ID, season: env.SEASON, country: env.COUNTRY, searched_at: now },
    original_posting: { canonical_url: posting.url, source_url: posting.url, source_provider: posting.provider, official_source: true, captured_at: now, posting_status: "open", content_hash: contentHash, raw_title: facts.title, raw_description: posting.raw, raw_location: null, snapshot_version: 1 },
    company: { name: facts.company, website: null, careers_url: null },
    opportunity: { title: facts.title, normalized_title: facts.title, track: "software_engineering", employment_type: employment, season: env.SEASON, description_summary: posting.raw.slice(0, 600), team: {}, location: { cities: [], states: [], country: env.COUNTRY, work_arrangement: arrangement, office_days_per_week: null, location_restrictions: [], travel_required: null, relocation_required: null }, internship: {}, application: { status: "open", posted_at: null, posted_at_note: "Not stated", deadline: null, deadline_note: "Not stated", apply_url: posting.url, materials: {} } },
    structured_facts: { responsibilities: [], expected_outcomes: [], required_skills: skillFacts, preferred_skills: [], technologies: skills, technical_stack: {}, education: {}, experience_requirements: {}, compensation: {}, eligibility: {}, hiring_process: {}, contacts: [] },
    gate_assessment: {
      match: { score: assessment.score, level: assessment.fitLevel, fit_level: assessment.fitLevel, perfect_fit: assessment.score >= 95 && assessment.eligibilityRisk !== "high", badge: assessment.badge, technical_fit: assessment.technicalFit, experience_fit: assessment.experienceFit, education_fit: assessment.educationFit, reason: `Profile-based assessment: matched ${assessment.matched.length} of ${skills.length || 0} explicitly detected technologies.`, already_satisfies: satisfied, missing: gaps, unknown: [], supporting_evidence: evidence, recommended_resume_emphasis: assessment.matched.slice(0, 12), eligibility_risk: { level: assessment.eligibilityRisk, reason: assessment.eligibilityReason } },
      satisfies: satisfied, missing: gaps, unknown: [], supporting_resume_experience: CANDIDATE_PROFILE.evidence.map((x) => ({ project_or_role: x, supports: assessment.matched })),
      recommended_resume: { emphasis: assessment.matched.slice(0, 12) }, recommended_next_action: "Review the official posting and confirm any unstated work-authorization requirements.", eligibility_risk: assessment.eligibilityRisk, eligibility_risk_reason: assessment.eligibilityReason, assessment_confidence: skills.length ? 0.82 : 0.58
    },
    match: { score: assessment.score, level: assessment.fitLevel, fit_level: assessment.fitLevel, badge: assessment.badge, reason: `Profile-based assessment using explicit posting technologies and candidate evidence.`, already_satisfies: satisfied, missing: gaps, unknown: [], supporting_evidence: evidence, recommended_resume_emphasis: assessment.matched.slice(0, 12), eligibility_risk: { level: assessment.eligibilityRisk, reason: assessment.eligibilityReason } },
    source: { first_seen_at: candidate.discovered_at, last_verified_at: now, source_quality: "official", verification_status: "verified", evidence_urls: [posting.url] },
    risk: { scam_risk: "unknown", duplicate_signals: [], data_quality_flags: skills.length ? [] : ["limited_technical_requirements_detected"] },
    change_history: [{ detected_at: now, change_type: "initial_capture" }],
    agent: { name: "GATE Cloudflare Watcher", agent_type: "job_discovery", decision: "surface", confidence: skills.length ? 0.82 : 0.58, flags: ["official_source"] },
    metadata: { gate_status: "discovered", discovered_at: candidate.discovered_at, user_action_required: true }
  };
}
async function search(env: Env, query: string): Promise<Candidate[]> { if (!await reserveTavilyCredit(env.GATE_STATUS)) return []; const response = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 5, topic: "general", include_answer: false }) }); if (!response.ok) throw new Error(`tavily_http_${response.status}`); const body = await response.json() as { results?: Array<{ url?: string; title?: string }> }; return (body.results ?? []).flatMap((row) => row.url && candidateUrl(row.url) ? [{ url: canonicalUrl(row.url), title: row.title, source: "tavily" as const, discovered_at: new Date().toISOString() }] : []); }
async function discover(env: Env) {
  const seen = new Set<string>();
  let found = 0, queued = 0, alreadyKnown = 0, failed = 0;
  const query = queries[Math.floor(Date.now() / 3_600_000) % queries.length];
  await lifecycle(env, { source: "cloudflare", phase: "search_starting", season: env.SEASON, query_count: 1 }).catch(() => undefined);
  for (const currentQuery of [query]) try {
    for (const candidate of await search(env, currentQuery)) {
      found++;
      if (seen.has(candidate.url)) { alreadyKnown++; continue; }
      seen.add(candidate.url);
      const key = await sha256(candidate.url);
      const existing = await env.GATE_JOURNAL.prepare("SELECT state FROM gate_journal WHERE url_hash = ?").bind(key).first<{ state: string }>();
      // Only genuinely unseen URLs enter the research queue. Retriable failures
      // are recovered by recoverRetryingCandidates(), not rediscovered here.
      if (existing) { alreadyKnown++; continue; }
      await env.CANDIDATES.send(candidate);
      queued++;
    }
  } catch { failed++; }
  const result = { watch: env.WATCH_ID, last_run: new Date().toISOString(), candidate_urls_found: found, queued, already_known: alreadyKnown, failed };
  await env.GATE_STATUS.put("latest", JSON.stringify(result), { expirationTtl: 60 * 60 * 24 * 14 });
  await lifecycle(env, { source: "cloudflare", phase: "discovery_finished", candidates_found: found, new_candidates: found - alreadyKnown, already_known: alreadyKnown, queued, failed }).catch(() => undefined);
  return result;
}
async function runCompanyIntelligence(env: Env) {
  await lifecycle(env, { source: "company_intelligence", prefix: "🏢 COMPANY-INTEL", phase: "scan_starting" }).catch(() => undefined);
  const result = await scanCompanyIntelligence(env);
  await lifecycle(env, { source: "company_intelligence", prefix: "🏢 COMPANY-INTEL", phase: "scan_finished", ...result }).catch(() => undefined);
  return result;
}
/** Calls Job Hunt OS, never Railway/Postgres. Job Hunt OS owns claim/persist/ACK. */
async function importBridge(env: Env) { const response = await fetch(env.GATE_IMPORT_URL, { method: "POST", headers: { authorization: `Bearer ${env.GATE_BRIDGE_CRON_SECRET}` } }); if (!response.ok) throw new Error(`gate_bridge_import_${response.status}`); return response.json() as Promise<unknown>; }
/** Queue retries are finite; the D1 journal is the durable recovery source. */
async function recoverRetryingCandidates(env: Env) {
  const rows = await env.GATE_JOURNAL.prepare("SELECT url FROM gate_journal WHERE state = 'retrying' AND attempts < 12 ORDER BY updated_at ASC LIMIT 10").all<{ url: string }>();
  for (const row of rows.results ?? []) {
    // Delivery is idempotent at Railway/Mongo, so enqueue first: an interrupted
    // scheduler may duplicate work, but it can never strand a durable URL.
    await env.CANDIDATES.send({ url: row.url, source: "tavily", discovered_at: new Date().toISOString() });
    await env.GATE_JOURNAL.prepare("UPDATE gate_journal SET state = 'retry_scheduled', updated_at = unixepoch() WHERE url = ? AND state = 'retrying'").bind(row.url).run();
  }
}
async function processCandidate(candidate: Candidate, env: Env) { const key = await sha256(candidate.url), existing = await env.GATE_JOURNAL.prepare("SELECT state FROM gate_journal WHERE url_hash = ?").bind(key).first<{ state: string }>(); if (existing?.state === "queued_for_import") return; await env.GATE_JOURNAL.prepare("INSERT INTO gate_journal (url_hash, url, state, attempts, updated_at) VALUES (?, ?, 'processing', 1, unixepoch()) ON CONFLICT(url_hash) DO UPDATE SET state='processing', attempts=attempts+1, updated_at=unixepoch(), last_error=NULL").bind(key, candidate.url).run(); try { const record = await completeRecord(candidate, await fetchOfficial(candidate.url, candidate.allowed_host), env); const response = await fetch(`${env.RAILWAY_BRIDGE_URL.replace(/\/+$/, "")}/v1/deliver`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.RAILWAY_DELIVERY_TOKEN}` }, body: JSON.stringify(record) }); const body = await response.json().catch(() => null) as { accepted?: boolean; queue_id?: string; error?: string } | null; if (!response.ok || !body?.accepted || !body.queue_id) throw new Error(`railway_bridge_${response.status}:${body?.error || "invalid_response"}`); await env.GATE_JOURNAL.prepare("UPDATE gate_journal SET state='queued_for_import', gate_opportunity_id=?, updated_at=unixepoch(), last_error=NULL WHERE url_hash=?").bind(body.queue_id, key).run();
    const company = record.company?.name ?? "Not specified";
    const role = record.opportunity?.title ?? "Not specified";
    const score = typeof record.match?.score === "number" ? record.match.score : undefined;
    await lifecycle(env, { source: "cloudflare", phase: "handoff_complete", company, role, score, gate_id: body.queue_id }).catch(() => undefined); } catch (error) { const message = String(error instanceof Error ? error.message : error).slice(0, 1000), terminal = /unverified|too_short|too_large|company_or_title|railway_bridge_4(?:00|22)/.test(message); await env.GATE_JOURNAL.prepare("UPDATE gate_journal SET state=?, updated_at=unixepoch(), last_error=? WHERE url_hash=?").bind(terminal ? "failed" : "retrying", message, key).run(); if (!terminal) throw error; } }
export default { async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(controller.cron === "* * * * *"
    ? Promise.all([importBridge(env), recoverRetryingCandidates(env)])
    : controller.cron === "*/15 * * * *"
      ? runCompanyIntelligence(env)
      : discover(env)); }, async queue(batch: MessageBatch<unknown>, env: Env) {
  let researched = 0, handed_off = 0, failed = 0;
  for (const message of batch.messages) {
    try { await processCandidate(message.body as Candidate, env); message.ack(); researched++; handed_off++; }
    catch { message.retry({ delaySeconds: 60 }); researched++; failed++; }
  }
  if (batch.messages.length > 0) {
    await lifecycle(env, { source: "cloudflare", phase: "research_finished", researched, valid: handed_off, rejected: 0, handed_off, failed }).catch(() => undefined);
  }
}, async fetch(req: Request, env: Env) { const path = new URL(req.url).pathname; if (req.method === "GET" && path === "/health") return json({ ok: true, service: "gate-cloudflare-discovery", lifecycle_version: "canonical-v1", discovery_schedule: "0 * * * *", company_intelligence_schedule: "*/15 * * * *", bridge_import_schedule: "* * * * *", tavily_daily_budget: TAVILY_DAILY_LIMIT, processor: "queues+d1", scoring: "candidate-profile-v1" }); if (req.method === "GET" && path === "/status") return json({ ok: true, ...(JSON.parse(await env.GATE_STATUS.get("latest") || "{}")) });
if (req.method === "GET" && path === "/company-intelligence") {
  return json({ ok: true, ...(await companyIntelligenceView(env)) });
}
if (req.method === "POST" && path === "/company-intelligence/scan") {
  if (req.headers.get("authorization") !== `Bearer ${env.RUN_TOKEN}`) return json({ error: "unauthorized" }, 401);
  return json({ ok: true, ...(await scanCompanyIntelligence(env)) });
}
if (req.method === "POST" && path === "/company-intelligence/companies") {
  if (req.headers.get("authorization") !== `Bearer ${env.RUN_TOKEN}`) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  try { return json(await upsertCompanyIntelligence(env, body), 201); }
  catch (e) { return json({ error: e instanceof Error ? e.message : "invalid_payload" }, 422); }
} if (req.method === "POST" && path === "/internal/run") { if (req.headers.get("authorization") !== `Bearer ${env.RUN_TOKEN}`) return json({ error: "unauthorized" }, 401); return json({ ok: true, ...(await discover(env)) }); } if (req.method === "POST" && path === "/internal/candidates") { if (req.headers.get("authorization") !== `Bearer ${env.RUN_TOKEN}`) return json({ error: "unauthorized" }, 401); const body = await req.json().catch(() => null) as { url?: unknown; title?: unknown } | null; if (!body || typeof body.url !== "string" || !candidateUrl(body.url)) return json({ error: "official_https_url_required" }, 422); const candidate: Candidate = { url: canonicalUrl(body.url), title: typeof body.title === "string" ? body.title.slice(0, 500) : undefined, source: "tavily", discovered_at: new Date().toISOString() }; await env.CANDIDATES.send(candidate); return json({ ok: true, queued: true, url: candidate.url }, 202); } return json({ error: "not_found" }, 404); } } satisfies ExportedHandler<Env>;
