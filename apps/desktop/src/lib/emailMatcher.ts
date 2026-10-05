// Match an email to an existing Job or Gate opportunity (fuzzy, ranked).
// Never auto-creates a new Job. Returns best match + score, or null for manual review.
import type { AppData, GateOpportunity, Job } from "./types";
import { isOpen } from "./gate";

function norm(s: string) { return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function tokens(s: string) { return norm(s).split(/\s+/).filter(Boolean); }
function domainOf(url?: string) {
  try { if (!url) return ""; const u = new URL(url.startsWith("http") ? url : `https://${url}`); return u.hostname.toLowerCase(); } catch { return ""; }
}
function senderDomain(from: string) {
  const m = from.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1] : "";
}

export type MatchResult =
  | { kind: "job"; id: string; score: number; reasons: string[] }
  | { kind: "gate"; id: string; score: number; reasons: string[] }
  | null;

const RECENCY_DAYS = 30;

function recencyBonus(ts?: number) {
  if (!ts) return 0;
  const d = (Date.now() - ts) / 86400000;
  if (d < 7) return 0.12;
  if (d < 14) return 0.07;
  if (d < 30) return 0.03;
  return 0;
}

export function matchEmailToJobOrGate(
  data: AppData,
  email: { subject: string; body?: string; from: string; bodyPreview?: string },
): MatchResult {
  const hay = norm(`${email.subject} ${email.bodyPreview ?? ""} ${email.body ?? ""}`);
  const hayToks = new Set(tokens(hay));
  const from = email.from ?? "";
  const fromDomain = senderDomain(from);
  const fromNorm = norm(from);

  let best: MatchResult = null;

  const consider = (score: number, res: MatchResult) => {
    if (!best || score > (best as { score: number }).score) best = res;
  };

  // 1) Direct apply_url / external_id in body
  for (const g of data.gate) {
    const url = g.envelope.opportunity?.application?.apply_url ?? g.envelope.source?.url ?? "";
    if (url && hay.includes(norm(url).slice(0, 60))) {
      consider(0.99, { kind: "gate", id: g.id, score: 0.99, reasons: ["apply_url in body"] });
    }
    const ext = g.envelope.opportunity?.external_id;
    if (ext && hay.includes(norm(ext))) {
      consider(0.97, { kind: "gate", id: g.id, score: 0.97, reasons: ["external_id in body"] });
    }
  }
  for (const j of data.jobs) {
    if (j.url && hay.includes(norm(j.url).slice(0, 60))) {
      consider(0.99, { kind: "job", id: j.id, score: 0.99, reasons: ["job url in body"] });
    }
  }

  // 2) Company + role fuzzy
  const scoreCandidate = (company: string, role: string, ts?: number, website?: string) => {
    const cToks = tokens(company);
    const rToks = tokens(role);
    const cHit = cToks.length ? cToks.filter((t) => hayToks.has(t)).length / cToks.length : 0;
    const rHit = rToks.length ? rToks.filter((t) => hayToks.has(t) || hay.includes(t)).length / rToks.length : 0;
    let s = 0.35 * cHit + 0.35 * rHit;
    const reasons: string[] = [];
    if (cHit > 0.6) { s += 0.12; reasons.push("company match"); }
    if (rHit > 0.5) { s += 0.12; reasons.push("role match"); }
    // domain alignment
    const siteDomain = domainOf(website);
    if (siteDomain && (fromDomain.includes(siteDomain.split(".")[0]) || siteDomain.includes(fromDomain.split(".")[0]))) {
      s += 0.14; reasons.push("sender domain matches company");
    }
    // ATS sender bonus: lever/greenhouse/workday carry company name less, so domain already covered
    s += recencyBonus(ts);
    // penalize very short company names that match generic words
    if (cToks.length === 1 && cToks[0].length <= 3) s -= 0.12;
    return { s: Math.min(0.99, Math.max(0, s)), reasons };
  };

  for (const g of data.gate) {
    const company = g.envelope.company?.name ?? "";
    const role = g.envelope.opportunity?.title ?? "";
    const { s, reasons } = scoreCandidate(company, role, g.receivedAt, g.envelope.company?.website ?? g.envelope.company?.careers_url ?? undefined);
    // Prefer open gate opportunities slightly
    const bonus = isOpen(g) ? 0.04 : 0;
    consider(s + bonus, { kind: "gate", id: g.id, score: Math.min(0.99, s + bonus), reasons });
  }
  for (const j of data.jobs) {
    const { s, reasons } = scoreCandidate(j.company, j.role, j.addedAt, undefined);
    // Applied+ pipeline jobs are more likely to get updates
    const stageBonus = ["applied", "assessment", "interviewing"].includes(j.status) ? 0.05 : 0;
    consider(s + stageBonus, { kind: "job", id: j.id, score: Math.min(0.99, s + stageBonus), reasons });
  }

  if (!best) return null;
  const score = (best as { score: number }).score;
  // Thresholds: below 0.45 -> treat as no match (manual review)
  if (score < 0.45) return null;
  // Tie handling: if top two are very close and different ids, we still return best; caller will check confidence gating
  // Detect ambiguous multi-match: if multiple candidates within 0.04, caller should require manual confirm
  void fromNorm;
  return best;
}

export function isAmbiguousMatch(data: AppData, email: { subject: string; body?: string; from: string; bodyPreview?: string }, best: MatchResult): boolean {
  if (!best) return true;
  const threshold = (best as { score: number }).score - 0.04;
  let contenders = 0;
  const hay = norm(`${email.subject} ${email.bodyPreview ?? ""} ${email.body ?? ""}`);
  const hayToks = new Set(tokens(hay));
  const all = [
    ...data.gate.map((g) => ({ company: g.envelope.company?.name ?? "", role: g.envelope.opportunity?.title ?? "", id: g.id })),
    ...data.jobs.map((j) => ({ company: j.company, role: j.role, id: j.id })),
  ];
  for (const c of all) {
    if (c.id === (best as { id: string }).id) continue;
    const cHit = tokens(c.company).filter((t) => hayToks.has(t)).length;
    const rHit = tokens(c.role).filter((t) => hayToks.has(t)).length;
    const s = (cHit > 0 ? 0.3 : 0) + (rHit > 0 ? 0.3 : 0);
    if (s >= threshold - 0.2) contenders++;
  }
  return contenders >= 2;
}
