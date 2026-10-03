import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowDownTrayIcon, ArrowUturnLeftIcon, ChevronDownIcon, DocumentDuplicateIcon, EllipsisHorizontalIcon, EllipsisVerticalIcon, FolderIcon, FolderOpenIcon, ListBulletIcon,
  PlusIcon, Squares2X2Icon, TableCellsIcon, TrashIcon, ArrowUpTrayIcon, FolderPlusIcon, ArrowTopRightOnSquareIcon, DocumentTextIcon, ComputerDesktopIcon, XMarkIcon, EyeIcon,
} from "@heroicons/react/24/outline";
import { useData } from "../lib/store";
import { useUI } from "../lib/ui";
import { pickFiles } from "../lib/files";
import { BASE_FOLDERS, type DocItem } from "../lib/types";
import { fmtBytes, fmtDate } from "../lib/format";
import { Logo } from "../components/Logo";
import { Modal, Field } from "../components/ui";
import { Menu, type MenuItem } from "./documents/Menu";
import { Viewer } from "./documents/Preview";
import { Detail, Tile } from "./documents/Detail";
import { useDocActions } from "./documents/actions";
import "./documents.css";

type View = "list" | "grid" | "compact";
type Sort = "modified" | "oldest" | "name" | "size" | "type";
const ALL = "All Files";
const TRASH = "Trash";
const FOLDER_COLOR: Record<string, string> = { [ALL]: "blue", Resumes: "purple", "Cover Letters": "blue", Portfolios: "red", Certificates: "blue", Applications: "green", "Company Specific": "amber", Other: "red", [TRASH]: "gray" };
const CATS: { folder: string; color: string }[] = [
  { folder: ALL, color: "blue" }, { folder: "Resumes", color: "red" }, { folder: "Cover Letters", color: "purple" },
  { folder: "Portfolios", color: "blue" }, { folder: "Certificates", color: "amber" }, { folder: "Other", color: "green" },
];

function hasFiles(e: DragEvent) { return Array.from(e.dataTransfer?.types ?? []).includes("Files"); }

export default function Documents() {
  const { data, act } = useData();
  const { search, params, toast } = useUI();
  const A = useDocActions();
  const [folder, setFolder] = useState(ALL);
  const [selId, setSelId] = useState<string | undefined>();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [typeF, setTypeF] = useState("");
  const [compF, setCompF] = useState("");
  const [sort, setSort] = useState<Sort>("modified");
  const [view, setView] = useState<View>("list");
  const [panel, setPanel] = useState(false);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const docs = data.documents;
  const live = useMemo(() => docs.filter((d) => !d.trashed), [docs]);
  const allFolders = useMemo(() => [...BASE_FOLDERS, ...data.folders], [data.folders]);
  const countOf = (f: string) => (f === ALL ? live.length : f === TRASH ? docs.length - live.length : live.filter((d) => d.folder === f).length);

  // preselect from navigate("documents", { doc })
  useEffect(() => {
    const id = params.doc;
    if (!id) return;
    const d = docs.find((x) => x.id === id);
    if (d) { setFolder(d.trashed ? TRASH : ALL); setSelId(id); setPanel(true); }
  }, [params.doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    let r = folder === TRASH ? docs.filter((d) => d.trashed) : live.filter((d) => folder === ALL || d.folder === folder);
    if (typeF) r = r.filter((d) => d.ext.toUpperCase() === typeF);
    if (compF) r = r.filter((d) => (d.company ?? "") === (compF === "-" ? "" : compF));
    if (q) r = r.filter((d) => [d.name, d.description, d.company ?? "", d.ext, d.tags.join(" ")].join(" ").toLowerCase().includes(q));
    const cmp: Record<Sort, (a: DocItem, b: DocItem) => number> = {
      modified: (a, b) => b.modifiedAt - a.modifiedAt, oldest: (a, b) => a.modifiedAt - b.modifiedAt,
      name: (a, b) => a.name.localeCompare(b.name), size: (a, b) => b.size - a.size, type: (a, b) => a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name),
    };
    return [...r].sort(cmp[sort]);
  }, [docs, live, folder, typeF, compF, q, sort]);

  const selected = docs.find((d) => d.id === selId);
  const exts = [...new Set(docs.map((d) => d.ext.toUpperCase()))].sort();
  const companies = [...new Set(docs.map((d) => d.company).filter((c): c is string => !!c))].sort();

  // keep checked set valid
  useEffect(() => { setChecked((c) => { const ids = new Set(docs.map((d) => d.id)); const n = new Set([...c].filter((x) => ids.has(x))); return n.size === c.size ? c : n; }); }, [docs]);
  // when the selection disappears from the visible folder (e.g. trashed), pick nothing
  useEffect(() => {
    if (selId && !docs.some((d) => d.id === selId)) setSelId(undefined);
    else if (!selId && docs.length) setSelId(docs[0].id);
  }, [docs, selId]);

  const select = (id: string) => { setSelId(id); setPanel(true); };
  const toggle = (id: string) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const ids = [...checked];

  const upload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const target = folder === ALL || folder === TRASH ? undefined : folder;
    try {
      const created = await act.addFiles(files, { folder: target });
      if (created[0]) { if (folder === TRASH) setFolder(ALL); select(created[0].id); }
      toast(`${created.length} file${created.length === 1 ? "" : "s"} uploaded${target ? ` to ${target}` : ""}`);
    } catch {
      toast("Upload failed", "warn");
    }
  }, [act, folder, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = async () => upload(await pickFiles());
  const createFolder = () => {
    const n = (newFolder ?? "").trim();
    if (!n) return;
    if ([...allFolders, ALL, TRASH].some((f) => f.toLowerCase() === n.toLowerCase())) { toast("That folder already exists", "warn"); return; }
    act.addFolder(n); setFolder(n); setNewFolder(null); toast(`Folder "${n}" created`);
  };

  const moveItems = (idsToMove: string[]): MenuItem[] => allFolders.map((f) => ({ label: f, icon: <FolderIcon />, onClick: () => A.move(idsToMove, f) }));
  const rowMenu = (d: DocItem): MenuItem[] => d.trashed
    ? [
      { label: "Restore", icon: <ArrowUturnLeftIcon />, onClick: () => A.restore([d.id]) },
      { label: "Delete forever", icon: <TrashIcon />, danger: true, onClick: () => A.remove([d.id]) },
    ]
    : [
      { label: "Open", icon: <ComputerDesktopIcon />, onClick: () => A.open(d) },
      { label: "Preview", icon: <EyeIcon />, onClick: () => { select(d.id); setFull(true); } },
      { label: "Download", icon: <ArrowDownTrayIcon />, onClick: () => A.download(d) },
      { label: "Duplicate", icon: <DocumentDuplicateIcon />, onClick: () => A.duplicate(d.id) },
      { label: "Move to folder", icon: <FolderOpenIcon />, children: moveItems([d.id]) },
      { sep: true, label: "" },
      { label: "Move to Trash", icon: <TrashIcon />, danger: true, onClick: () => A.trash([d.id]) },
    ];

  // drag & drop
  const dnd = {
    onDragEnter: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDrag(true); },
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: (e: DragEvent) => { if (!hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDrag(false); },
    onDrop: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setDrag(false); upload(Array.from(e.dataTransfer.files)); },
  };

  const title = folder === TRASH ? "Trash" : folder;
  const FolderRow = ({ name }: { name: string }) => (
    <button className={`docs-folder ${folder === name ? "on" : ""}`} onClick={() => { setFolder(name); setChecked(new Set()); }}>
      {name === TRASH ? <TrashIcon className="gray" /> : <FolderIcon className={FOLDER_COLOR[name] ?? "teal"} />}
      <span>{name}</span><b>{countOf(name)}</b>
    </button>
  );

  return (
    <div className="page docs-page" {...dnd}>
      <div className="docs-main">
        <div className="docs-head">
          <div>
            <h1>Documents</h1>
            <p>Manage your resumes, cover letters, portfolios and other application files.</p>
          </div>
          <div className="docs-head-actions">
            <div className="docs-views">
              <button className={view === "list" ? "on" : ""} aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><ListBulletIcon /></button>
              <button className={view === "grid" ? "on" : ""} aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Squares2X2Icon /></button>
              <button className={view === "compact" ? "on" : ""} aria-label="Compact grid view" aria-pressed={view === "compact"} onClick={() => setView("compact")}><TableCellsIcon /></button>
            </div>
            <div className="docs-split big">
              <button className="btn primary" onClick={onPick}><PlusIcon />Upload</button>
              <Menu label="Upload options" items={[
                { label: "Upload files", icon: <ArrowUpTrayIcon />, onClick: onPick },
                { label: "New folder", icon: <FolderPlusIcon />, onClick: () => setNewFolder("") },
              ]} trigger={(p) => <button className="btn primary chev" aria-label="Upload options" {...p}><ChevronDownIcon /></button>} />
            </div>
          </div>
        </div>

        <div className="docs-cats">
          {CATS.map((c) => (
            <button key={c.folder} className={`docs-cat ${folder === c.folder ? "on" : ""}`} onClick={() => { setFolder(c.folder); setChecked(new Set()); }}>
              <span className={`docs-cat-ic ${c.color}`}>{c.folder === ALL ? <DocumentTextIcon /> : <FolderIcon />}</span>
              <span><b>{c.folder}</b><em>{countOf(c.folder)} file{countOf(c.folder) === 1 ? "" : "s"}</em></span>
            </button>
          ))}
        </div>

        <div className="docs-body">
          <aside className="docs-folders card">
            <header><h2>Folders</h2><button className="icon-btn ghost" aria-label="New folder" onClick={() => setNewFolder("")}><PlusIcon /></button></header>
            <div className="docs-folder-list">
              <FolderRow name={ALL} />
              {allFolders.map((f) => <FolderRow key={f} name={f} />)}
              <FolderRow name={TRASH} />
            </div>
          </aside>

          <section className="docs-table card">
            <header>
              <h2>{title}</h2>
              <div className="docs-filters">
                <select className="docs-sel" aria-label="Filter by type" value={typeF} onChange={(e) => setTypeF(e.target.value)}><option value="">All Types</option>{exts.map((x) => <option key={x}>{x}</option>)}</select>
                <select className="docs-sel" aria-label="Filter by company" value={compF} onChange={(e) => setCompF(e.target.value)}><option value="">All Companies</option><option value="-">No company</option>{companies.map((x) => <option key={x}>{x}</option>)}</select>
                <select className="docs-sel" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="modified">Last Modified</option><option value="oldest">Oldest First</option><option value="name">Name</option><option value="size">Size</option><option value="type">Type</option>
                </select>
                <div className="docs-views sm">
                  <button className={view === "list" ? "on" : ""} aria-label="List" onClick={() => setView("list")}><ListBulletIcon /></button>
                  <button className={view !== "list" ? "on" : ""} aria-label="Grid" onClick={() => setView(view === "grid" ? "compact" : "grid")}><Squares2X2Icon /></button>
                </div>
              </div>
            </header>

            {checked.size > 0 && (
              <div className="docs-bulk">
                <b>{checked.size} selected</b>
                {folder === TRASH ? (
                  <>
                    <button className="btn sm" onClick={() => { A.restore(ids); setChecked(new Set()); }}><ArrowUturnLeftIcon />Restore</button>
                    <button className="btn sm danger" onClick={async () => { if (await A.remove(ids)) setChecked(new Set()); }}><TrashIcon />Delete forever</button>
                  </>
                ) : (
                  <>
                    <Menu label="Move to folder" align="left" items={moveItems(ids)} trigger={(p) => <button className="btn sm" {...p}><FolderOpenIcon />Move to folder<ChevronDownIcon /></button>} />
                    <button className="btn sm danger" onClick={() => { A.trash(ids); setChecked(new Set()); }}><TrashIcon />Move to Trash</button>
                  </>
                )}
                <button className="btn sm ghost" onClick={() => setChecked(new Set())}>Clear</button>
              </div>
            )}

            <div className="docs-scroll">
              {rows.length === 0 ? (
                <div className="docs-empty">
                  <FolderOpenIcon />
                  <b>{q || typeF || compF ? "No documents match your filters" : folder === TRASH ? "Trash is empty" : "No documents here yet"}</b>
                  <p>{folder === TRASH ? "Deleted documents show up here." : "Drop files anywhere on this page, or upload from your computer."}</p>
                  {folder !== TRASH && <button className="btn primary" onClick={onPick}><PlusIcon />Upload files</button>}
                </div>
              ) : view === "list" ? (
                <table className="docs-tbl">
                  <thead>
                    <tr>
                      <th className="c-chk"><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                      <th>Name</th><th>Type</th><th className="c-co">Company</th><th>Date Modified</th><th className="c-sz">Size</th><th className="c-act" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id} className={`${selId === d.id ? "picked" : ""}`} onClick={() => select(d.id)} onDoubleClick={() => A.open(d)}>
                        <td className="c-chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${d.name}`} checked={checked.has(d.id)} onChange={() => toggle(d.id)} /></td>
                        <td><div className="docs-name"><Tile doc={d} /><span><b title={d.name}>{d.name}</b><em>{d.description}</em></span></div></td>
                        <td><span className={`docs-type ${d.ext.toUpperCase() === "PDF" ? "pdf" : ["DOC", "DOCX"].includes(d.ext.toUpperCase()) ? "word" : ""}`}>{d.ext.toUpperCase()}</span></td>
                        <td className="c-co">{d.company ? <span className="docs-co"><Logo name={d.company} size={22} />{d.company}</span> : <span className="dim">—</span>}</td>
                        <td className="nowrap">{fmtDate(d.modifiedAt)}</td>
                        <td className="nowrap c-sz">{fmtBytes(d.size)}</td>
                        <td className="c-act" onClick={(e) => e.stopPropagation()}>
                          <Menu label={`Actions for ${d.name}`} items={rowMenu(d)} trigger={(p) => <button className="icon-btn ghost" aria-label={`Actions for ${d.name}`} {...p}><EllipsisVerticalIcon /></button>} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={`docs-grid ${view}`}>
                  {rows.map((d) => (
                    <div key={d.id} role="button" tabIndex={0} className={`docs-card ${selId === d.id ? "picked" : ""}`} onClick={() => select(d.id)} onDoubleClick={() => A.open(d)} onKeyDown={(e) => e.key === "Enter" && select(d.id)}>
                      <label className="docs-card-chk" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${d.name}`} checked={checked.has(d.id)} onChange={() => toggle(d.id)} /></label>
                      <div className="docs-card-menu" onClick={(e) => e.stopPropagation()}>
                        <Menu label={`Actions for ${d.name}`} items={rowMenu(d)} trigger={(p) => <button className="icon-btn ghost" aria-label={`Actions for ${d.name}`} {...p}><EllipsisHorizontalIcon /></button>} />
                      </div>
                      <Tile doc={d} size={view === "grid" ? 64 : 44} />
                      <b title={d.name}>{d.name}</b>
                      {view === "grid" && <em>{d.description}</em>}
                      <div className="docs-card-meta"><span className={`docs-type ${d.ext.toUpperCase() === "PDF" ? "pdf" : ["DOC", "DOCX"].includes(d.ext.toUpperCase()) ? "word" : ""}`}>{d.ext.toUpperCase()}</span><span>{fmtBytes(d.size)}</span></div>
                      {view === "grid" && <small>{d.company ? `${d.company} · ` : ""}{fmtDate(d.modifiedAt)}</small>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <aside className={`docs-aside ${panel ? "open" : ""}`} aria-label="Document preview">
        {selected ? (
          <>
            <div className="docs-aside-top">
              <button className="icon-btn docs-only-narrow" aria-label="Close preview" onClick={() => setPanel(false)}><XMarkIcon /></button>
              <button className="icon-btn" aria-label="Open preview in full screen" onClick={() => setFull(true)}><ArrowTopRightOnSquareIcon /></button>
              <Menu label="More actions" items={rowMenu(selected)} trigger={(p) => <button className="icon-btn" aria-label="More actions" {...p}><EllipsisHorizontalIcon /></button>} />
            </div>
            <div className="docs-aside-scroll">
              <Viewer doc={selected} profile={data.settings.profile} onFull={() => setFull(true)} onOpen={() => A.open(selected)} />
              <Detail doc={selected} onFull={() => setFull(true)} />
            </div>
          </>
        ) : (
          <div className="docs-aside-empty"><DocumentTextIcon /><b>Select a document</b><p>Pick a file from the list to preview it and see its details.</p></div>
        )}
      </aside>
      {panel && <div className="docs-scrim" onClick={() => setPanel(false)} />}

      {full && selected && (
        <div className="docs-full" role="dialog" aria-modal="true" aria-label={`${selected.name} preview`} onKeyDown={(e) => e.key === "Escape" && setFull(false)} tabIndex={-1} ref={(el) => el?.focus()}>
          <header>
            <Tile doc={selected} size={34} />
            <div><b>{selected.name}.{selected.ext.toLowerCase()}</b><span>{fmtBytes(selected.size)} · Modified {fmtDate(selected.modifiedAt)}</span></div>
            <button className="btn primary" onClick={() => A.open(selected)}><ComputerDesktopIcon />Open in default app</button>
            <button className="btn" onClick={() => A.download(selected)}><ArrowDownTrayIcon />Download</button>
            <button className="icon-btn" aria-label="Close" onClick={() => setFull(false)}><XMarkIcon /></button>
          </header>
          <Viewer full doc={selected} profile={data.settings.profile} onOpen={() => A.open(selected)} />
        </div>
      )}

      {drag && (
        <div className="docs-drop"><div><ArrowUpTrayIcon /><b>Drop files to upload</b><span>{folder === ALL || folder === TRASH ? "They'll be sorted automatically" : `Into ${folder}`}</span></div></div>
      )}

      {newFolder !== null && (
        <Modal title="New folder" onClose={() => setNewFolder(null)} footer={<><button className="btn" onClick={() => setNewFolder(null)}>Cancel</button><button className="btn primary" disabled={!newFolder.trim()} onClick={createFolder}>Create folder</button></>}>
          <Field label="Folder name"><input autoFocus value={newFolder} placeholder="e.g. Recommendation Letters" onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFolder()} /></Field>
        </Modal>
      )}
    </div>
  );
}
