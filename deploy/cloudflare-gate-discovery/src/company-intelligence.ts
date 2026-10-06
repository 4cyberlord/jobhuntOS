import { reserveTavilyCredit } from "./usage";
export type IntelligenceCandidate = {
  url: string;
  title?: string;
  source: "company_intelligence";
  discovered_at: string;
  company_id: string;
  company_name: string;
  allowed_host: string;
};

type IntelligenceEnv = {
  TAVILY_API_KEY: string;
  SEASON: string;
  GATE_IMPORT_URL: string;
  GATE_BRIDGE_CRON_SECRET: string;
  GATE_JOURNAL: D1Database;
  GATE_STATUS: KVNamespace;
  CANDIDATES: Queue<unknown>;
};

type DueCompany = {
  company: {
    id: string;
    canonical_name: string;
    legal_name?: string | null;
    website?: string | null;
    industry?: string | null;
    state?: string | null;
    priority?: number;
    verified_source_count?: number;
  };
  career_sources: Array<{
    id?: string;
    url: string;
    host?: string;
    provider?: string;
    verification_status?: string;
    active?: boolean;
  }>;
  needs_enrichment: boolean;
};

type SearchResult = { url?: string; title?: string; content?: string };

const TECH_TERMS = [
  "software engineer", "software engineering", "software developer", "backend", "frontend",
  "full stack", "platform engineer", "cloud engineer", "infrastructure", "devops",
  "site reliability", "security engineer", "cybersecurity", "data engineer",
  "machine learning", "ai engineer", "mobile engineer", "ios engineer", "technology intern"
];

const ATS_HOSTS = ["greenhouse.io","lever.co","myworkdayjobs.com","ashbyhq.com","smartrecruiters.com","icims.com"];
const providerOf = (host: string) =>
  host.includes("greenhouse") ? "greenhouse" :
  host.includes("lever") ? "lever" :
  host.includes("workday") ? "workday" :
  host.includes("ashby") ? "ashby" :
  host.includes("smartrecruiters") ? "smartrecruiters" :
  host.includes("icims") ? "icims" : "custom";

const canonicalUrl = (value: string) => {
  const u = new URL(value);
  u.hash = "";
  ["utm_source","utm_medium","utm_campaign","gh_src"].forEach((k)=>u.searchParams.delete(k));
  return u.toString();
};
const hostOf = (value?: string | null) => {
  if (!value) return "";
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./,""); } catch { return ""; }
};
const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const tokens = (value: string) => norm(value).split(" ").filter((x)=>x.length>=3 && !["inc","corp","corporation","company","group","holdings","llc","ltd"].includes(x));
const hostMatches = (host: string, allowed: string) => host === allowed || host.endsWith("." + allowed);
const trustedAts = (host: string) => ATS_HOSTS.some((suffix)=>host===suffix||host.endsWith("." + suffix));
const sha256 = async (value: string) => "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))].map((x)=>x.toString(16).padStart(2,"0")).join("");

const apiBase = (env: IntelligenceEnv) => env.GATE_IMPORT_URL.replace(/\/v1\/internal\/gate-bridge\/import.*$/,"").replace(/\/+$/,"");
async function api(env: IntelligenceEnv, path: string, init: RequestInit = {}) {
  const r = await fetch(apiBase(env)+path, {
    ...init,
    headers: { authorization: `Bearer ${env.GATE_BRIDGE_CRON_SECRET}`, "content-type":"application/json", ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(()=>({})) as any;
  if (!r.ok) throw new Error(body?.error || `company_intelligence_api_${r.status}`);
  return body;
}
async function tavily(env: IntelligenceEnv, query: string, max = 10) {
  if (!await reserveTavilyCredit(env.GATE_STATUS)) return [];
  const response = await fetch("https://api.tavily.com/search", {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({ api_key:env.TAVILY_API_KEY, query, search_depth:"basic", max_results:max, topic:"general", include_answer:false })
  });
  if(!response.ok) throw new Error("tavily_http_"+response.status);
  const body = await response.json() as { results?: SearchResult[] };
  return body.results ?? [];
}

function companyResultScore(name: string, row: SearchResult) {
  if (!row.url) return -999;
  let host=""; try { host=new URL(row.url).hostname.toLowerCase().replace(/^www\./,""); } catch { return -999; }
  const hay=norm(`${row.title??""} ${row.content??""} ${host}`);
  const ts=tokens(name);
  let score=0;
  for(const t of ts) if(hay.includes(t)) score+=3;
  if(/career|jobs|employment|work with us|join us/.test(hay)) score+=2;
  if(trustedAts(host)) score+=1;
  if(/linkedin|indeed|glassdoor|ziprecruiter|wikipedia/.test(host)) score-=8;
  return score;
}

function normalizeCareerUrl(raw: string) {
  const u=new URL(raw);
  const host=u.hostname.toLowerCase();
  if(host.includes("greenhouse.io")||host.includes("lever.co")||host.includes("ashbyhq.com")){
    const parts=u.pathname.split("/").filter(Boolean);
    if(parts[0]) u.pathname="/"+parts[0];
    u.search=""; u.hash="";
  }
  return canonicalUrl(u.toString());
}

const stripHtml = (html: string) => html
  .replace(/<script[\s\S]*?<\/script>/gi," ")
  .replace(/<style[\s\S]*?<\/style>/gi," ")
  .replace(/<[^>]+>/g," ")
  .replace(/&nbsp;/g," ")
  .replace(/&amp;/g,"&")
  .replace(/&#39;/g,"'")
  .replace(/&quot;/g,'"')
  .replace(/\s+/g," ")
  .trim();

async function directSourceResults(sourceUrl: string, season: string): Promise<SearchResult[]> {
  let base: URL;
  try { base=new URL(sourceUrl); } catch { return []; }
  const r=await fetch(sourceUrl,{headers:{"user-agent":"GATE-Company-Intelligence/5.0","accept":"text/html,application/xhtml+xml"}});
  if(!r.ok) return [];
  const length=Number(r.headers.get("content-length")||0);
  if(length>1_500_000) return [];
  const html=await r.text();
  if(html.length>1_500_000) return [];
  const rows:SearchResult[]=[];
  const seen=new Set<string>();
  const year=(season.match(/20\d{2}/)||[])[0]||"2027";
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for(let m:RegExpExecArray|null;(m=re.exec(html))&&rows.length<30;){
    let url:URL; try{url=new URL(m[1],base);}catch{continue;}
    if(url.protocol!=="https:"||!hostMatches(url.hostname.toLowerCase(),base.hostname.toLowerCase())) continue;
    const title=stripHtml(m[2]||"");
    const hay=`${title} ${url.pathname}`.toLowerCase();
    if(!hay.includes(year)) continue;
    if(!/intern|internship|co-op|student|early.career/.test(hay)) continue;
    if(!TECH_TERMS.some((term)=>hay.includes(term.split(" ")[0]))&&!/software|engineer|technology|data|security|cloud|platform|developer|machine/.test(hay)) continue;
    const clean=canonicalUrl(url.toString());
    if(seen.has(clean)) continue;
    seen.add(clean);
    rows.push({url:clean,title});
  }
  return rows;
}

async function researchCompany(env: IntelligenceEnv, item: DueCompany) {
  const c=item.company;
  const name=c.canonical_name;
  let website=c.website??null;
  let corporateHost=hostOf(website);

  if(!website){
    const results=await tavily(env,`"${name}" official company website careers jobs`,8);
    const best=results.sort((a,b)=>companyResultScore(name,b)-companyResultScore(name,a))[0];
    if(best?.url && companyResultScore(name,best)>=3){
      try {
        const u=new URL(best.url);
        website=`${u.protocol}//${u.hostname}/`;
        corporateHost=hostOf(website);
      } catch {}
    }
  }

  const existing = new Map<string,{url:string;provider:string;verification_status:string;source_type:string;evidence_url?:string|null}>();
  for(const src of item.career_sources??[]){
    if(!src?.url) continue;
    try {
      const clean=normalizeCareerUrl(src.url);
      existing.set(clean,{url:clean,provider:src.provider||providerOf(hostOf(clean)),verification_status:src.verification_status||"discovered",source_type:"careers",evidence_url:src.url});
    } catch {}
  }

  if(!item.needs_enrichment && existing.size>0){
    return {
      company_id:c.id,
      name,
      legal_name:c.legal_name??null,
      website,
      industry:c.industry??null,
      headquarters:c.state??null,
      priority:Number(c.priority??3),
      career_sources:[...existing.values()].slice(0,20),
      ok:true,
    };
  }

  const queries = corporateHost
    ? [`site:${corporateHost} "${name}" careers jobs`, `"${name}" careers jobs software engineering`]
    : [`"${name}" careers jobs software engineering`];

  for(const q of queries){
    for(const row of await tavily(env,q,10)){
      if(!row.url) continue;
      let u:URL; try{u=new URL(row.url);}catch{continue;}
      if(u.protocol!=="https:") continue;
      const host=u.hostname.toLowerCase();
      const hay=norm(`${row.title??""} ${row.content??""} ${u.pathname}`);
      const mentionsCompany=tokens(name).some((t)=>hay.includes(t));
      const sameCorporate=!!corporateHost && (hostMatches(host,corporateHost)||hostMatches(corporateHost,host));
      const ats=trustedAts(host);
      if(!sameCorporate && !(ats && mentionsCompany)) continue;
      if(!/career|jobs|job|employment|intern|opportunit/.test(hay) && !ats) continue;
      const clean=normalizeCareerUrl(row.url);
      existing.set(clean,{
        url:clean,
        provider:providerOf(host),
        verification_status:sameCorporate?"verified":"discovered",
        source_type:"careers",
        evidence_url:row.url,
      });
    }
  }

  return {
    company_id:c.id,
    name,
    legal_name:c.legal_name??null,
    website,
    industry:c.industry??null,
    headquarters:c.state??null,
    priority:Number(c.priority??3),
    career_sources:[...existing.values()].slice(0,20),
    ok:true,
  };
}

async function queueMatches(env: IntelligenceEnv, item: DueCompany, sources: Array<{url:string;verification_status?:string}>) {
  let discovered=0,queued=0,alreadyKnown=0;
  const company=item.company;
  const prioritized=[...sources].sort((a,b)=>(b.verification_status==="verified"?1:0)-(a.verification_status==="verified"?1:0)).slice(0,3);
  for(const source of prioritized){
    let host=""; try{host=new URL(source.url).hostname.toLowerCase();}catch{continue;}
    let rows=await directSourceResults(source.url,env.SEASON);
    if(rows.length===0){
      const query=`site:${host} "${env.SEASON}" (intern OR internship OR co-op) (software OR engineering OR technology OR data OR security OR cloud OR "machine learning")`;
      rows=await tavily(env,query,10);
    }
    for(const row of rows){
      if(!row.url) continue;
      let u:URL; try{u=new URL(row.url);}catch{continue;}
      if(u.protocol!=="https:" || (!hostMatches(u.hostname.toLowerCase(),host) && !trustedAts(u.hostname.toLowerCase()))) continue;
      const title=row.title?.trim()||"";
      const hay=`${title} ${u.pathname}`.toLowerCase();
      if(!/intern|co-op|student|early.career/.test(hay)) continue;
      if(!TECH_TERMS.some((term)=>hay.includes(term.split(" ")[0])) && !/software|engineer|technology|data|security|cloud|platform|developer|machine/.test(hay)) continue;
      discovered++;
      const clean=canonicalUrl(row.url);
      const key=await sha256(clean);
      const seen=await env.GATE_JOURNAL.prepare("SELECT state FROM gate_journal WHERE url_hash=?").bind(key).first<{state:string}>();
      if(seen){alreadyKnown++;continue;}
      const candidate:IntelligenceCandidate={url:clean,title:row.title,source:"company_intelligence",discovered_at:new Date().toISOString(),company_id:company.id,company_name:company.canonical_name,allowed_host:host};
      await env.CANDIDATES.send(candidate);
      queued++;
    }
  }
  return {discovered,queued,alreadyKnown};
}

export async function scanCompanyIntelligence(env: IntelligenceEnv) {
  const due = await api(env,"/v1/internal/company-intelligence/due?limit=6") as {companies?:DueCompany[]};
  let checked=0,successful=0,discovered=0,queued=0,alreadyKnown=0,failed=0,sourcesAdded=0;

  for(const item of due.companies??[]){
    checked++;
    try{
      const enrichment=await researchCompany(env,item);
      const saved=await api(env,"/v1/internal/company-intelligence/enrich",{method:"POST",body:JSON.stringify(enrichment)}) as {sources_added?:number};
      sourcesAdded+=Number(saved.sources_added??0);
      const scan=await queueMatches(env,item,enrichment.career_sources);
      discovered+=scan.discovered; queued+=scan.queued; alreadyKnown+=scan.alreadyKnown;
      successful++;
    }catch(error){
      failed++;
      await api(env,"/v1/internal/company-intelligence/enrich",{method:"POST",body:JSON.stringify({
        company_id:item.company.id,name:item.company.canonical_name,website:item.company.website??null,
        industry:item.company.industry??null,headquarters:item.company.state??null,priority:Number(item.company.priority??3),career_sources:[],ok:false
      })}).catch(()=>undefined);
      console.warn("company intelligence research failed",item.company.id,String(error));
    }
  }
  return {checked,successful,discovered,queued,already_known:alreadyKnown,failed,sources_added:sourcesAdded,source_of_truth:"render_postgres"};
}

export async function companyIntelligenceView(_env: IntelligenceEnv) {
  const r=await fetch("https://jobhunt-company-intelligence-api.onrender.com/v1/company-intelligence",{headers:{"user-agent":"GATE-Cloudflare-Watcher/4.0"}});
  if(!r.ok) throw new Error("render_company_intelligence_"+r.status);
  return r.json() as Promise<Record<string,unknown>>;
}

export async function upsertCompanyIntelligence(env: IntelligenceEnv, input: unknown) {
  return api(env,"/v1/internal/company-intelligence/enrich",{method:"POST",body:JSON.stringify(input)});
}
