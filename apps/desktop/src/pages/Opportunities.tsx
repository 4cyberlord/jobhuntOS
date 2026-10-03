import { useEffect, useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import type { Job, Status } from "../lib/types";
import { PIPELINE } from "../lib/types";
import { Logo } from "../components/Logo";
import { PageHead, SearchField, StatusPill, Empty } from "../components/ui";
import { fmtShort } from "../lib/format";
import { matchesQuery, relAgo } from "./kanban/helpers";
import "./opportunities.css";

const PAGE = 50;
type SortKey = "company" | "role" | "location" | "status" | "pay" | "score" | "addedAt";
const ORDER: Status[] = ["pending_review", "saved", "preparing", "applied", "interviewing", "offer", "rejected", "dismissed"];
const payNum = (p: string) => Number((p.match(/\d+/) ?? ["0"])[0]);
const STATUS_LABEL: Record<string, string> = { pending_review: "New", saved: "Saved", preparing: "Preparing", applied: "Applied", interviewing: "Interviewing", offer: "Offer", rejected: "Rejected", dismissed: "Dismissed" };

export default function Opportunities() {
  const { data, act } = useData();
  const { openJob, openModal, search, setSearch, toast } = useUI();
  const [status, setStatus] = useState("");
  const [track, setTrack] = useState("");
  const [mode, setMode] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "addedAt", dir: -1 });
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const tracks = useMemo(() => [...new Set(data.jobs.map((j) => j.track))].sort(), [data.jobs]);
  const rows = useMemo(() => {
    const list = data.jobs.filter((j) => (status ? j.status === status : j.status !== "dismissed") && (!track || j.track === track) && (!mode || j.workMode === mode) && j.score >= minScore && matchesQuery(j, search));
    const val = (j: Job): string | number => (sort.key === "status" ? ORDER.indexOf(j.status) : sort.key === "pay" ? payNum(j.pay) : j[sort.key]);
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
    });
  }, [data.jobs, status, track, mode, minScore, search, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => setPage(0), [status, track, mode, minScore, search]);
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE, cur * PAGE + PAGE);
  const sel = rows.filter((j) => picked.has(j.id));
  const allOn = shown.length > 0 && shown.every((j) => picked.has(j.id));

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked((s) => { const n = new Set(s); shown.forEach((j) => (allOn ? n.delete(j.id) : n.add(j.id))); return n; });
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button className="opp-th" onClick={() => setSort((s) => (s.key === key ? { key, dir: (-s.dir) as 1 | -1 } : { key, dir: key === "score" || key === "addedAt" ? -1 : 1 }))}>
        {label}{sort.key === key && (sort.dir === 1 ? <ArrowUpIcon /> : <ArrowDownIcon />)}
      </button>
    </th>
  );
  const filtering = !!(status || track || mode || minScore || search);

  return (
    <div className="page opp-page">
      <PageHead title="Opportunities" subtitle="Every role your agent found or you added, in one place.">
        <button className="btn primary" onClick={() => openModal({ kind: "job" })}><PlusIcon /> Add Job</button>
      </PageHead>

      <div className="opp-filters">
        <SearchField value={search} onChange={setSearch} placeholder="Search company, role, location…" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All Statuses</option>
          {ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={track} onChange={(e) => setTrack(e.target.value)} aria-label="Filter by track">
          <option value="">All Tracks</option>
          {tracks.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Filter by work mode">
          <option value="">Any Location</option>
          {["Remote", "Hybrid", "Onsite"].map((t) => <option key={t}>{t}</option>)}
        </select>
        <select value={minScore} onChange={(e) => setMinScore(+e.target.value)} aria-label="Minimum match">
          <option value={0}>Any Match</option>
          <option value={80}>80%+ match</option>
          <option value={85}>85%+ match</option>
          <option value={90}>90%+ match</option>
        </select>
        {filtering && <button className="btn ghost sm" onClick={() => { setStatus(""); setTrack(""); setMode(""); setMinScore(0); setSearch(""); }}><XMarkIcon /> Clear</button>}
      </div>

      {sel.length > 0 && (
        <div className="opp-bulk" role="toolbar" aria-label="Bulk actions">
          <b>{sel.length} selected</b>
          <select value="" aria-label="Move selected to stage" onChange={(e) => { const s = e.target.value as Status; if (!s) return; sel.forEach((j) => act.moveJob(j.id, s)); toast(`Moved ${sel.length} to ${STATUS_LABEL[s]}`); setPicked(new Set()); }}>
            <option value="">Move to stage…</option>
            {PIPELINE.map((p) => <option key={p.status} value={p.status}>{p.name}</option>)}
          </select>
          <button className="btn sm danger" onClick={() => { sel.forEach((j) => act.moveJob(j.id, "dismissed")); toast(`Dismissed ${sel.length} opportunities`); setPicked(new Set()); }}>Dismiss</button>
          <button className="btn sm ghost" onClick={() => setPicked(new Set())}>Clear selection</button>
        </div>
      )}

      <div className="card opp-card">
        <div className="opp-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all on this page" /></th>
                {th("company", "Company")}{th("role", "Role")}{th("location", "Location")}{th("status", "Status")}{th("pay", "Salary")}{th("score", "Match")}{th("addedAt", "Added")}
              </tr>
            </thead>
            <tbody>
              {shown.map((j) => (
                <tr key={j.id} className={picked.has(j.id) ? "picked" : ""} onClick={() => openJob(j.id)}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={picked.has(j.id)} onChange={() => toggle(j.id)} aria-label={`Select ${j.company}`} /></td>
                  <td><span className="opp-co"><Logo name={j.company} size={32} /><b>{j.company}</b>{j.gate && <span className="pill" style={{ marginLeft: 6, fontSize: 10 }}>From GATE</span>}</span></td>
                  <td><div className="opp-role">{j.role}</div><small className="muted">{/intern/i.test(j.role) ? `Summer ${new Date().getFullYear() + 1}` : j.track}</small></td>
                  <td className="muted">{j.location}</td>
                  <td><StatusPill status={j.status} /></td>
                  <td className="muted">{j.pay}</td>
                  <td><b className="opp-match">{j.score}%</b></td>
                  <td className="muted" title={fmtShort(j.addedAt)}>{relAgo(j.addedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <Empty title="No opportunities match">{filtering ? "Try clearing a filter." : "Add a job to get started."}</Empty>}
        </div>
        <footer className="opp-foot">
          <span>{rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}</span>
          <div className="opp-pager">
            <button className="icon-btn" disabled={cur === 0} onClick={() => setPage(cur - 1)} aria-label="Previous page"><ChevronLeftIcon /></button>
            <span>Page {cur + 1} of {pages}</span>
            <button className="icon-btn" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} aria-label="Next page"><ChevronRightIcon /></button>
          </div>
          <span>{PAGE} per page</span>
        </footer>
      </div>
    </div>
  );
}
