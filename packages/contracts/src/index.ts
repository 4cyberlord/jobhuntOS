import { z } from "zod";

export const eligibilitySchema = z.object({
  f1Student: z.boolean().optional(), cptPossible: z.enum(["yes", "no", "unknown"]).default("unknown"),
  postingRequires: z.object({ usCitizen: z.boolean().default(false), permanentResident: z.boolean().default(false), usPerson: z.boolean().default(false), unrestrictedWorkAuthorization: z.boolean().default(false) }).default({ usCitizen: false, permanentResident: false, usPerson: false, unrestrictedWorkAuthorization: false }),
  sponsorship: z.object({ internship: z.enum(["available", "not_available", "not_stated"]).default("not_stated"), future: z.enum(["available", "not_available", "not_stated"]).default("not_stated") }).default({ internship: "not_stated", future: "not_stated" })
});

export const agentOpportunitySchema = z.object({
  source: z.string().min(1).max(100), externalId: z.string().min(3).max(200), jobUrl: z.string().url(),
  company: z.object({ name: z.string().min(1).max(200), website: z.string().url().optional() }),
  job: z.object({ title: z.string().min(1).max(200), employmentType: z.literal("internship"), season: z.string().default("Summer 2027"), location: z.object({ city: z.string().optional(), state: z.string().optional(), country: z.string().default("US"), remotePolicy: z.enum(["remote", "hybrid", "onsite", "unknown"]).default("unknown") }), description: z.string().max(50000).optional(), requirements: z.array(z.string()).default([]), deadline: z.string().datetime().nullable().optional() }),
  match: z.object({ score: z.number().min(0).max(100), summary: z.string().max(2000), technical: z.number().min(0).max(100).optional(), education: z.number().min(0).max(100).optional(), graduation: z.number().min(0).max(100).optional(), experience: z.number().min(0).max(100).optional() }),
  eligibility: eligibilitySchema.default({ cptPossible: "unknown", postingRequires: { usCitizen: false, permanentResident: false, usPerson: false, unrestrictedWorkAuthorization: false }, sponsorship: { internship: "not_stated", future: "not_stated" } }), discoveredAt: z.string().datetime()
}).strict();
export type AgentOpportunity = z.infer<typeof agentOpportunitySchema>;

const forbidden = /password|secret|token|credential|mongo(db)?uri/i;
export function containsSensitiveKey(value: unknown): boolean { if (Array.isArray(value)) return value.some(containsSensitiveKey); if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).some(([key, child]) => forbidden.test(key) || containsSensitiveKey(child)); return false; }
export function duplicateKey(item: AgentOpportunity) { return `${item.company.name}|${item.job.title}|${item.job.location.city ?? ""}|${item.jobUrl}`.toLowerCase(); }

export const searchProfile = {
  watch: { title: "Summer 2027 Internship Watch", enabled: true, frequency: "hourly", targetSeason: "Summer 2027", country: "United States" },
  candidate: { graduation: "May 2028", targetRoles: ["Software Engineering Intern", "Full-Stack Engineering Intern", "Backend Engineering Intern", "Platform Engineering Intern", "Cloud Engineering Intern", "AI Engineering Intern", "Machine Learning Engineering Intern", "Data Engineering Intern"], languages: ["PHP", "TypeScript", "JavaScript", "Python", "SQL", "Java", "Swift", "Rust"], frameworks: ["Laravel", "Next.js", "React", "Flutter", "Node.js", "React Native", "Electron"], areas: ["Software Engineering", "Full-Stack Engineering", "Backend Engineering", "Cloud Engineering", "Platform Engineering", "AI Engineering", "Machine Learning", "Data Engineering", "Developer Tools"] },
  filters: { internshipOnly: true, summer2027Only: true, applicationStatus: "open", studentEligible: true, avoidDuplicates: true }
} as const;
export * from "./gate.js";
export * from "./legacy.js";
