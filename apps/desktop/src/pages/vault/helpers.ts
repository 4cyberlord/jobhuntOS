import type { Credential, CredType } from "../../lib/types";

export type SecStatus = "strong" | "medium" | "attention" | "nopw";
export const CRED_TYPES: CredType[] = ["Company", "HR Platform", "ATS", "Social", "Job Board"];
export const MFA_LABEL: Record<Credential["mfa"], string> = { none: "Not Enabled", authenticator: "Authenticator App", sms: "SMS", email: "Email" };
export const TYPE_CLASS: Record<CredType, string> = { Company: "company", "HR Platform": "hr", ATS: "ats", Social: "social", "Job Board": "board" };

export const ownerName = (c: Credential) => c.company || c.portal;

/** Map fingerprint -> number of credentials sharing it. */
export function fingerprintCounts(creds: Credential[]) {
  const m = new Map<string, number>();
  for (const c of creds) if (c.fingerprint) m.set(c.fingerprint, (m.get(c.fingerprint) ?? 0) + 1);
  return m;
}
export const reusedIn = (c: Credential, counts: Map<string, number>) => (c.fingerprint ? Math.max(0, (counts.get(c.fingerprint) ?? 1) - 1) : 0);

export function secStatus(c: Credential, counts: Map<string, number>): SecStatus {
  if (!c.secret) return "nopw";
  if (c.strength === "weak" || reusedIn(c, counts) > 0) return "attention";
  return c.strength === "medium" ? "medium" : "strong";
}
export const SEC_LABEL: Record<SecStatus, string> = { strong: "Strong", medium: "Medium", attention: "Needs Attention", nopw: "No password" };

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const hostOf = (domain: string) => domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
export const urlOf = (domain: string) => (/^https?:\/\//.test(domain) ? domain : `https://${domain}`);
