// Match an email to an existing Job or Gate opportunity (fuzzy, ranked).
// Never auto-creates a new Job. Returns best match + score, or null for manual review.
import type { AppData, GateOpportunity, Job } from "./types";
import { isOpen } from "./gate";

function norm(s: string) { return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function tokens(s: string) { return norm(s).split(/\s+/).filter((t) => t.length > 1); }
function domainOf(url?: string) {
  try { if (!url) return ""; const u = new URL(url.startsWith("http") ? url : `https://${url}`); return u.hostname.toLowerCase(); } catch { return ""; }
}
function senderDomain(from: string) {
  const m = from.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1] : "";
}
// Strip ATS subdomain noise: "apply.greenhouse.io" → "greenhouse.io"
function rootDomain(domain: string) {
  const parts = domain.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : domain;
}

// Known ATS platforms — when sender is one of these, company must be extracted from body
const ATS_DOMAINS = [
  "greenhouse.io", "lever.co", "workday.com", "myworkday.com", "ashbyhq.com",
  "ashby.com", "icims.com", "taleo.net", "smartrecruiters.com", "jobvite.com",
  "brassring.com", "successfactors.com", "recruitee.com", "bamboohr.com",
  "rippling.com", "ripplematch.com", "handshake.com", "indeed.com",
  "linkedin.com", "ziprecruiter.com", "glassdoor.com", "hackerrank.com",
  "codesignal.com", "codility.com", "coderpad.io", "karat.com",
  "hirevue.com", "sparkhire.com", "modernhire.com",
];

// Company name aliases/variations that should be treated as the same company
const COMPANY_ALIASES: Record<string, string[]> = {
  "google": ["google", "googler", "alphabet"],
  "meta": ["meta", "facebook", "instagram", "whatsapp"],
  "amazon": ["amazon", "aws", "alexa"],
  "microsoft": ["microsoft", "msft", "azure", "github"],
  "apple": ["apple", "icloud"],
  "netflix": ["netflix", "nflx"],
  "uber": ["uber", "uber eats", "ubereats"],
  "airbnb": ["airbnb", "air bnb"],
};

function expandAliases(company: string): string[] {
  const n = norm(company);
  for (const [, aliases] of Object.entries(COMPANY_ALIASES)) {
    if (aliases.includes(n)) return aliases;
  }
  return [n];
}

// Extract role title(s) from email body using common ATS patterns
function extractRolesFromBody(hay: string): string[] {
  const roles: string[] = [];
  const patterns = [
    // "position: Software Engineer Intern"
    /(?:position|role|job title|title|opening|opportunity)[:\s]+([^\n,]{5,80})/gi,
    // "applied for Software Engineer Intern"
    /(?:applied for|applying for|application for|interest in the|interest in our|for the)\s+([^\n,]{5,80})/gi,
    // "Software Engineer Intern at Google"
    /([a-z][^\n,]{4,60}?)\s+(?:at|@)\s+[a-z][a-z\s]{2,40}/gi,
    // "your application to the Software Engineer Intern position"
    /(?:the|our)\s+([a-z][^\n,]{4,60}?)\s+(?:position|role|opportunity|job|opening)/gi,
    // "Thank you for your application to Software Engineer Intern"
    /(?:application to|applying to)\s+(?:the\s+)?([a-z][^\n,]{4,70})/gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      const candidate = m[1]?.trim();
      if (candidate && candidate.length > 3 && candidate.length < 100) {
        roles.push(norm(candidate));
      }
    }
  }
  return roles;
}

// Extract company name from body when sender is an ATS
function extractCompanyFromBody(hay: string): string[] {
  const companies: string[] = [];
  const patterns = [
    // "your application to Figma"
    /(?:application to|applying to|applied to|interest in)\s+([A-Z][a-zA-Z\s&,.]{1,40}?)(?:\s+for|\s+position|\s+role|[,.\n])/g,
    // "Thank you for applying to Google"
    /(?:thank you for (?:your interest in|applying to|your application to))\s+([A-Z][a-zA-Z\s&,.]{1,40}?)(?:'s|\s+team|\s+for|\s+position|[,.\n])/gi,
    // "From: team@company.com" — already handled via domain
    // "on behalf of Google"
    /on behalf of\s+([A-Z][a-zA-Z\s&,.]{1,40}?)(?:'s?|\s+team|\s+is|[,.\n])/gi,
    // "Google is excited"
    /([A-Z][a-zA-Z]{2,30})\s+(?:is excited|team is|hiring team|talent team|recruiting team)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(hay)) !== null) {
      const c = m[1]?.trim();
      if (c && c.length > 1) companies.push(norm(c));
    }
  }
  return companies;
}

export type MatchResult =
  | { kind: "job"; id: string; score: number; reasons: string[] }
  | { kind: "gate"; id: string; score: number; reasons: string[] }
  | null;

function recencyBonus(ts?: number) {
  if (!ts) return 0;
  const d = (Date.now() - ts) / 86400000;
  if (d < 7) return 0.10;
  if (d < 14) return 0.06;
  if (d < 30) return 0.03;
  return 0;
}

// Jaccard-like overlap: what % of needle tokens appear in haystack
function tokenOverlap(needleToks: string[], hayToks: Set<string>): number {
  if (!needleToks.length) return 0;
  return needleToks.filter((t) => hayToks.has(t)).length / needleToks.length;
}

// Soft partial match: does haystack contain any multi-gram of needle?
function softContains(needle: string, hay: string): boolean {
  const toks = tokens(needle);
  if (!toks.length) return false;
  // Full phrase
  if (hay.includes(needle)) return true;
  // 2-gram overlap
  for (let i = 0; i < toks.length - 1; i++) {
    if (hay.includes(`${toks[i]} ${toks[i + 1]}`)) return true;
  }
  return false;
}

export function matchEmailToJobOrGate(
  data: AppData,
  email: { subject: string; body?: string; from: string; bodyPreview?: string },
): MatchResult {
  const rawHay = `${email.subject} ${email.bodyPreview ?? ""} ${email.body ?? ""}`;
  const hay = norm(rawHay);
  const hayToks = new Set(tokens(hay));
  const from = email.from ?? "";
  const fromDomain = senderDomain(from);
  const fromRootDomain = rootDomain(fromDomain);
  const isATS = ATS_DOMAINS.some((d) => fromDomain.includes(d));

  // Pre-extract roles and companies from the email body for cross-referencing
  const extractedRoles = extractRolesFromBody(hay);
  const extractedCompanies = isATS ? extractCompanyFromBody(rawHay) : [];

  let best: MatchResult = null;
  const consider = (score: number, res: MatchResult) => {
    if (!best || score > (best as { score: number }).score) best = res;
  };

  // ─── TIER 1: Definitive anchors (URL / external_id / requisition ID) ─────────
  for (const g of data.gate) {
    const url = g.envelope.opportunity?.application?.apply_url ?? g.envelope.source?.url ?? "";
    if (url && hay.includes(norm(url).slice(0, 60))) {
      consider(0.99, { kind: "gate", id: g.id, score: 0.99, reasons: ["apply_url in body"] });
    }
    const ext = g.envelope.opportunity?.external_id ?? "";
    if (ext && ext.length > 4 && hay.includes(norm(ext))) {
      consider(0.97, { kind: "gate", id: g.id, score: 0.97, reasons: ["external_id/requisition in body"] });
    }
  }
  for (const j of data.jobs) {
    if (j.url && hay.includes(norm(j.url).slice(0, 60))) {
      consider(0.99, { kind: "job", id: j.id, score: 0.99, reasons: ["job url in body"] });
    }
  }
  // If definitive anchor found, return immediately
  if (best && (best as { score: number }).score >= 0.97) return best;

  // ─── TIER 2: Fuzzy company + role scoring ────────────────────────────────────
  const scoreCandidate = (
    company: string,
    role: string,
    ts: number | undefined,
    website: string | undefined,
    stageBonus: number,
  ): { s: number; reasons: string[] } => {
    const reasons: string[] = [];
    let s = 0;

    // --- Company match ---
    const companyAliases = expandAliases(company);
    const cToks = tokens(company);
    const cOverlap = tokenOverlap(cToks, hayToks);
    const aliasHit = companyAliases.some((alias) => hay.includes(alias));
    const extractedCompanyHit = extractedCompanies.some((ec) =>
      ec.includes(norm(company)) || norm(company).includes(ec) || companyAliases.some((a) => ec.includes(a))
    );

    if (cOverlap >= 0.9 || aliasHit) { s += 0.30; reasons.push("strong company match"); }
    else if (cOverlap >= 0.5) { s += 0.18; reasons.push("partial company match"); }
    else if (extractedCompanyHit) { s += 0.22; reasons.push("company extracted from body"); }

    // --- Domain match ---
    const siteDomain = domainOf(website);
    const siteRoot = rootDomain(siteDomain);
    const companySlug = norm(company).replace(/\s+/g, "");
    // Direct domain alignment: figma.com → figma
    if (fromDomain && (fromDomain.includes(companySlug) || companySlug.includes(fromRootDomain.split(".")[0]))) {
      s += 0.18; reasons.push("sender domain = company");
    } else if (siteDomain && (fromRootDomain === siteRoot || fromDomain.includes(siteRoot.split(".")[0]))) {
      s += 0.14; reasons.push("sender domain matches company website");
    }

    // --- Role match (most critical for disambiguation) ---
    const rToks = tokens(role);
    const rOverlap = tokenOverlap(rToks, hayToks);
    const softRole = softContains(norm(role), hay);
    const extractedRoleHit = extractedRoles.some((er) => {
      const erToks = tokens(er);
      // Check if extracted role and saved role share significant tokens
      const shared = rToks.filter((t) => erToks.includes(t)).length;
      return shared >= Math.min(2, Math.ceil(rToks.length * 0.5));
    });

    if (rOverlap >= 0.8 || softRole) { s += 0.28; reasons.push("strong role match"); }
    else if (rOverlap >= 0.5 || extractedRoleHit) { s += 0.16; reasons.push("partial role match"); }
    else if (rOverlap >= 0.3) { s += 0.06; }

    // --- ATS: when from ATS, extracted company/role matter more ---
    if (isATS) {
      if (extractedCompanyHit) { s += 0.08; reasons.push("ATS + extracted company"); }
      if (extractedRoleHit) { s += 0.08; reasons.push("ATS + extracted role"); }
    }

    // --- Penalize very generic short company names matching common words ---
    if (cToks.length === 1 && cToks[0].length <= 3) s -= 0.15;

    // --- Recency bonus: recent applications more likely to get updates ---
    s += recencyBonus(ts);

    // --- Stage bonus ---
    s += stageBonus;

    return { s: Math.min(0.99, Math.max(0, s)), reasons };
  };

  for (const g of data.gate) {
    const company = g.envelope.company?.name ?? "";
    const role = g.envelope.opportunity?.title ?? "";
    const website = g.envelope.company?.website ?? g.envelope.company?.careers_url ?? undefined;
    const gateBonus = isOpen(g) ? 0.04 : 0;
    const { s, reasons } = scoreCandidate(company, role, g.receivedAt, website, gateBonus);
    consider(s, { kind: "gate", id: g.id, score: Math.min(0.99, s), reasons });
  }

  for (const j of data.jobs) {
    const stageBonus = ["applied", "assessment", "interviewing"].includes(j.status) ? 0.05 : 0;
    const { s, reasons } = scoreCandidate(j.company, j.role, j.addedAt, undefined, stageBonus);
    consider(s, { kind: "job", id: j.id, score: Math.min(0.99, s), reasons });
  }

  if (!best) return null;
  const score = (best as { score: number }).score;
  // Hard floor: below 0.40 → no match, force manual review
  if (score < 0.40) return null;
  return best;
}

export function isAmbiguousMatch(
  data: AppData,
  email: { subject: string; body?: string; from: string; bodyPreview?: string },
  best: MatchResult,
): boolean {
  if (!best) return true;
  const bestScore = (best as { score: number }).score;
  // If best is a definitive anchor match, never treat as ambiguous
  if (bestScore >= 0.97) return false;

  const hay = norm(`${email.subject} ${email.bodyPreview ?? ""} ${email.body ?? ""}`);
  const hayToks = new Set(tokens(hay));
  const extractedRoles = extractRolesFromBody(hay);

  const all = [
    ...data.gate.map((g) => ({ company: g.envelope.company?.name ?? "", role: g.envelope.opportunity?.title ?? "", id: g.id })),
    ...data.jobs.map((j) => ({ company: j.company, role: j.role, id: j.id })),
  ];

  // Count serious contenders: candidates within 0.08 of best score that ALSO share company tokens
  let contenders = 0;
  const bestId = (best as { id: string }).id;
  const bestEntry = all.find((x) => x.id === bestId);
  const bestCompanyToks = tokens(bestEntry?.company ?? "");

  for (const c of all) {
    if (c.id === bestId) continue;
    const cToks = tokens(c.company);
    const rToks = tokens(c.role);
    const cOverlap = tokenOverlap(cToks, hayToks);
    const rOverlap = tokenOverlap(rToks, hayToks);
    const sameCompany = bestCompanyToks.some((t) => cToks.includes(t));

    // A real contender: same company in email + role also partially matches
    const contenderScore = (cOverlap >= 0.6 ? 0.30 : 0) + (rOverlap >= 0.4 ? 0.20 : 0);
    const roleAmbig = extractedRoles.length === 0 && sameCompany && cOverlap >= 0.6;

    if (contenderScore >= bestScore - 0.10 || roleAmbig) contenders++;
  }

  // Ambiguous if:
  // 1. Two or more serious contenders exist, OR
  // 2. Best score is not high enough to trust without role confirmation AND multiple same-company jobs exist
  if (contenders >= 1 && bestScore < 0.85) return true;
  if (contenders >= 2) return true;
  return false;
}
