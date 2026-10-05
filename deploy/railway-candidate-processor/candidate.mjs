import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";

export const MAX_POSTING_BYTES = 2 * 1024 * 1024;
const OFFICIAL_HOSTS = ["greenhouse.io", "lever.co", "myworkdayjobs.com", "ashbyhq.com", "smartrecruiters.com", "job-boards.greenhouse.io"];
export const canonicalUrl = (input) => {
  const url = new URL(input); url.hash = ""; ["utm_source", "utm_medium", "utm_campaign", "gh_src"].forEach((key) => url.searchParams.delete(key));
  return url.toString();
};
export const isPrivateIp = (ip) => ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:") || /^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
export const isOfficialHost = (hostname) => OFFICIAL_HOSTS.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) || /^(jobs|careers)\./.test(hostname);
export const safeEqual = (a, b) => { if (!a || !b) return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const textOnly = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
export const providerOf = (host) => host.includes("greenhouse") ? "greenhouse" : host.includes("lever") ? "lever" : host.includes("workday") ? "workday" : host.includes("ashby") ? "ashby" : "company_careers";
export const retryDelayMinutes = (attempt) => attempt >= 4 ? 60 : attempt === 3 ? 15 : attempt === 2 ? 5 : 1;

export async function fetchOfficial(url) {
  let current = canonicalUrl(url);
  for (let redirect = 0; redirect < 4; redirect++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" || !isOfficialHost(parsed.hostname)) throw new Error("unverified_official_posting_url");
    const addresses = await lookup(parsed.hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("unsafe_posting_host");
    const response = await fetch(current, { redirect: "manual", headers: { "user-agent": "GATE-Hybrid-Watcher/2.0 (+job-hunt-os)" }, signal: AbortSignal.timeout(30_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const next = response.headers.get("location"); if (!next) throw new Error("posting_redirect_missing_location"); current = new URL(next, current).toString(); continue; }
    if (!response.ok) throw new Error(`posting_http_${response.status}`);
    const reader = response.body?.getReader(); if (!reader) throw new Error("posting_body_missing");
    const chunks = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > MAX_POSTING_BYTES) throw new Error("posting_too_large"); chunks.push(value); }
    const html = Buffer.concat(chunks).toString("utf8");
    const raw = textOnly(html); if (raw.length < 200) throw new Error("posting_too_short");
    const title = textOnly(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    return { url: canonicalUrl(current), raw, title, provider: providerOf(new URL(current).hostname) };
  }
  throw new Error("posting_redirect_limit");
}

const stringArray = (value, maximum = 100) => Array.isArray(value) ? value.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, maximum) : [];
const skillFacts = (values) => stringArray(values).map((skill) => ({ skill, provenance: "stated", confidence: 0.8 }));
const statementFacts = (values) => stringArray(values).map((value) => ({ value, provenance: "stated", confidence: 0.8 }));
const KNOWN_SKILLS = ["PHP", "Laravel", "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust", "Dart", "Flutter", "React", "Angular", "Vue", "Node.js", "Next.js", "SQL", "PostgreSQL", "PostGIS", "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Git", "Linux", "Terraform", "GraphQL", "REST", "Machine Learning", "TensorFlow", "PyTorch"];
const CANDIDATE_PROFILE = {
  degree: "B.S. Computer Science, Mathematics minor",
  graduation: "May 2028",
  experience_years: 10,
  skills: new Set(["PHP","Laravel","JavaScript","TypeScript","Python","Dart","Flutter","React","Next.js","SQL","PostgreSQL","PostGIS","Redis","Docker","Git","Linux","REST"]),
  evidence: ["10+ years full-stack software engineering", "GHADAS: Next.js, Laravel, PostgreSQL/PostGIS, Redis, Docker", "MantleCall: Next.js + Laravel", "RyyHub: Laravel + Flutter", "Pewbeam/Rhema open-source contributor", "Taught 250+ students application development"]
};
function profileAssessment(text, skills) {
  const matched = skills.filter((skill) => CANDIDATE_PROFILE.skills.has(skill));
  const missing = skills.filter((skill) => !CANDIDATE_PROFILE.skills.has(skill));
  const technical_fit = skills.length ? Math.round((matched.length / skills.length) * 100) : 70;
  const education_fit = /computer science|software engineering|related field|bachelor|university|college|student/i.test(text) ? 100 : 80;
  const experience_fit = /intern(ship)?|student|early career/i.test(text) ? 100 : 85;
  const project_fit = matched.length ? Math.min(100, 70 + matched.length * 5) : 75;
  const match_score = Math.round(technical_fit * 0.55 + experience_fit * 0.15 + education_fit * 0.10 + project_fit * 0.20);
  const satisfies = matched.map((skill) => ({ requirement: skill, evidence: `Posting mentions ${skill}`, profile_evidence: `Candidate profile includes ${skill}`, confidence: 0.9 }));
  const gaps = missing.map((skill) => ({ requirement: skill, type: "technical_skill", status: "not_in_profile", reason: "Skill is stated in the posting but is not currently present in the candidate profile.", severity: "review" }));
  const usPerson = /\bU\.S\. person\b|\bUS person\b/i.test(text);
  const citizen = /U\.S\. citizen|US citizen|citizenship required/i.test(text);
  const eligibility_risk = usPerson || citizen ? "high" : "unknown";
  const eligibility_risk_reason = usPerson ? "Posting appears to state a U.S.-person requirement; verify exact employer language." : citizen ? "Posting appears to state a U.S.-citizenship requirement; verify exact employer language." : "F-1/CPT/sponsorship policy is not inferred when the posting does not state it.";
  return { match_score, technical_fit, education_fit, experience_fit, project_fit, matched, missing, satisfies, gaps, eligibility_risk, eligibility_risk_reason };
}
const firstMatch = (text, expressions) => expressions.map((expression) => expression.exec(text)?.[1]?.trim()).find(Boolean) || null;
const literalPattern = (value) => new RegExp(`(?<![A-Za-z0-9_])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "i");

// Conservative no-key mode: only literal source facts are retained; uncertainty
// stays explicit instead of being filled with an AI guess.
export function extractSourceFacts(posting, row = {}) {
  const text = posting.raw;
  const title = firstMatch(posting.title || "", [/Job Application for (.+?) at /i, /^(.+?)\s+(?:\||-|–)\s+.+$/]) || row.title || posting.title || null;
  const company = firstMatch(posting.title || "", [/\bat\s+(.+?)(?:\s*[|–-]|$)/i, /\|\s*([^|]+)$/]) || firstMatch(text.slice(0, 1200), [/(?:about|join)\s+([A-Z][\w.& -]{1,80})/]) || null;
  const skills = KNOWN_SKILLS.filter((skill) => literalPattern(skill).test(text));
  const work = /\bhybrid\b/i.test(text) ? "hybrid" : /\bremote\b/i.test(text) ? "remote" : /\bon[ -]?site\b/i.test(text) ? "onsite" : "unknown";
  const employment = /\bintern(ship)?\b/i.test(text) ? "internship" : /\bfull[ -]?time\b/i.test(text) ? "full_time" : /\bpart[ -]?time\b/i.test(text) ? "part_time" : "unknown";
  const degree = firstMatch(text, [/\b(bachelor(?:'s)?|master(?:'s)?|ph\.?d\.?|degree)\b[^.]{0,180}/i]);
  const deadline = firstMatch(text, [/(?:apply|applications?)\s+(?:by|before)\s+([^.;]{3,60})/i]);
  return { company_name: company, title, normalized_title: title, employment_type: employment, description_summary: text.slice(0, 600), location: { work_arrangement: work }, required_skills: skills, technologies: skills, technical_stack: { languages: skills.filter((x) => ["JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust"].includes(x)), frameworks: skills.filter((x) => ["React", "Angular", "Vue", "Node.js", "Next.js"].includes(x)), databases: skills.filter((x) => ["PostgreSQL", "MySQL", "MongoDB", "Redis"].includes(x)), cloud: skills.filter((x) => ["AWS", "Azure", "GCP"].includes(x)) }, education: degree ? { requirement: degree } : {}, deadline, assessment_confidence: 0.35, eligibility_risk: "unknown", eligibility_risk_reason: "Not stated in the official posting.", unknown: ["candidate_profile", "compensation", "eligibility"] };
}
export function completeRecord(row, posting, extracted = {}, profile = {}) {
  const now = new Date().toISOString();
  const company = typeof extracted.company_name === "string" && extracted.company_name.trim() ? extracted.company_name.trim() : null;
  if (!company) throw new Error("company_name_not_extracted");
  const title = typeof extracted.title === "string" && extracted.title.trim() ? extracted.title.trim() : posting.title || row.title;
  if (!title) throw new Error("title_not_extracted");
  const hash = sha256(`${company.toLowerCase()}|${title.toLowerCase()}|${posting.url}`);
  const fallbackAssessment = profileAssessment(posting.raw, stringArray(extracted.technologies?.length ? extracted.technologies : extracted.required_skills));
  const score = Number.isFinite(extracted.match_score) ? Math.max(0, Math.min(100, Number(extracted.match_score))) : fallbackAssessment.match_score;
  const location = extracted.location && typeof extracted.location === "object" ? extracted.location : {};
  const compensation = extracted.compensation && typeof extracted.compensation === "object" ? extracted.compensation : {};
  const eligibility = extracted.eligibility && typeof extracted.eligibility === "object" ? extracted.eligibility : {};
  return {
    event: "gate.opportunity.discovered", schema_version: "2.0",
    identity: { fingerprint: `sha256:${hash}`, external_job_id: null, is_duplicate: false, record_type: "new" },
    search: { watch_id: row.watch_id || "summer-2027-swe-internships", season: row.season || "Summer 2027", country: row.country || "US", searched_at: now },
    original_posting: { canonical_url: posting.url, source_url: posting.url, source_provider: posting.provider, official_source: true, captured_at: now, posting_status: "open", content_hash: `sha256:${sha256(posting.raw)}`, raw_title: title, raw_description: posting.raw, raw_location: typeof location.raw === "string" ? location.raw : null, snapshot_version: 1 },
    company: { name: company, website: extracted.company_website || null, careers_url: extracted.careers_url || null },
    opportunity: { title, normalized_title: extracted.normalized_title || title, track: extracted.track || "software_engineering", employment_type: extracted.employment_type || "internship", season: row.season || "Summer 2027", description_summary: extracted.description_summary || "", team: extracted.team || {}, location: { cities: stringArray(location.cities, 20), states: stringArray(location.states, 20), country: location.country || row.country || "US", work_arrangement: location.work_arrangement || "unknown", office_days_per_week: Number.isFinite(location.office_days_per_week) ? location.office_days_per_week : null, location_restrictions: stringArray(location.restrictions, 50), travel_required: null, relocation_required: null }, internship: extracted.internship || {}, application: { status: "open", posted_at: null, deadline: extracted.deadline || null, apply_url: posting.url, materials: extracted.materials || {} } },
    structured_facts: { responsibilities: statementFacts(extracted.responsibilities), expected_outcomes: statementFacts(extracted.expected_outcomes), required_skills: skillFacts(extracted.required_skills), preferred_skills: skillFacts(extracted.preferred_skills), technologies: stringArray(extracted.technologies, 200), technical_stack: extracted.technical_stack || {}, education: extracted.education || {}, experience_requirements: extracted.experience_requirements || {}, compensation, eligibility, hiring_process: extracted.hiring_process || {}, contacts: [] },
    gate_assessment: { match: { score, level: score >= 85 ? "strong" : score >= 65 ? "moderate" : "weak", reason: extracted.match_reason || "Profile-based assessment using explicit posting technologies and candidate evidence.", technical_fit: Number.isFinite(extracted.technical_fit) ? extracted.technical_fit : fallbackAssessment.technical_fit, experience_fit: Number.isFinite(extracted.experience_fit) ? extracted.experience_fit : fallbackAssessment.experience_fit, education_fit: Number.isFinite(extracted.education_fit) ? extracted.education_fit : fallbackAssessment.education_fit }, satisfies: Array.isArray(extracted.satisfies) && extracted.satisfies.length ? extracted.satisfies : fallbackAssessment.satisfies, missing: Array.isArray(extracted.missing) && extracted.missing.length ? extracted.missing : fallbackAssessment.gaps, unknown: Array.isArray(extracted.unknown) ? extracted.unknown : [], supporting_resume_experience: CANDIDATE_PROFILE.evidence.map((x) => ({ project_or_role: x, supports: fallbackAssessment.matched })), recommended_resume: { emphasis: fallbackAssessment.matched.slice(0, 12) }, recommended_next_action: extracted.recommended_next_action || "Review the official posting and confirm any unstated work-authorization requirements.", eligibility_risk: extracted.eligibility_risk || fallbackAssessment.eligibility_risk, eligibility_risk_reason: extracted.eligibility_risk_reason || fallbackAssessment.eligibility_risk_reason, assessment_confidence: Number.isFinite(extracted.assessment_confidence) ? extracted.assessment_confidence : (fallbackAssessment.matched.length ? 0.82 : 0.58) },
    match: { score, reason: extracted.match_reason || "Profile-based assessment using explicit posting technologies and candidate evidence.", already_satisfies: Array.isArray(extracted.satisfies) && extracted.satisfies.length ? extracted.satisfies : fallbackAssessment.satisfies, missing: Array.isArray(extracted.missing) && extracted.missing.length ? extracted.missing : fallbackAssessment.gaps, unknown: Array.isArray(extracted.unknown) ? extracted.unknown : [], supporting_evidence: CANDIDATE_PROFILE.evidence, recommended_resume_emphasis: fallbackAssessment.matched.slice(0, 12), eligibility_risk: { level: extracted.eligibility_risk || fallbackAssessment.eligibility_risk, reason: extracted.eligibility_risk_reason || fallbackAssessment.eligibility_risk_reason } },
    source: { first_seen_at: row.discovered_at || now, last_verified_at: now, source_quality: "official", verification_status: "verified", evidence_urls: [posting.url] },
    risk: { scam_risk: "unknown", duplicate_signals: [], data_quality_flags: [] }, change_history: [{ detected_at: now, change_type: "initial_capture" }],
    agent: { name: "GATE Hybrid Watcher", agent_type: "job_discovery", decision: "surface", confidence: 0.75, flags: ["official_source"] },
    metadata: { gate_status: "discovered", discovered_at: row.discovered_at || now, user_action_required: true }
  };
}
