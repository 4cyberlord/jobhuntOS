import { useEffect, useRef, useState } from "react";
import {
  ArrowDownTrayIcon, ArrowPathIcon, ArrowUturnLeftIcon, BuildingOffice2Icon, CalendarDaysIcon, ChevronDownIcon, ClockIcon, DocumentDuplicateIcon, DocumentIcon,
  FolderIcon, LinkIcon, PencilSquareIcon, PlusIcon, TagIcon, TrashIcon, XMarkIcon, ArrowsPointingOutIcon, ArrowUpTrayIcon, BriefcaseIcon, ComputerDesktopIcon,
} from "@heroicons/react/24/outline";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { pickFiles } from "../../lib/files";
import { fmtBytes, fmtDate, fmtDateTime } from "../../lib/format";
import { Logo } from "../../components/Logo";
import { StatusPill } from "../../components/ui";
import { BASE_FOLDERS, type DocItem } from "../../lib/types";
import { Menu } from "./Menu";
import { typeLabel } from "./content";
import { useDocActions } from "./actions";

type Tab = "details" | "versions" | "jobs";
const TAG_COLORS = ["", "purple", "teal", "amber"];

export function Tile({ doc, size = 40 }: { doc: DocItem; size?: number }) {
  const word = ["DOC", "DOCX", "RTF"].includes(doc.ext.toUpperCase());
  return <span className={`docs-tile ${word ? "word" : doc.ext.toUpperCase() === "PDF" ? "pdf" : "other"}`} style={{ width: size, height: size }}><DocumentIcon /></span>;
}

export function Detail({ doc, onFull, onClose }: { doc: DocItem; onFull: () => void; onClose?: () => void }) {
  const { data, act } = useData();
  const { openJob, toast } = useUI();
  const A = useDocActions();
  const [tab, setTab] = useState<Tab>("details");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.name);
  const [desc, setDesc] = useState(doc.description);
  const [tagging, setTagging] = useState(false);
  const [tag, setTag] = useState("");
  const tagRef = useRef<HTMLInputElement>(null);
  const folders = [...BASE_FOLDERS, ...data.folders];

  useEffect(() => { setTab("details"); setEditing(false); setTagging(false); setName(doc.name); setDesc(doc.description); }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tagging) tagRef.current?.focus(); }, [tagging]);

  const saveName = () => {
    const n = name.trim();
    if (n && (n !== doc.name || desc !== doc.description)) act.updateDocument(doc.id, { name: n, description: desc.trim() });
    setEditing(false);
  };
  const addTag = () => {
    const t = tag.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !doc.tags.includes(t)) act.updateDocument(doc.id, { tags: [...doc.tags, t] });
    setTag(""); setTagging(false);
  };
  const jobs = doc.jobIds.map((id) => data.jobs.find((j) => j.id === id)).filter((j) => !!j);
  const unlinked = data.jobs.filter((j) => !doc.jobIds.includes(j.id));
  const sortedVersions = [...doc.versions].reverse();

  const openMenu = [
    { label: "Open in default app", icon: <ComputerDesktopIcon />, onClick: () => A.open(doc) },
    { label: "Open preview full screen", icon: <ArrowsPointingOutIcon />, onClick: onFull },
    { label: "Download a copy", icon: <ArrowDownTrayIcon />, onClick: () => A.download(doc) },
  ];

  return (
    <div className="docs-detail">
      <div className="docs-detail-head">
        <span className={`docs-badge ${["DOC", "DOCX"].includes(doc.ext.toUpperCase()) ? "word" : doc.ext.toUpperCase() === "PDF" ? "pdf" : "other"}`}>{doc.ext.slice(0, 4)}</span>
        <div className="docs-detail-title">
          {editing ? (
            <div className="docs-edit">
              <input autoFocus aria-label="Document name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") { setEditing(false); setName(doc.name); setDesc(doc.description); } }} />
              <input aria-label="Description" value={desc} placeholder="Description" onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName()} />
              <div><button className="btn primary sm" onClick={saveName}>Save</button> <button className="btn sm" onClick={() => { setEditing(false); setName(doc.name); setDesc(doc.description); }}>Cancel</button></div>
            </div>
          ) : (
            <>
              <h3 title={doc.name}><span>{doc.name}.{doc.ext.toLowerCase()}</span><button className="icon-btn ghost" aria-label="Rename" onClick={() => setEditing(true)}><PencilSquareIcon /></button></h3>
              <p>{fmtBytes(doc.size)} <i>·</i> Modified {fmtDate(doc.modifiedAt)}</p>
            </>
          )}
        </div>
        {onClose && <button className="icon-btn ghost docs-only-narrow" aria-label="Close panel" onClick={onClose}><XMarkIcon /></button>}
        <div className="docs-split">
          <button className="btn primary" onClick={() => A.open(doc)}>Open</button>
          <Menu label="Open options" items={openMenu} trigger={(p) => <button className="btn primary chev" aria-label="Open options" {...p}><ChevronDownIcon /></button>} />
        </div>
      </div>

      <div className="docs-tabs" role="tablist">
        {([["details", "Details"], ["versions", `Versions (${doc.versions.length})`], ["jobs", `Linked Jobs (${doc.jobIds.length})`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div className="docs-detail-body">
        {tab === "details" && (
          <dl className="docs-props">
            <div><dt><DocumentIcon />Type</dt><dd>{typeLabel(doc.ext)}</dd></div>
            <div><dt><FolderIcon />Location</dt><dd><span className="docs-ovl">{doc.folder} /<select aria-label="Folder" value={doc.folder} onChange={(e) => A.move([doc.id], e.target.value)}>{folders.map((f) => <option key={f}>{f}</option>)}{!folders.includes(doc.folder) && <option>{doc.folder}</option>}</select></span></dd></div>
            <div><dt><TagIcon />Tags</dt><dd className="docs-tags">
              {doc.tags.map((t, i) => <span key={t} className={`docs-tag ${TAG_COLORS[i % 4]}`}>{t}<button aria-label={`Remove tag ${t}`} onClick={() => act.updateDocument(doc.id, { tags: doc.tags.filter((x) => x !== t) })}><XMarkIcon /></button></span>)}
              {tagging
                ? <input ref={tagRef} className="docs-tag-in" aria-label="New tag" value={tag} placeholder="tag" onChange={(e) => setTag(e.target.value)} onBlur={addTag} onKeyDown={(e) => { if (e.key === "Enter") addTag(); if (e.key === "Escape") { setTag(""); setTagging(false); } }} />
                : <button className="docs-tag-add" aria-label="Add tag" onClick={() => setTagging(true)}><PlusIcon /></button>}
            </dd></div>
            <div><dt><BuildingOffice2Icon />Company</dt><dd>
              <select className={`docs-inline-sel ${doc.company ? "" : "dim"}`} aria-label="Company" value={doc.company ?? ""} onChange={(e) => act.updateDocument(doc.id, { company: e.target.value || undefined })}>
                <option value="">Not linked</option>
                {data.companies.map((c) => <option key={c.id}>{c.name}</option>)}
                {doc.company && !data.companies.some((c) => c.name === doc.company) && <option>{doc.company}</option>}
              </select></dd></div>
            <div><dt><LinkIcon />Linked Jobs</dt><dd className="docs-linkrow"><a role="button" tabIndex={0} onClick={() => setTab("jobs")} onKeyDown={(e) => e.key === "Enter" && setTab("jobs")}>{doc.jobIds.length} application{doc.jobIds.length === 1 ? "" : "s"}</a><button className="btn sm" onClick={() => setTab("jobs")}>View</button></dd></div>
            <hr />
            <div><dt><ClockIcon />Last Modified</dt><dd>{fmtDateTime(doc.modifiedAt)}</dd></div>
            <div><dt><CalendarDaysIcon />Created</dt><dd>{fmtDateTime(doc.createdAt)}</dd></div>
            <div><dt><ArrowPathIcon />Size</dt><dd>{fmtBytes(doc.size)}</dd></div>
          </dl>
        )}

        {tab === "versions" && (
          <div className="docs-versions">
            <button className="btn sm" onClick={async () => { const [f] = await pickFiles(".pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.md", false); if (f) { await act.addVersion(doc.id, f, `Uploaded ${f.name}`); toast("New version uploaded"); } }}><ArrowUpTrayIcon />Upload new version</button>
            <ul>
              {sortedVersions.map((v, idx) => {
                const current = v.id === doc.currentVersion;
                const num = doc.versions.length - idx;
                return (
                  <li key={v.id} className={current ? "cur" : ""}>
                    <div><b>Version {num}</b> {current && <span className="pill">Current</span>}<p>{fmtDateTime(v.at)} · {fmtBytes(v.size)}</p>{v.note && <p className="note">{v.note}</p>}</div>
                    <div className="docs-ver-act">
                      <button className="btn sm" onClick={() => A.open({ ...doc, currentVersion: v.id }, v.id)}>Open</button>
                      <button className="icon-btn ghost" aria-label="Download this version" onClick={() => A.download({ ...doc, currentVersion: v.id }, v.id)}><ArrowDownTrayIcon /></button>
                      {!current && <button className="btn sm" onClick={() => { act.updateDocument(doc.id, { currentVersion: v.id, size: v.size, hasFile: doc.hasFile }); toast(`Restored version ${num}`); }}><ArrowUturnLeftIcon />Restore this version</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {tab === "jobs" && (
          <div className="docs-jobs">
            <div className="docs-linkrow">
              <select aria-label="Link a job" value="" onChange={(e) => { if (e.target.value) { act.updateDocument(doc.id, { jobIds: [...doc.jobIds, e.target.value] }); toast("Job linked"); } }}>
                <option value="">Link job…</option>
                {unlinked.map((j) => <option key={j.id} value={j.id}>{j.role} — {j.company}</option>)}
              </select>
            </div>
            {jobs.length === 0 && <p className="docs-empty-line"><BriefcaseIcon />No linked jobs yet.</p>}
            <ul>
              {jobs.map((j) => j && (
                <li key={j.id}>
                  <button className="docs-job" onClick={() => openJob(j.id)}>
                    <Logo name={j.company} size={30} />
                    <span><b>{j.role}</b><em>{j.company}</em></span>
                    <StatusPill status={j.status} />
                  </button>
                  <button className="icon-btn ghost" aria-label={`Unlink ${j.role}`} onClick={() => act.updateDocument(doc.id, { jobIds: doc.jobIds.filter((x) => x !== j.id) })}><XMarkIcon /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="docs-actions">

        <button className="btn" onClick={() => A.download(doc)}><ArrowDownTrayIcon />Download</button>
        <button className="btn" onClick={() => A.duplicate(doc.id)}><DocumentDuplicateIcon />Duplicate</button>
        {doc.trashed ? (
          <>
            <button className="btn" onClick={() => A.restore([doc.id])}><ArrowUturnLeftIcon />Restore</button>
            <button className="btn danger" onClick={() => A.remove([doc.id])}><TrashIcon />Delete forever</button>
          </>
        ) : (
          <button className="btn danger" onClick={() => A.trash([doc.id])}><TrashIcon />Move to Trash</button>
        )}
      </div>
    </div>
  );
}
