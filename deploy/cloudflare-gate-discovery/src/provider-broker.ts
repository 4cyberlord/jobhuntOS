export type ProviderResult = { url?: string; title?: string; content?: string };
export type ProviderCapability = "search" | "crawl";

export interface ProviderEnv {
  GATE_STATUS: KVNamespace;
  TAVILY_API_KEY?: string;
  EXA_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  YEP_API_KEY?: string;
  YEP_API_URL?: string;
  LANGSEARCH_API_KEY?: string;
  SEARCHAPI_API_KEY?: string;
  SERPLY_API_KEY?: string;
  SEARCH1API_KEY?: string;
  CRAWLERAPI_API_KEY?: string;
  SIMPLECRAWL_API_KEY?: string;
  PILOTERR_API_KEY?: string;
  YAERIS_API_KEY?: string;
  CRAWLERAPI_ENDPOINT?: string;
}

type ProviderSpec = {
  id: string;
  envKey: keyof ProviderEnv;
  capability: ProviderCapability;
  budgetType: "monthly" | "daily" | "one_time" | "unknown";
  advertisedLimit?: number | null;
  dailySoftLimit: number;
  reservePercent: number;
  notes: string;
  adapter: "search" | "crawl" | "catalog";
};

export const PROVIDERS: ProviderSpec[] = [
  { id:"tavily", envKey:"TAVILY_API_KEY", capability:"search", budgetType:"monthly", advertisedLimit:1000, dailySoftLimit:18, reservePercent:15, notes:"1,000 API credits/month", adapter:"search" },
  { id:"exa", envKey:"EXA_API_KEY", capability:"search", budgetType:"monthly", advertisedLimit:null, dailySoftLimit:10, reservePercent:20, notes:"$10 free credits/month", adapter:"search" },
  { id:"firecrawl", envKey:"FIRECRAWL_API_KEY", capability:"search", budgetType:"monthly", advertisedLimit:1000, dailySoftLimit:10, reservePercent:20, notes:"1,000 credits/month; search costs 2 credits", adapter:"search" },
  { id:"yep", envKey:"YEP_API_KEY", capability:"search", budgetType:"one_time", advertisedLimit:1000, dailySoftLimit:4, reservePercent:25, notes:"1,000 free requests on signup", adapter:"catalog" },
  { id:"langsearch", envKey:"LANGSEARCH_API_KEY", capability:"search", budgetType:"daily", advertisedLimit:null, dailySoftLimit:12, reservePercent:20, notes:"free plan with daily token allowance", adapter:"search" },
  { id:"searchapi", envKey:"SEARCHAPI_API_KEY", capability:"search", budgetType:"one_time", advertisedLimit:100, dailySoftLimit:2, reservePercent:30, notes:"100 free requests", adapter:"search" },
  { id:"serply", envKey:"SERPLY_API_KEY", capability:"search", budgetType:"one_time", advertisedLimit:2500, dailySoftLimit:10, reservePercent:25, notes:"2,500 signup credits valid for 30 days", adapter:"search" },
  { id:"search1api", envKey:"SEARCH1API_KEY", capability:"search", budgetType:"one_time", advertisedLimit:100, dailySoftLimit:1, reservePercent:40, notes:"100 free credits; no expiry", adapter:"search" },
  { id:"crawlerapi", envKey:"CRAWLERAPI_API_KEY", capability:"crawl", budgetType:"monthly", advertisedLimit:1000, dailySoftLimit:8, reservePercent:20, notes:"1,000 free credits/month", adapter:"catalog" },
  { id:"simplecrawl", envKey:"SIMPLECRAWL_API_KEY", capability:"crawl", budgetType:"unknown", advertisedLimit:null, dailySoftLimit:4, reservePercent:30, notes:"free tier; no card", adapter:"crawl" },
  { id:"piloterr", envKey:"PILOTERR_API_KEY", capability:"crawl", budgetType:"one_time", advertisedLimit:500, dailySoftLimit:2, reservePercent:30, notes:"500 free starter credits", adapter:"crawl" },
  { id:"yaeris", envKey:"YAERIS_API_KEY", capability:"crawl", budgetType:"one_time", advertisedLimit:100, dailySoftLimit:1, reservePercent:40, notes:"100 signup credits", adapter:"catalog" },
];

const dayKey = (id:string) => `provider-usage:${id}:day:${new Date().toISOString().slice(0,10)}`;
const totalKey = (id:string) => `provider-usage:${id}:total`;
const healthKey = (id:string) => `provider-health:${id}`;

async function readNumber(kv:KVNamespace,key:string){ return Number(await kv.get(key)||"0"); }
async function bump(kv:KVNamespace,key:string,ttl?:number){
  const n=(await readNumber(kv,key))+1;
  await kv.put(key,String(n),ttl?{expirationTtl:ttl}:undefined);
  return n;
}
async function mark(env:ProviderEnv,id:string,ok:boolean,error?:string){
  const prev=JSON.parse(await env.GATE_STATUS.get(healthKey(id))||"{}") as Record<string,unknown>;
  const value={
    ...prev,
    healthy:ok,
    last_checked_at:new Date().toISOString(),
    last_success_at:ok?new Date().toISOString():(prev.last_success_at??null),
    consecutive_failures:ok?0:Number(prev.consecutive_failures||0)+1,
    last_error:ok?null:(error||"provider_error").slice(0,300),
  };
  await env.GATE_STATUS.put(healthKey(id),JSON.stringify(value),{expirationTtl:60*60*24*45});
}
async function canUse(env:ProviderEnv,spec:ProviderSpec){
  const key=env[spec.envKey];
  if(typeof key!=="string"||!key.trim()) return false;
  const used=await readNumber(env.GATE_STATUS,dayKey(spec.id));
  return used<spec.dailySoftLimit;
}
async function countUse(env:ProviderEnv,id:string){
  await bump(env.GATE_STATUS,dayKey(id),60*60*24*3);
  await bump(env.GATE_STATUS,totalKey(id));
}

function normalizeRows(value:any):ProviderResult[]{
  const candidates = Array.isArray(value) ? value :
    Array.isArray(value?.results) ? value.results :
    Array.isArray(value?.data) ? value.data :
    Array.isArray(value?.data?.web) ? value.data.web :
    Array.isArray(value?.organic_results) ? value.organic_results :
    Array.isArray(value?.web?.results) ? value.web.results : [];
  return candidates.map((r:any)=>({
    url:r?.url||r?.link||r?.href,
    title:r?.title||r?.name,
    content:r?.content||r?.text||r?.snippet||r?.description||r?.highlights?.join?.(" ")
  })).filter((r:ProviderResult)=>typeof r.url==="string");
}

async function providerSearch(env:ProviderEnv,id:string,query:string,max=10):Promise<ProviderResult[]>{
  const key=(name:keyof ProviderEnv)=>String(env[name]||"");
  let response:Response;
  if(id==="tavily"){
    response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({api_key:key("TAVILY_API_KEY"),query,search_depth:"basic",max_results:max,topic:"general",include_answer:false})});
  } else if(id==="exa"){
    response=await fetch("https://api.exa.ai/search",{method:"POST",headers:{"content-type":"application/json","x-api-key":key("EXA_API_KEY")},body:JSON.stringify({query,numResults:max,type:"fast"})});
  } else if(id==="firecrawl"){
    response=await fetch("https://api.firecrawl.dev/v2/search",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("FIRECRAWL_API_KEY")}`},body:JSON.stringify({query,limit:max,sources:["web"]})});
  } else if(id==="langsearch"){
    response=await fetch("https://api.langsearch.com/v1/web-search",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("LANGSEARCH_API_KEY")}`},body:JSON.stringify({query,freshness:"noLimit",summary:true,count:max})});
  } else if(id==="searchapi"){
    const u=new URL("https://www.searchapi.io/api/v1/search");u.searchParams.set("engine","google");u.searchParams.set("q",query);u.searchParams.set("num",String(Math.min(max,10)));
    response=await fetch(u,{headers:{authorization:`Bearer ${key("SEARCHAPI_API_KEY")}`}});
  } else if(id==="serply"){
    const u=new URL("https://api.serply.io/v1/search/");u.searchParams.set("q",query);u.searchParams.set("num",String(Math.min(max,10)));
    response=await fetch(u,{headers:{"X-Api-Key":key("SERPLY_API_KEY"),"X-Proxy-Location":"US","X-User-Agent":"desktop"}});
  } else if(id==="search1api"){
    response=await fetch("https://api.search1api.com/search",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("SEARCH1API_KEY")}`},body:JSON.stringify({query,max_results:max,search_service:"google"})});
  } else if(id==="yep"){
    const endpoint=String(env.YEP_API_URL||"").trim();
    if(!endpoint) throw new Error("yep_api_url_not_configured");
    response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("YEP_API_KEY")}`},body:JSON.stringify({query,limit:max})});
  } else throw new Error("unsupported_search_provider");
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`${id}_http_${response.status}:${String((body as any)?.error||"request_failed").slice(0,120)}`);
  return normalizeRows(body).slice(0,max);
}

export async function federatedSearch(env:ProviderEnv,query:string,max=10){
  const searchers=PROVIDERS.filter(p=>p.capability==="search");
  const configured=[] as string[], skipped=[] as string[];
  for(const spec of searchers){
    if(!await canUse(env,spec)){skipped.push(spec.id);continue;}
    configured.push(spec.id);
    try{
      await countUse(env,spec.id);
      const rows=await providerSearch(env,spec.id,query,max);
      await mark(env,spec.id,true);
      if(rows.length) return {provider:spec.id,results:rows,configured,skipped};
    }catch(e){await mark(env,spec.id,false,e instanceof Error?e.message:String(e));}
  }
  return {provider:null,results:[] as ProviderResult[],configured,skipped};
}

async function providerCrawl(env:ProviderEnv,id:string,url:string){
  const key=(name:keyof ProviderEnv)=>String(env[name]||"");
  let response:Response;
  if(id==="firecrawl"){
    response=await fetch("https://api.firecrawl.dev/v2/scrape",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("FIRECRAWL_API_KEY")}`},body:JSON.stringify({url,formats:["markdown","links"]})});
  } else if(id==="simplecrawl"){
    response=await fetch("https://api.simplecrawl.com/v1/scrape",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("SIMPLECRAWL_API_KEY")}`},body:JSON.stringify({url,format:"markdown"})});
  } else if(id==="piloterr"){
    const u=new URL("https://api.piloterr.com/v2/website/crawler");u.searchParams.set("query",url);
    response=await fetch(u,{headers:{"x-api-key":key("PILOTERR_API_KEY")}});
  } else if(id==="crawlerapi"){
    const endpoint=String(env.CRAWLERAPI_ENDPOINT||"").trim();
    if(!endpoint) throw new Error("crawlerapi_endpoint_not_configured");
    response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key("CRAWLERAPI_API_KEY")}`},body:JSON.stringify({url})});
  } else throw new Error("unsupported_crawl_provider");
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(`${id}_http_${response.status}:${String((body as any)?.error||"request_failed").slice(0,120)}`);
  const content=(body as any)?.data?.markdown||(body as any)?.markdown||(body as any)?.content||(body as any)?.data?.content||(body as any)?.html||(body as any)?.data?.html||"";
  const links=(body as any)?.data?.links||(body as any)?.links||[];
  return {content:String(content||""),links:Array.isArray(links)?links:[]};
}

export async function federatedCrawl(env:ProviderEnv,url:string){
  const order=["firecrawl","simplecrawl","piloterr","crawlerapi"];
  for(const id of order){
    const spec=PROVIDERS.find(p=>p.id===id);
    if(!spec||!await canUse(env,spec)) continue;
    try{
      await countUse(env,id);
      const result=await providerCrawl(env,id,url);
      await mark(env,id,true);
      if(result.content||result.links.length) return {provider:id,...result};
    }catch(e){await mark(env,id,false,e instanceof Error?e.message:String(e));}
  }
  return {provider:null,content:"",links:[] as unknown[]};
}

export async function providerStatus(env:ProviderEnv){
  const items=[];
  for(const spec of PROVIDERS){
    const configured=typeof env[spec.envKey]==="string"&&String(env[spec.envKey]).trim().length>0;
    const usedToday=await readNumber(env.GATE_STATUS,dayKey(spec.id));
    const totalUsed=await readNumber(env.GATE_STATUS,totalKey(spec.id));
    const health=JSON.parse(await env.GATE_STATUS.get(healthKey(spec.id))||"{}");
    items.push({...spec,configured,integration_state:configured?(spec.adapter==="catalog"?"credential_present_adapter_pending":(health.healthy===true?"verified":health.last_checked_at?"failing":"configured_untested")):"not_configured",used_today:usedToday,total_used:totalUsed,remaining_today:Math.max(0,spec.dailySoftLimit-usedToday),...health});
  }
  return {generated_at:new Date().toISOString(),providers:items};
}

export async function testConfiguredProviders(env:ProviderEnv){
  const query='"Summer 2027" "Software Engineer Intern"';
  const results=[];
  for(const spec of PROVIDERS){
    const configured=typeof env[spec.envKey]==="string"&&String(env[spec.envKey]).trim().length>0;
    if(!configured){results.push({provider:spec.id,status:"not_configured"});continue;}
    if(spec.adapter==="catalog"){results.push({provider:spec.id,status:"adapter_pending"});continue;}
    try{
      if(spec.capability==="search"){
        const rows=await providerSearch(env,spec.id,query,3);
        await mark(env,spec.id,true);
        results.push({provider:spec.id,status:"ok",results:rows.length});
      }else{
        const page=await providerCrawl(env,spec.id,"https://example.com/");
        await mark(env,spec.id,true);
        results.push({provider:spec.id,status:"ok",content_bytes:page.content.length,links:page.links.length});
      }
    }catch(e){
      const error=e instanceof Error?e.message:String(e);
      await mark(env,spec.id,false,error);
      results.push({provider:spec.id,status:"failed",error});
    }
  }
  return {tested_at:new Date().toISOString(),results};
}
