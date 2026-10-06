import { useEffect, useMemo, useState } from "react";
import {
  ArrowPathIcon,
  BuildingOffice2Icon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  ServerStackIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { readSyncConfig } from "../lib/syncConfig";
import "./company-intelligence/company-intelligence.css";

type Summary = {
  companies?: number;
  technical_employers?: number;
  active_companies?: number;
  companies_with_failures?: number;
  career_sources?: number;
  verified_sources?: number;
  failing_sources?: number;
};

type Company = {
  id: string;
  canonical_name: string;
  legal_name?: string | null;
  state?: string | null;
  website?: string | null;
  industry?: string | null;
  technical_employer?: number;
  priority?: number;
  active?: number;
  last_checked_at?: number | null;
  last_success_at?: number | null;
  next_check_at?: number | null;
  consecutive_failures?: number;
  source_count?: number;
  verified_source_count?: number;
  failing_source_count?: number;
};

type IntelligenceResponse = {
  ok: boolean;
  generated_at?: string;
  summary?: Summary;
  companies?: Company[];
};

const fmtTime = (value?: number | null) => {
  if (!value) return "Never";
  return new Date(value * 1000).toLocaleString();
};

const health = (c: Company) => {
  if ((c.failing_source_count ?? 0) > 0 || (c.consecutive_failures ?? 0) > 0) return "attention";
  if ((c.verified_source_count ?? 0) > 0) return "healthy";
  return "unknown";
};

export default function CompanyIntelligence() {
  const [data, setData] = useState<IntelligenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "healthy" | "attention" | "unknown">("all");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const cfg = readSyncConfig();
      if (!cfg.apiUrl || !cfg.syncKey) throw new Error("Sign in to Job Hunt OS first.");
      const response = await fetch(`${cfg.apiUrl.replace(/\/+$/, "")}/v1/desktop/company-intelligence`, {
        headers: { Authorization: `Bearer ${cfg.syncKey}` },
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      setData(await response.json() as IntelligenceResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Company Intelligence.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const companies = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.companies ?? []).filter((c) => {
      const h = health(c);
      if (filter !== "all" && h !== filter) return false;
      if (!q) return true;
      return `${c.canonical_name} ${c.legal_name ?? ""} ${c.industry ?? ""} ${c.state ?? ""} ${c.website ?? ""}`.toLowerCase().includes(q);
    });
  }, [data, query, filter]);

  const s = data?.summary ?? {};
  const monitored = s.active_companies ?? s.companies ?? 0;
  const technical = s.technical_employers ?? 0;
  const verified = s.verified_sources ?? 0;
  const failing = s.failing_sources ?? 0;

  return (
    <div className="page ci-page">
      <div className="page-head">
        <div>
          <h1>Company Intelligence</h1>
          <p>Coverage, career-source health, and employer discovery behind GATE.</p>
        </div>
        <div className="page-head-actions">
          <span className="ci-generated">{data?.generated_at ? `Updated ${new Date(data.generated_at).toLocaleString()}` : ""}</span>
          <button className="btn" onClick={() => void load()} disabled={loading}>
            <ArrowPathIcon className={loading ? "ci-spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="ci-error"><ExclamationTriangleIcon /><span>{error}</span></div>}

      <section className="ci-stats">
        <article className="card ci-stat">
          <span className="ci-stat-icon blue"><BuildingOffice2Icon /></span>
          <div><small>Companies monitored</small><b>{monitored.toLocaleString()}</b><em>{s.companies_with_failures ?? 0} need attention</em></div>
        </article>
        <article className="card ci-stat">
          <span className="ci-stat-icon purple"><ServerStackIcon /></span>
          <div><small>Technical employers</small><b>{technical.toLocaleString()}</b><em>Eligible for tech-role scans</em></div>
        </article>
        <article className="card ci-stat">
          <span className="ci-stat-icon green"><ShieldCheckIcon /></span>
          <div><small>Verified career sources</small><b>{verified.toLocaleString()}</b><em>{s.career_sources ?? 0} total sources</em></div>
        </article>
        <article className="card ci-stat">
          <span className="ci-stat-icon amber"><ExclamationTriangleIcon /></span>
          <div><small>Failing sources</small><b>{failing.toLocaleString()}</b><em>Require source recovery</em></div>
        </article>
      </section>

      <section className="card ci-panel">
        <header className="ci-toolbar">
          <div>
            <b>Employer coverage</b>
            <span>{companies.length} companies shown</span>
          </div>
          <div className="ci-tools">
            <label className="search-field ci-search">
              <MagnifyingGlassIcon />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, state, industry..." />
            </label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="all">All health states</option>
              <option value="healthy">Healthy</option>
              <option value="attention">Needs attention</option>
              <option value="unknown">Unverified</option>
            </select>
          </div>
        </header>

        <div className="ci-table-wrap">
          <table className="ci-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Industry</th>
                <th>State</th>
                <th>Priority</th>
                <th>Career sources</th>
                <th>Health</th>
                <th>Last checked</th>
                <th>Next check</th>
              </tr>
            </thead>
            <tbody>
              {!loading && companies.length === 0 && (
                <tr><td colSpan={8}><div className="ci-empty"><GlobeAltIcon /><b>No company records yet</b><span>Once the Company Intelligence registry is seeded, monitored employers will appear here.</span></div></td></tr>
              )}
              {companies.map((c) => {
                const h = health(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="ci-company">
                        <span className="ci-company-mark">{c.canonical_name.slice(0, 2).toUpperCase()}</span>
                        <span><b>{c.canonical_name}</b><small>{c.website ?? c.legal_name ?? c.id}</small></span>
                      </div>
                    </td>
                    <td>{c.industry || "—"}</td>
                    <td>{c.state || "—"}</td>
                    <td><span className="pill">Tier {c.priority ?? 3}</span></td>
                    <td>
                      <div className="ci-source-count"><b>{c.verified_source_count ?? 0}</b><span>/ {c.source_count ?? 0} verified</span></div>
                    </td>
                    <td>
                      <span className={`ci-health ${h}`}>
                        {h === "healthy" ? <CheckCircleIcon /> : <ExclamationTriangleIcon />}
                        {h === "healthy" ? "Healthy" : h === "attention" ? "Needs attention" : "Unverified"}
                      </span>
                    </td>
                    <td>{fmtTime(c.last_checked_at)}</td>
                    <td>{fmtTime(c.next_check_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
