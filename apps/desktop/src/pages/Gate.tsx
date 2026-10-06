import { useEffect, useMemo, useState } from "react";
import { ArrowPathIcon, ChevronRightIcon, CodeBracketIcon, DocumentTextIcon, FunnelIcon, MagnifyingGlassIcon, PaperAirplaneIcon, CheckIcon } from "@heroicons/react/24/outline";
import { BriefcaseIcon, CalendarDaysIcon, ClockIcon, GlobeAltIcon, MapPinIcon, ShieldCheckIcon, SparklesIcon, CurrencyDollarIcon, AcademicCapIcon } from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { DAY, fmtAgo } from "../lib/format";
import { PROVIDER_LABEL, deadlineOf, flagsFor, isOpen, locationText, similarGateOpportunities } from "../lib/gate";
import { syncNow, useSyncConfig, useSyncStatus } from "../lib/gateSync";
import type { GateOpportunity } from "../lib/types";
import { Modal } from "../components/ui";
import { GateCard } from "./gate/GateCard";
import { GateDetail } from "./gate/GateDetail";
import { FilterSelect } from "./gate/ui";
import { NO_FILTERS, activeCount, passes, type Filters } from "./gate/filters";
import "./gate/gate.css";

type Tab = "all" | "review" | "later" | "dismissed";
const TABS: { id: Tab; label: string; icon?: string; match: (g: GateOpportunity) => boolean }[] = [
  // Approval hands the opportunity to Kanban. Keep its discovery record for
  // provenance, but do not show it again in the active opportunity inbox.
  { id: "all", label: "All", match: (g) => g.gateStatus !== "approved" },
  { id: "review", label: "Needs review", match: isOpen },
  { id: "later", label: "Saved for later", match: (g) => g.gateStatus === "saved_for_later" },
  { id: "dismissed", label: "Dismissed", match: (g) => ["dismissed", "expired", "duplicate"].includes(g.gateStatus) },
];
const QUICK: { id: string; label: string }[] = [{ id: "cpt_confirmed", label: "CPT confirmed" }, { id: "sponsorship_available", label: "Sponsorship" }, { id: "remote", label: "Remote" }, { id: "deadline_soon", label: "Deadline soon" }, { id: "official", label: "Official source" }];
type Sort = "match" | "newest" | "deadline";
const STAGES = [
  { key: "all" as const, name: "Gather", sub: "New matches", Icon: DocumentTextIcon, tone: "violet" },
  { key: "review" as const, name: "Assess", sub: "Ready to review", Icon: MagnifyingGlassIcon, tone: "blue" },
  { key: "" as const, name: "Track", sub: "In your pipeline", Icon: PaperAirplaneIcon, tone: "indigo" },
  { key: "" as const, name: "Execute", sub: "Applied & active", Icon: CheckIcon, tone: "green" },
];

export default function Gate() {
  const { data, act } = useData();
  const { search, setSearch, params, navigate, openJob, toast } = useUI();
  const sync = useSyncStatus();
  const cfg = useSyncConfig();
  const [tab, setTab] = useState<Tab>("all");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>("newest");
  const [quick, setQuick] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<string | undefined>(params.item);
  const [importing, setImporting] = useState(false);
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (params.item) { setTab("all"); setSelId(params.item); } }, [params.item]);

  const counts = useMemo(() => {
    const safe = (fn: () => number) => { try { return fn(); } catch { return 0; } };
    return Object.fromEntries(TABS.map((t) => [t.id, safe(() => data.gate.filter((g) => { try { return t.match(g); } catch { return t.id === "all"; } }).length)])) as Record<Tab, number>;
  }, [data.gate]);
  const states = useMemo(() => {
    try { return [...new Set(data.gate.map((g) => (g.envelope as unknown as { opportunity?: { location?: { state?: unknown } } })?.opportunity?.location?.state).filter((s): s is string => typeof s === "string" && !!s))].sort(); } catch { return [] as string[]; }
  }, [data.gate]);
  const providers = useMemo(() => {
    try { return [...new Set(data.gate.map((g) => (g.envelope as unknown as { source?: { provider?: unknown } })?.source?.provider).filter((p): p is string => typeof p === "string" && !!p))].sort(); } catch { return [] as string[]; }
  }, [data.gate]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const tabMatch = TABS.find((t) => t.id === tab)!.match;
    const now = Date.now();
    const out = data.gate.filter((g) => {
      try {
        if (!(() => { try { return tabMatch(g); } catch { return tab === "all"; } })() || !(() => { try { return passes(g, filters, now); } catch { return true; } })()) return false;
        const e = g.envelope as unknown as Record<string, unknown>;
        const flags = (() => { try { return flagsFor(g); } catch { return [] as string[]; } })();
        const official = (e.source as Record<string, unknown> | undefined)?.official as boolean | undefined;
        for (const f of quick) if (f === "official" ? !official : !flags.includes(f as never)) return false;
        if (!q) return true;
        const company = (e.company as Record<string, unknown> | undefined)?.name as string | undefined;
        const opp = (e.opportunity as Record<string, unknown> | undefined);
        const title = opp?.title as string | undefined;
        const track = opp?.track as string | undefined;
        const matchSkills: unknown = (e.match as Record<string, unknown> | undefined)?.matching_skills;
        const loc = (() => { try { return locationText(g.envelope); } catch { return ""; } })();
        const hay = `${company ?? ""} ${title ?? ""} ${loc} ${track ?? ""} ${Array.isArray(matchSkills) ? (matchSkills as string[]).join(" ") : ""}`.toLowerCase();
        return hay.includes(q);
      } catch {
        return tab === "all" && !q;
      }
    });
    const far = Number.MAX_SAFE_INTEGER;
    const scoreOf = (x: GateOpportunity) => {
      const s: unknown = (x.envelope as unknown as { match?: { score?: unknown } })?.match?.score;
      return typeof s === "number" && Number.isFinite(s) ? s : 0;
    };
    return out.sort((a, b) => sort === "match" ? scoreOf(b) - scoreOf(a) : sort === "newest" ? (b.receivedAt ?? 0) - (a.receivedAt ?? 0) : ((() => { try { return deadlineOf(a.envelope) ?? far; } catch { return far; } })() - (() => { try { return deadlineOf(b.envelope) ?? far; } catch { return far; } })()));
  }, [data.gate, tab, filters, sort, quick, search]);

  const selected = list.find((g) => g.id === selId) ?? list[0];
  const similar = useMemo(() => selected ? similarGateOpportunities(selected, data.gate) : [], [selected, data.gate]);
  useEffect(() => { if (selected && !selected.seen) act.markGateSeen(selected.id); }, [selected, act]);

  // J/K or arrow keys walk the list (ignored while typing in a field)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const dir = ev.key === "ArrowDown" || ev.key === "j" ? 1 : ev.key === "ArrowUp" || ev.key === "k" ? -1 : 0;
      if (!dir || !list.length) return;
      ev.preventDefault();
      const i = Math.max(0, list.findIndex((g) => g.id === selected?.id));
      const nextItem = list[Math.min(list.length - 1, Math.max(0, i + dir))];
      setSelId(nextItem.id);
      document.getElementById(`gate-${nextItem.id}`)?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [list, selected?.id]);

  const stats = useMemo(() => {
    const linked = data.gate.filter((g) => g.linkedJobId).map((g) => data.jobs.find((j) => j.id === g.linkedJobId)).filter(Boolean);
    return { all: data.gate.filter((g) => g.gateStatus !== "approved").length, review: counts.review, approved: linked.length, "": linked.filter((j) => j && ["applied", "interviewing", "offer"].includes(j.status)).length } as Record<string, number>;
  }, [data.gate, data.jobs, counts.review]);

  const next = (id: string) => { const i = list.findIndex((g) => g.id === id); return list[i + 1]?.id ?? list[i - 1]?.id; };
  const approve = (g: GateOpportunity) => {
    const n = next(g.id);
    const job = act.approveGate(g.id);
    toast(`Added ${g.envelope.company.name} to Saved`);
    if (job) setSelId(n);
  };
  const decide = (g: GateOpportunity, s: "dismissed" | "saved_for_later" | "discovered") => {
    const n = next(g.id);
    act.setGateStatus(g.id, s);
    toast(s === "dismissed" ? "Dismissed" : s === "saved_for_later" ? "Saved for later" : "Restored to inbox");
    if (s !== "discovered") setSelId(n);
  };

  const connected = !!(cfg.apiUrl && cfg.syncKey);
  const syncLabel = !connected ? "Not connected" : sync.state === "syncing" ? "Syncing…" : sync.state === "error" ? "Sync error" : sync.lastAt ? `Synced ${fmtAgo(sync.lastAt)}` : "Connected";
  const lastUpdated = Math.max(sync.lastAt ?? 0, ...data.gate.map((g) => g.updatedAt), 0);
  const nFilters = activeCount(filters) + quick.size;
  const clearAll = () => { setFilters(NO_FILTERS); setQuick(new Set()); };
  const selectSimilar = (id: string) => {
    setSearch(""); setTab("all"); setFilters(NO_FILTERS); setQuick(new Set()); setSelId(id);
  };

  return (
    <div className="page gate">
      <div className="page-head">
        <div>
          <h1>GATE Inbox</h1>
          <p>AI-discovered opportunities, ready for your review. Assess, filter, and decide what enters your pipeline.</p>
        </div>
        <div className="page-head-actions">
          <button className={`g-pill ${connected ? sync.state : "off"}`} title={sync.error ?? (connected ? "Pull new discoveries from the server" : "Set up sync in Settings")} onClick={() => (connected ? syncNow() : navigate("settings", { section: "AI Agent" }))}>
            <i />{syncLabel}
          </button>
          <button className="btn" onClick={() => setImporting(true)}><CodeBracketIcon />Import JSON</button>
        </div>
      </div>

      <div className="g-stages">
        {STAGES.map(({ key, name, sub, Icon, tone }) => (
          <button key={name} className={`g-stage ${tone} ${key && key === tab ? "on" : ""}`} onClick={() => (key ? setTab(key) : navigate("kanban"))}>
            <span className="g-stage-ico"><Icon /></span>
            <span className="g-stage-body"><span className="g-stage-name">{name}</span><b>{stats[key]}</b><span className="g-stage-sub">{sub}</span></span>
            <span className="g-stage-go"><ChevronRightIcon /></span>
          </button>
        ))}
      </div>

      <div className="g-filterbar">
        <button className={`btn primary g-filters-btn ${nFilters ? "has" : ""}`} onClick={nFilters ? clearAll : undefined} title={nFilters ? "Clear all filters" : "Filters"}>
          <FunnelIcon />{nFilters ? <>Clear filters<em>{nFilters}</em></> : "Filters"}
        </button>
        <FilterSelect icon={<CalendarDaysIcon />} label="Found" value={filters.found} onChange={set("found")} options={[["any", "Any time"], ["1h", "Last hour"], ["2h", "Last 2 hours"], ["3h", "Last 3 hours"], ["6h", "Last 6 hours"], ["12h", "Last 12 hours"], ["24h", "Last 24 hours"], ["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]]} />
        <FilterSelect icon={<ClockIcon />} label="Deadline" value={filters.deadline} onChange={set("deadline")} options={[["any", "Any"], ["week", "Within 7 days"], ["has", "Has deadline"], ["none", "No deadline"]]} />
        <FilterSelect icon={<MapPinIcon />} label="Location" value={filters.location} onChange={set("location")} options={[["any", "Any"], ["remote", "Remote"], ...states.map((s): [string, string] => [s, s])]} />
        <FilterSelect icon={<BriefcaseIcon />} label="Work mode" value={filters.mode} onChange={set("mode")} options={[["any", "Any"], ["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "Onsite"]]} />
        <FilterSelect icon={<CurrencyDollarIcon />} label="Sponsorship" value={filters.sponsor} onChange={set("sponsor")} options={[["any", "Any"], ["available", "Available"], ["not_available", "Not available"], ["unknown", "Not stated"]]} />
        <FilterSelect icon={<AcademicCapIcon />} label="CPT/OPT" value={filters.cpt} onChange={set("cpt")} options={[["any", "Any"], ["allowed", "CPT allowed"], ["not_allowed", "Not allowed"], ["unknown", "Unknown"]]} />
        <FilterSelect icon={<SparklesIcon />} label="Match" value={filters.match} onChange={set("match")} options={[["any", "Any"], ["perfect", "Perfect"], ["strong", "Strong"], ["good", "Good"], ["partial", "Partial"], ["low", "Low"]]} />
        <FilterSelect icon={<GlobeAltIcon />} label="Source" value={filters.source} onChange={set("source")} options={[["any", "Any"], ["official", "Official only"], ["unverified", "Unverified"], ...providers.map((p): [string, string] => [p, PROVIDER_LABEL[p] ?? p])]} />
      </div>

      <div className="g-tabrow">
        <div className="g-tabs" role="tablist">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}<span>{counts[t.id]}</span></button>)}
        </div>
        <div className="g-quick">
          {QUICK.map((q) => <button key={q.id} aria-pressed={quick.has(q.id)} className={quick.has(q.id) ? "on" : ""} onClick={() => setQuick((s) => { const n = new Set(s); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; })}>{q.label}</button>)}
        </div>
      </div>

      <div className="g-body">
        <div className="g-listwrap">
          <div className="g-listhead"><b>{list.length} {list.length === 1 ? "opportunity" : "opportunities"}</b><FilterSelect label="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={[["match", "Best match"], ["newest", "Newest"], ["deadline", "Deadline soonest"]]} /><span>{lastUpdated ? `Updated ${fmtAgo(lastUpdated)}` : ""}<button aria-label="Sync now" title="Sync now" disabled={!connected} onClick={() => syncNow()}><ArrowPathIcon className={sync.state === "syncing" ? "spin" : ""} /></button></span></div>
          <div className="g-list" role="listbox" aria-label="Opportunities">
            {list.length === 0 && (
              <div className="g-empty"><ShieldCheckIcon /><b>{data.gate.length === 0 ? "Nothing discovered yet" : "No opportunities match"}</b><p>{data.gate.length === 0 ? "GATE Scout's findings will appear here. Connect sync in Settings, or import a JSON result." : "Try a different tab or clear the filters."}</p>{nFilters > 0 && <button className="btn sm" onClick={clearAll}>Clear filters</button>}</div>
            )}
            {list.map((g) => <div id={`gate-${g.id}`} key={g.id} role="option" aria-selected={selected?.id === g.id}><GateCard g={g} active={selected?.id === g.id} onClick={() => setSelId(g.id)} /></div>)}
          </div>
        </div>

        <div className="g-detail">
          {selected ? (
            <GateDetail key={selected.id} g={selected} similar={similar} onSelectSimilar={selectSimilar} onApprove={() => approve(selected)} onDecide={(s) => decide(selected, s)} onOpenJob={() => openJob(selected.linkedJobId)} onKanban={() => navigate("kanban")} onCopied={() => toast("Apply link copied")} />
          ) : <div className="g-empty"><SparklesIcon /><b>Select an opportunity</b><p>Its match explanation and eligibility will appear here.</p></div>}
        </div>
      </div>
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

const SAMPLE = `{
  "event": "gate.opportunity.discovered",
  "schema_version": "1.0",
  "search": { "watch_id": "summer-2027-software", "season": "Summer 2027", "country": "US", "searched_at": "${new Date().toISOString()}" },
  "opportunity": {
    "external_id": "sample-${Date.now().toString(36)}",
    "title": "Backend Engineer Intern - Summer 2027",
    "track": "backend",
    "employment_type": "internship",
    "season": "Summer 2027",
    "location": { "city": "Seattle", "state": "WA", "country": "US" },
    "work_arrangement": "hybrid",
    "dates": { "duration_weeks": 12 },
    "application": { "status": "open", "deadline": "${new Date(Date.now() + 10 * DAY).toISOString()}", "apply_url": "https://careers.example.com/jobs/${Date.now().toString(36)}" },
    "description_summary": "Build and operate backend services used by millions of customers."
  },
  "company": { "name": "Example Corp", "website": "https://www.example.com", "industry": "Technology", "headquarters": "Seattle, WA" },
  "match": { "score": 88, "matching_skills": ["Python", "SQL", "AWS"], "matching_experience": ["Previous software engineering internship"], "matching_education": ["Expected May 2028 graduation"], "missing_or_unclear": ["Kubernetes"], "reason": "Strong backend and cloud overlap with the graduation window." },
  "eligibility": { "degree_match": true, "graduation_match": true, "student_status_match": true, "f1": { "status": "eligible", "cpt_status": "allowed", "opt_status": "unknown" }, "sponsorship": { "status": "unknown" } },
  "compensation": { "available": true, "min": 45, "max": 55, "currency": "USD", "period": "hour" },
  "source": { "provider": "company_careers", "name": "Example Careers", "url": "https://careers.example.com/jobs/1", "official": true, "first_seen_at": "${new Date().toISOString()}", "last_verified_at": "${new Date().toISOString()}" },
  "agent": { "name": "GATE Scout", "decision": "surface", "confidence": 0.9, "flags": [] },
  "metadata": { "discovered_at": "${new Date().toISOString()}", "gate_status": "discovered", "user_action_required": true }
}`;

function ImportModal({ onClose }: { onClose: () => void }) {
  const { act } = useData();
  const { toast } = useUI();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const run = () => {
    const r = act.importGateJson(text);
    if (!r.ok) return setErr(r.error);
    const s = r.summary;
    toast(s.created ? `${s.created} new opportunit${s.created === 1 ? "y" : "ies"} added to the GATE Inbox` : s.duplicates ? `Already known: ${s.duplicates} duplicate${s.duplicates === 1 ? "" : "s"} (updated)` : "Nothing to add");
    onClose();
  };
  return (
    <Modal wide title="Import GATE result" subtitle="Paste a single opportunity or a batch (with a results array) in the GATE agent format. Duplicates update the existing item." onClose={onClose}
      footer={<><button className="btn" onClick={() => { setText(SAMPLE); setErr(""); }}>Load sample</button><span style={{ flex: 1 }} /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!text.trim()} onClick={run}>Import</button></>}>
      <textarea className="gate-json" rows={16} value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setErr(""); }} placeholder='{ "event": "gate.opportunity.discovered", ... }' />
      {err && <p className="form-error" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}
