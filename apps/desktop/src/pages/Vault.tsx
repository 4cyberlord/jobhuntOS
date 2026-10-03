import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownIcon, ArrowUpIcon, BellIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, ExclamationCircleIcon, ExclamationTriangleIcon, MagnifyingGlassIcon,
  PlusIcon, ShieldCheckIcon, KeyIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { Logo } from "../components/Logo";
import { Empty, PageHead } from "../components/ui";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { CLIPBOARD_CLEAR_SECONDS } from "../lib/secrets";
import { fmtDate } from "../lib/format";
import { DetailPanel } from "./vault/DetailPanel";
import { CRED_TYPES, SEC_LABEL, TYPE_CLASS, fingerprintCounts, hostOf, ownerName, plural, secStatus, type SecStatus } from "./vault/helpers";
import "./vault/vault.css";

type SortKey = "company" | "lastUsed" | "jobs";
type SecFilter = "all" | SecStatus | "reused";

export default function Vault() {
  const { data, act } = useData();
  const { params, search, navigate, openModal, toast } = useUI();
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [type, setType] = useState("all");
  const [mfa, setMfa] = useState<"all" | "on" | "off">("all");
  const [sec, setSec] = useState<SecFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "lastUsed", dir: -1 });
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(50);
  const [selected, setSelected] = useState<string | null>(() => params.cred ?? (window.innerWidth > 1400 ? data.credentials[0]?.id ?? null : null));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (params.cred) setSelected(params.cred); }, [params.cred]);
  useEffect(() => setPage(1), [q, search, company, type, mfa, sec, per]);

  const creds = data.credentials;
  const counts = useMemo(() => fingerprintCounts(creds), [creds]);
  const statusOf = (c: (typeof creds)[number]) => secStatus(c, counts);
  const companies = useMemo(() => [...new Set(creds.map(ownerName))].sort(), [creds]);

  const rows = useMemo(() => {
    const terms = `${q} ${search}`.toLowerCase().split(/\s+/).filter(Boolean);
    const list = creds.filter((c) => {
      const hay = `${c.portal} ${c.company ?? ""} ${c.domain} ${c.username} ${c.recoveryEmail} ${c.type}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
      if (company !== "all" && ownerName(c) !== company) return false;
      if (type !== "all" && c.type !== type) return false;
      if (mfa === "on" && c.mfa === "none") return false;
      if (mfa === "off" && c.mfa !== "none") return false;
      if (sec === "reused") return !!c.fingerprint && (counts.get(c.fingerprint) ?? 0) > 1;
      if (sec !== "all" && statusOf(c) !== sec) return false;
      return true;
    });
    const val = (c: (typeof creds)[number]) => (sort.key === "company" ? ownerName(c).toLowerCase() : sort.key === "jobs" ? c.jobIds.length : c.lastUsedAt);
    return list.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, counts, q, search, company, type, mfa, sec, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / per));
  const cur = Math.min(page, pages);
  const visible = rows.slice((cur - 1) * per, cur * per);
  const sel = creds.find((c) => c.id === selected);

  const missingMfa = creds.filter((c) => c.mfa === "none").length;
  const reusedN = creds.filter((c) => c.fingerprint && (counts.get(c.fingerprint) ?? 0) > 1).length;
  const noPw = creds.filter((c) => !c.secret).length;
  const filtered = company !== "all" || type !== "all" || mfa !== "all" || sec !== "all" || !!q || !!search;
  const clear = () => { setQ(""); setCompany("all"); setType("all"); setMfa("all"); setSec("all"); };

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "company" ? 1 : -1 }));
  const Arrow = ({ k }: { k: SortKey }) => (sort.key === k ? sort.dir === -1 ? <ArrowDownIcon /> : <ArrowUpIcon /> : null);
  const allChecked = visible.length > 0 && visible.every((c) => checked.has(c.id));
  const toggleCheck = (id: string) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectRow = (id: string) => { setSelected(id); setChecked(new Set([id])); };
  const bulkDelete = () => { checked.forEach((id) => act.removeCredential(id)); toast(`Deleted ${plural(checked.size, "credential")}.`); if (selected && checked.has(selected)) setSelected(null); setChecked(new Set()); setBulkConfirm(false); };

  const secPill = (c: (typeof creds)[number]) => {
    const s = statusOf(c);
    return <span className={`vlt-sec ${s}`}>{s === "strong" ? <CheckCircleIcon /> : s === "attention" ? <ExclamationCircleIcon /> : <ExclamationTriangleIcon />}{SEC_LABEL[s]}</span>;
  };

  return (
    <div className="page vlt-page">
      <PageHead title="Credentials Vault" subtitle="Securely store and manage your application portal accounts in one place.">
        <div className="vlt-head-actions">
          <div className="vlt-head-icons">
            <button className="icon-btn ghost" aria-label="Notifications" onClick={() => navigate("notifications")}><BellIcon /></button>
            <button className="icon-btn ghost" aria-label="Search credentials" onClick={() => filterRef.current?.focus()}><MagnifyingGlassIcon /></button>
            <button className="icon-btn" aria-label="Add credential" onClick={() => openModal({ kind: "credential" })}><PlusIcon /></button>
          </div>
          <button className="btn primary" onClick={() => openModal({ kind: "credential" })}><PlusIcon />Add Credential</button>
        </div>
      </PageHead>

      <div className="vlt-filters">
        <label className="search-field vlt-search"><MagnifyingGlassIcon /><input ref={filterRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search credentials, companies, or emails…" aria-label="Search credentials" /></label>
        <select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}><option value="all">All Companies</option>{companies.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)}><option value="all">All Types</option>{CRED_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <select aria-label="MFA status" value={mfa} onChange={(e) => setMfa(e.target.value as typeof mfa)}><option value="all">MFA Status</option><option value="on">MFA Enabled</option><option value="off">MFA Not Enabled</option></select>
        <select aria-label="Security status" value={sec} onChange={(e) => setSec(e.target.value as SecFilter)}>
          <option value="all">Security Status</option><option value="strong">Strong</option><option value="medium">Medium</option><option value="attention">Needs Attention</option><option value="reused">Reused password</option><option value="nopw">No password</option>
        </select>
      </div>

      <div className={`vlt-body ${sel ? "has-panel" : ""}`}>
        <div className="vlt-main card">
          {creds.length === 0 ? (
            <div className="vlt-empty">
              <Empty title="No credentials yet">Store portal logins for the places you apply, then tie each one to its applications.</Empty>
              <button className="btn primary" onClick={() => openModal({ kind: "credential" })}><KeyIcon />Add your first credential</button>
            </div>
          ) : (
            <>
              <div className="vlt-table-wrap">
                <table className="vlt-table">
                  <thead>
                    <tr>
                      <th className="c-check"><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(visible.map((c) => c.id)))} /></th>
                      <th><button className="vlt-th" onClick={() => sortBy("company")}>Company / Portal<Arrow k="company" /></button></th>
                      <th>Username / Email</th><th>Type</th><th>MFA</th>
                      <th><button className="vlt-th" onClick={() => sortBy("lastUsed")}>Last Used<Arrow k="lastUsed" /></button></th>
                      <th><button className="vlt-th" onClick={() => sortBy("jobs")}>Jobs<Arrow k="jobs" /></button></th>
                      <th>Security</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id} className={selected === c.id ? "sel" : ""} onClick={() => selectRow(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && selectRow(c.id)}>
                        <td className="c-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${c.portal}`} checked={checked.has(c.id)} onChange={() => toggleCheck(c.id)} /></td>
                        <td><div className="vlt-co"><Logo name={ownerName(c)} size={34} /><span><b>{c.portal}</b><small>{hostOf(c.domain)}</small></span></div></td>
                        <td className="vlt-user">{c.username}</td>
                        <td><span className={`vlt-type ${TYPE_CLASS[c.type]}`}>{c.type}</span></td>
                        <td>{c.mfa === "none" ? <span className="vlt-mfa off"><ExclamationCircleIcon />Not Enabled</span> : <span className="vlt-mfa on"><CheckCircleIcon />Enabled</span>}</td>
                        <td className="vlt-date">{fmtDate(c.lastUsedAt)}</td>
                        <td className="vlt-jobs">{c.jobIds.length}</td>
                        <td>{secPill(c)}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && <tr className="vlt-none"><td colSpan={8}>No credentials match these filters. {filtered && <button className="link" onClick={clear}>Clear filters</button>}</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="vlt-foot">
                <span className="muted">{plural(rows.length, "credential")}</span>
                {checked.size > 1 && (bulkConfirm
                  ? <span className="vlt-bulk">Delete {checked.size} credentials? <button className="btn sm" onClick={() => setBulkConfirm(false)}>Cancel</button><button className="btn sm danger" onClick={bulkDelete}>Delete</button></span>
                  : <button className="btn sm danger" onClick={() => setBulkConfirm(true)}>Delete {checked.size} selected</button>)}
                <div className="vlt-pager">
                  <div className="vlt-pages"><button aria-label="Previous page" disabled={cur <= 1} onClick={() => setPage(cur - 1)}><ChevronLeftIcon /></button><span>{cur} of {pages}</span><button aria-label="Next page" disabled={cur >= pages} onClick={() => setPage(cur + 1)}><ChevronRightIcon /></button></div>
                  <select aria-label="Rows per page" value={per} onChange={(e) => setPer(+e.target.value)}>{[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
                </div>
              </div>
              <div className="vlt-insights">
                <div className="vlt-ins-head"><ShieldCheckIcon /><div><b>Security Insights</b><small>Keep your accounts secure and up to date.</small></div></div>
                <div className="vlt-tiles">
                  <button className={`vlt-tile amber ${mfa === "off" ? "on" : ""}`} onClick={() => { setMfa(mfa === "off" ? "all" : "off"); }}><i><ExclamationCircleIcon /></i><span><b>{plural(missingMfa, "credential")}</b>{missingMfa === 1 ? "is" : "are"} missing MFA</span><ChevronRightIcon /></button>
                  <button className={`vlt-tile red ${sec === "reused" ? "on" : ""}`} onClick={() => setSec(sec === "reused" ? "all" : "reused")}><i><ExclamationTriangleIcon /></i><span><b>{plural(reusedN, "credential")}</b>{reusedN === 1 ? "uses" : "use"} a reused password</span><ChevronRightIcon /></button>
                  {noPw > 0 && <button className={`vlt-tile amber ${sec === "nopw" ? "on" : ""}`} onClick={() => setSec(sec === "nopw" ? "all" : "nopw")}><i><KeyIcon /></i><span><b>{plural(noPw, "credential")}</b>{noPw === 1 ? "has" : "have"} no password saved</span><ChevronRightIcon /></button>}
                  <button className="vlt-tile blue" onClick={() => toast(`Copied passwords are cleared from your clipboard after ${CLIPBOARD_CLEAR_SECONDS} seconds.`)}><i><ClockIcon /></i><span><b>Clipboard auto-clears</b>in {CLIPBOARD_CLEAR_SECONDS} seconds for security</span><ChevronRightIcon /></button>
                </div>
              </div>
            </>
          )}
        </div>
        {sel && <DetailPanel cred={sel} counts={counts} onClose={() => setSelected(null)} onDeleted={() => { setSelected(null); setChecked(new Set()); }} />}
      </div>
    </div>
  );
}
