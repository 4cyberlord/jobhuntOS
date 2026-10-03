/* ───────── Working out which website a company's logo should come from ─────────
 * Job records rarely carry a company website, and apply links often point at a job board (Greenhouse, Workday...) or even a
 * university career site, whose icon would be the WRONG brand. So we build an ordered list of likely domains and the app tries
 * them in turn, keeping the first that returns a real icon. Pure and browser-safe, so it is unit-tested in the API suite.
 */

/** Hosts that belong to job boards, applicant-tracking systems or aggregators, never to the hiring company. */
const NOT_A_COMPANY = new Set([
  "ashbyhq.com", "greenhouse.io", "lever.co", "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "icims.com", "linkedin.com",
  "indeed.com", "joinhandshake.com", "handshake.com", "simplify.jobs", "ripplematch.com", "oraclecloud.com", "avature.net", "taleo.net",
  "jobvite.com", "bamboohr.com", "dayforcehiring.com", "ultipro.com", "paylocity.com", "workable.com", "rippling.com", "breezy.hr",
  "recruitee.com", "teamtailor.com", "applytojob.com", "successfactors.com", "successfactors.eu", "adp.com", "glassdoor.com", "ziprecruiter.com",
]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
const SUFFIX_WORDS = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|the)\b/g;

/** "careers.veeam.com" -> "veeam.com", "jobs.acme.co.uk" -> "acme.co.uk". */
export function rootDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const [tld, sld] = [parts[parts.length - 1], parts[parts.length - 2]];
  return parts.slice(tld.length === 2 && SECOND_LEVEL.has(sld) ? -3 : -2).join(".");
}

const hostOf = (url?: string | null) => { try { return url ? new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname : ""; } catch { return ""; } };
const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(SUFFIX_WORDS, " ").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
const isCompanyHost = (root: string) => !!root && !NOT_A_COMPANY.has(root) && !/\.(edu|gov|mil)$/.test(root) && !/\.(edu|gov|ac)\.[a-z]{2}$/.test(root);

/** The company slug an applicant-tracking URL carries: jobs.ashbyhq.com/commure/..., job-boards.greenhouse.io/robinhood/..., acme.wd1.myworkdayjobs.com */
function atsSlug(url?: string | null): string {
  try {
    const u = new URL(url ?? "");
    const root = rootDomain(u.hostname);
    if (!NOT_A_COMPANY.has(root)) return "";
    if (root === "myworkdayjobs.com" || root === "icims.com" || root === "avature.net" || root === "taleo.net") return squash(u.hostname.split(".")[0].replace(/^careers-?/, ""));
    if (["ashbyhq.com", "greenhouse.io", "lever.co", "smartrecruiters.com", "workable.com", "bamboohr.com", "jobvite.com"].includes(root)) return squash(u.pathname.split("/").filter(Boolean)[0] ?? "");
  } catch { /* not a URL */ }
  return "";
}

/** Hand-checked domains for names where a name guess lands on a namesake (verified by reading what each site actually is).
 *  Wins over every guess. Add to it whenever a logo is wrong; a company's own website in the app always wins over this. */
export const KNOWN_DOMAINS: Record<string, string> = {
  citizens: "citizensbank.com", // citizens.co is an unrelated student-portfolio site
  circleback: "circleback.ai", // circleback.com is an older address-book app
  zip: "zip.com", // the procurement company (zip.ai redirects here)
  doordash: "doordash.com", // job links use careersatdoordash.com
  medtronic: "medtronic.com", // these three verify from a laptop but their sites block cloud servers
  workiva: "workiva.com",
  talos: "talostrading.com", // the apply link slug; the homepage names itself "Talos"
};
const knownDomain = (name: string) => KNOWN_DOMAINS[squash(name)];

export type LogoHints = { website?: string | null; applyUrl?: string | null };

/** Ordered, de-duplicated candidate domains, most trustworthy first. */
export function companyDomains(name: string, hints: LogoHints = {}): string[] {
  const out: string[] = [];
  const add = (d: string) => { if (d && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !out.includes(d)) out.push(d); };
  const key = squash(name);
  // 1. a website we were told about
  const site = rootDomain(hostOf(hints.website));
  if (isCompanyHost(site)) add(site);
  const known = knownDomain(name);
  if (known) add(known);
  // 2. the apply link, but only when it plainly belongs to this company (its domain contains the company's name or vice versa)
  const applyRoot = rootDomain(hostOf(hints.applyUrl));
  const label = applyRoot.split(".")[0];
  if (isCompanyHost(applyRoot) && key.length >= 3 && label.length >= 3 && (label.includes(key) || key.includes(label))) add(applyRoot);
  // 3. the company slug inside a job-board link
  const slug = atsSlug(hints.applyUrl);
  const tlds = ["com", "ai", "io", "co"];
  if (slug.length >= 3) for (const t of tlds) add(`${slug}.${t}`);
  // 4. the name itself
  if (key.length >= 3) for (const t of tlds) add(`${key}.${t}`);
  // 5. last resort for names like "IMC Trading" (imc.com): the first word alone, .com only to limit wrong matches
  const first = squash(name.split(/\s+/)[0] ?? "");
  if (first.length >= 3 && first !== key) add(`${first}.com`);
  return out;
}

/** Image URLs to try for a domain, best first. Both hosts are the only ones the desktop app's CSP allows. */
export const logoSources = (domain: string): string[] => [
  `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
];

/* ───────── Verifying a guess ───────── */

/** Domains the data itself vouches for: a website we were given, or an apply link that plainly belongs to the company.
 *  The app shows a logo from these only, so a guessed domain can never put the wrong brand on a job. */
export function evidencedDomains(name: string, hints: LogoHints = {}): string[] {
  const key = squash(name);
  const out: string[] = [];
  const site = rootDomain(hostOf(hints.website));
  if (isCompanyHost(site)) out.push(site);
  const known = knownDomain(name);
  if (known && !out.includes(known)) out.push(known);
  const applyRoot = rootDomain(hostOf(hints.applyUrl));
  const label = applyRoot.split(".")[0];
  if (isCompanyHost(applyRoot) && !out.includes(applyRoot) && key.length >= 3 && label.length >= 3 && (label.includes(key) || key.includes(label))) out.push(applyRoot);
  return out;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#x27;/g, "'");

/** The words a homepage uses to name itself: <title>, og:site_name, og:title, application-name. */
export function pageIdentity(html: string): string[] {
  const grab = (re: RegExp) => { const m = html.match(re); return m ? decode(m[1]).trim() : ""; };
  return [
    grab(/<title[^>]*>([^<]{0,200})<\/title>/i),
    grab(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{0,200})["']/i) || grab(/<meta[^>]+content=["']([^"']{0,200})["'][^>]+property=["']og:site_name["']/i),
    grab(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,200})["']/i) || grab(/<meta[^>]+content=["']([^"']{0,200})["'][^>]+property=["']og:title["']/i),
    grab(/<meta[^>]+name=["']application-name["'][^>]+content=["']([^"']{0,200})["']/i),
  ].filter(Boolean);
}

/** Words that may follow a company name in its own branding ("Citizens Bank", "Acme Inc") without making it a different entity. */
const GENERIC_TAIL = new Set(["bank", "inc", "corp", "co", "hq", "app", "ai", "io", "labs", "lab", "tech", "technologies", "group", "official", "careers", "jobs", "home", "trading", "financial", "software", "systems"]);

/** True when the homepage names THIS company. Each branding segment (title split on | : - etc, og:site_name) must be the company's
 *  name, or the name plus a generic tail. A mere substring is not enough: "Circle Back Cafe" must not verify "Circleback". */
export function homepageMatchesCompany(html: string, name: string): boolean {
  const key = squash(name);
  if (key.length < 3) return false;
  const first = squash(name.split(/\s+/)[0] ?? "");
  const wanted = new Set([key, ...(first.length >= 3 ? [first] : [])]);
  const segments = pageIdentity(html).flatMap((t) => t.split(/\s*[|:\u2013\u2014\u00b7\u2022]\s*|\s+-\s+/)).map(squash).filter(Boolean);
  return segments.some((seg) => [...wanted].some((w) => seg === w || (seg.startsWith(w) && GENERIC_TAIL.has(seg.slice(w.length)))));
}

/** Stable key for matching a company across records ("Acme, Inc." and "ACME" are the same company). */
export const companyKey = squash;
