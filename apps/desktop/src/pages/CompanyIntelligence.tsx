import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon, ArrowTopRightOnSquareIcon, BuildingOffice2Icon, CheckCircleIcon,
  ExclamationTriangleIcon, GlobeAltIcon, MagnifyingGlassIcon, ServerStackIcon,
  ShieldCheckIcon, XMarkIcon,
} from "@heroicons/react/24/outline";
import { readSyncConfig } from "../lib/syncConfig";
import { openExternal } from "../lib/tauri";
import "./company-intelligence/company-intelligence.css";

type Summary = { companies?:number; technical_employers?:number; active_companies?:number; companies_with_failures?:number; career_sources?:number; verified_sources?:number; failing_sources?:number };
type Company = { id:string; canonical_name:string; legal_name?:string|null; state?:string|null; country?:string|null; website?:string|null; industry?:string|null; technical_employer?:boolean|number; priority?:number; active?:boolean|number; last_checked_at?:string|number|null; last_success_at?:string|number|null; next_check_at?:string|number|null; consecutive_failures?:number; source_count?:number; verified_source_count?:number; failing_source_count?:number };
type CareerSource = { id:string; url:string; host:string; source_type:string; provider:string; verification_status:string; active:boolean; last_checked_at?:string|null; last_success_at?:string|null; last_http_status?:number|null; consecutive_failures?:number };
type Discovery = { id:string; title:string; apply_url:string; canonical_url:string; season?:string|null; location?:string|null; work_arrangement?:string|null; discovered_at?:string|null; last_seen_at?:string|null; posting_status?:string|null; match_score?:number|null; eligibility_risk?:string|null; gate_id?:string|null };
type Detail = { ok:boolean; company:Company; career_sources:CareerSource[]; discoveries:Discovery[] };
type IntelligenceResponse = { ok:boolean; generated_at?:string; summary?:Summary; companies?:Company[] };

const fmtTime=(value?:string|number|null)=>{ if(!value)return "Never"; const d=typeof value==="number"?new Date(value*1000):new Date(value); return Number.isNaN(d.getTime())?"Never":d.toLocaleString(); };
const health=(c:Company)=>((c.failing_source_count??0)>0||(c.consecutive_failures??0)>0)?"attention":(c.verified_source_count??0)>0?"healthy":"unknown";

export default function CompanyIntelligence(){
  const [data,setData]=useState<IntelligenceResponse|null>(null), [loading,setLoading]=useState(true), [error,setError]=useState("");
  const [query,setQuery]=useState(""), [filter,setFilter]=useState<"all"|"healthy"|"attention"|"unknown">("all");
  const [reconciling,setReconciling]=useState(false), [reconcileNote,setReconcileNote]=useState("");
  const [detail,setDetail]=useState<Detail|null>(null), [detailLoading,setDetailLoading]=useState(false);

  const auth=()=>{ const cfg=readSyncConfig(); if(!cfg.apiUrl||!cfg.syncKey)throw new Error("Sign in to Job Hunt OS first."); return {base:cfg.apiUrl.replace(/\/+$/,""),headers:{Authorization:`Bearer ${cfg.syncKey}`}}; };
  const load=async()=>{ setLoading(true);setError("");try{const a=auth();const r=await fetch(`${a.base}/v1/desktop/company-intelligence`,{headers:a.headers});if(!r.ok)throw new Error(`Server returned ${r.status}`);setData(await r.json() as IntelligenceResponse);}catch(e){setError(e instanceof Error?e.message:"Could not load Company Intelligence.");}finally{setLoading(false);} };
  useEffect(()=>{void load();},[]);
  const openCompany=async(id:string)=>{setDetailLoading(true);try{const a=auth();const r=await fetch(`${a.base}/v1/desktop/company-intelligence/${encodeURIComponent(id)}`,{headers:a.headers});if(!r.ok)throw new Error(`Server returned ${r.status}`);setDetail(await r.json() as Detail);}catch(e){setError(e instanceof Error?e.message:"Could not load company details.");}finally{setDetailLoading(false);} };
  const reconcile=async()=>{setReconciling(true);setReconcileNote("");try{const a=auth();const r=await fetch(`${a.base}/v1/desktop/company-intelligence/reconcile`,{method:"POST",headers:a.headers});const body=await r.json().catch(()=>({})) as {linked?:number;already_linked?:number;unresolved?:number;error?:string};if(!r.ok)throw new Error(body.error??`Server returned ${r.status}`);setReconcileNote(`${body.linked??0} linked · ${body.already_linked??0} already linked · ${body.unresolved??0} unresolved`);await load();}catch(e){setReconcileNote(e instanceof Error?e.message:"Company reconciliation failed.");}finally{setReconciling(false);} };

  const companies=useMemo(()=>{const q=query.trim().toLowerCase();return(data?.companies??[]).filter(c=>{const h=health(c);if(filter!=="all"&&h!==filter)return false;if(!q)return true;return `${c.canonical_name} ${c.legal_name??""} ${c.industry??""} ${c.state??""} ${c.website??""}`.toLowerCase().includes(q);});},[data,query,filter]);
  const s=data?.summary??{}, monitored=s.active_companies??s.companies??0, technical=s.technical_employers??0, verified=s.verified_sources??0, failing=s.failing_sources??0;

  return <div className="page ci-page">
    <div className="page-head"><div><h1>Company Intelligence</h1><p>Every known employer, official hiring source, and discovered posting behind GATE.</p></div><div className="page-head-actions"><span className="ci-generated">{data?.generated_at?`Updated ${new Date(data.generated_at).toLocaleString()}`:""}</span><button className="btn" onClick={()=>void reconcile()} disabled={reconciling||loading}><ShieldCheckIcon className={reconciling?"ci-spin":""}/>{reconciling?"Linking…":"Link existing companies"}</button><button className="btn" onClick={()=>void load()} disabled={loading}><ArrowPathIcon className={loading?"ci-spin":""}/>Refresh</button></div></div>
    {reconcileNote&&<div className="ci-reconcile-note">{reconcileNote}</div>}
    {error&&<div className="ci-error"><ExclamationTriangleIcon/><span>{error}</span></div>}
    <section className="ci-stats">
      <article className="card ci-stat"><span className="ci-stat-icon blue"><BuildingOffice2Icon/></span><div><small>Companies monitored</small><b>{monitored.toLocaleString()}</b><em>{s.companies_with_failures??0} need attention</em></div></article>
      <article className="card ci-stat"><span className="ci-stat-icon purple"><ServerStackIcon/></span><div><small>Technical employers</small><b>{technical.toLocaleString()}</b><em>Eligible for tech-role scans</em></div></article>
      <article className="card ci-stat"><span className="ci-stat-icon green"><ShieldCheckIcon/></span><div><small>Verified career sources</small><b>{verified.toLocaleString()}</b><em>{s.career_sources??0} total sources</em></div></article>
      <article className="card ci-stat"><span className="ci-stat-icon amber"><ExclamationTriangleIcon/></span><div><small>Failing sources</small><b>{failing.toLocaleString()}</b><em>Require source recovery</em></div></article>
    </section>
    <section className="card ci-panel"><header className="ci-toolbar"><div><b>Employer coverage</b><span>{companies.length} companies shown</span></div><div className="ci-tools"><label className="search-field ci-search"><MagnifyingGlassIcon/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search company, state, industry..."/></label><select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">All health states</option><option value="healthy">Healthy</option><option value="attention">Needs attention</option><option value="unknown">Unverified</option></select></div></header>
      <div className="ci-table-wrap"><table className="ci-table"><thead><tr><th>Company</th><th>Industry</th><th>State</th><th>Priority</th><th>Career sources</th><th>Health</th><th>Last checked</th><th>Next check</th></tr></thead><tbody>
        {!loading&&companies.length===0&&<tr><td colSpan={8}><div className="ci-empty"><GlobeAltIcon/><b>No company records yet</b><span>Once the registry is populated, monitored employers will appear here.</span></div></td></tr>}
        {companies.map(c=>{const h=health(c);return <tr key={c.id} className="ci-clickable" onClick={()=>void openCompany(c.id)}><td><div className="ci-company"><span className="ci-company-mark">{c.canonical_name.slice(0,2).toUpperCase()}</span><span><b>{c.canonical_name}</b><small>{c.website??c.legal_name??c.id}</small></span></div></td><td>{c.industry||"—"}</td><td>{c.state||"—"}</td><td><span className="pill">Tier {c.priority??3}</span></td><td><div className="ci-source-count"><b>{c.verified_source_count??0}</b><span>/ {c.source_count??0} verified</span></div></td><td><span className={`ci-health ${h}`}>{h==="healthy"?<CheckCircleIcon/>:<ExclamationTriangleIcon/>}{h==="healthy"?"Healthy":h==="attention"?"Needs attention":"Unverified"}</span></td><td>{fmtTime(c.last_checked_at)}</td><td>{fmtTime(c.next_check_at)}</td></tr>})}
      </tbody></table></div>
    </section>
    {(detail||detailLoading)&&<div className="ci-overlay" onMouseDown={()=>setDetail(null)}><aside className="card ci-drawer" onMouseDown={e=>e.stopPropagation()}>{detailLoading&&!detail?<div className="ci-detail-loading"><ArrowPathIcon className="ci-spin"/>Loading company intelligence…</div>:detail&&<><header><div><small>COMPANY INTELLIGENCE</small><h2>{detail.company.canonical_name}</h2><p>{detail.company.legal_name||detail.company.id}</p></div><button className="icon-btn ghost" onClick={()=>setDetail(null)}><XMarkIcon/></button></header><div className="ci-drawer-scroll">
      <section><h3>Company identity</h3><div className="ci-kv"><span>Intelligence ID</span><b>{detail.company.id}</b><span>Industry</span><b>{detail.company.industry||"—"}</b><span>Location</span><b>{[detail.company.state,detail.company.country].filter(Boolean).join(", ")||"—"}</b></div>{detail.company.website&&<button className="ci-url" onClick={()=>void openExternal(detail.company.website!)}><GlobeAltIcon/><span><b>Company website</b><small>{detail.company.website}</small></span><ArrowTopRightOnSquareIcon/></button>}</section>
      <section><h3>Career sources <span>{detail.career_sources.length}</span></h3>{detail.career_sources.length===0?<p className="muted">No career sources recorded yet.</p>:detail.career_sources.map(src=><button key={src.id} className="ci-url" onClick={()=>void openExternal(src.url)}><ServerStackIcon/><span><b>{src.provider} · {src.verification_status}</b><small>{src.url}</small><em>{src.last_http_status?`HTTP ${src.last_http_status} · `:""}{src.consecutive_failures??0} failures</em></span><ArrowTopRightOnSquareIcon/></button>)}</section>
      <section><h3>Discovered job postings <span>{detail.discoveries.length}</span></h3>{detail.discoveries.length===0?<p className="muted">No postings stored for this company yet.</p>:detail.discoveries.map(job=><button key={job.id} className="ci-url" onClick={()=>void openExternal(job.apply_url)}><BuildingOffice2Icon/><span><b>{job.title}</b><small>{job.apply_url}</small><em>{[job.season,job.location,job.match_score!=null?`${job.match_score}% match`:null,job.gate_id].filter(Boolean).join(" · ")}</em></span><ArrowTopRightOnSquareIcon/></button>)}</section>
    </div></>}</aside></div>}
  </div>;
}
