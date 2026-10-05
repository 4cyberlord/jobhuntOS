import { useEffect, useLayoutEffect, useRef, useState } from "react";
import mammoth from "mammoth";
import { ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, ArrowsPointingInIcon, ArrowsPointingOutIcon, DocumentIcon } from "@heroicons/react/24/outline";
import type { DocItem, Settings } from "../../lib/types";
import { getFile } from "../../lib/filedb";
import { PaperPage, buildPaper, previewKind, sanitizeHtml } from "./content";

type Loaded = { key: string; status: "loading" | "ready" | "error"; url?: string; html?: string; text?: string };

const PAGE_W = 612;

export function Viewer({ doc, profile, full, onFull, onOpen }: { doc: DocItem; profile: Settings["profile"]; full?: boolean; onFull?: () => void; onOpen: () => void }) {
  const kind = doc.hasFile ? previewKind(doc) : "paper";
  const key = `${doc.id}:${doc.currentVersion}`;
  const [loaded, setLoaded] = useState<Loaded>({ key, status: doc.hasFile ? "loading" : "ready" });
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [w, setW] = useState(360);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => { setPage(0); setZoom(1); }, [doc.id, doc.currentVersion]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = el.clientWidth;
        setW((current) => Math.abs(current - next) > 1 ? next : current);
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);

  useEffect(() => {
    let url: string | undefined;
    let dead = false;
    if (!doc.hasFile) { setLoaded({ key, status: "ready" }); return; }
    setLoaded({ key, status: "loading" });
    (async () => {
      try {
        const blob = await getFile(key);
        if (!blob) throw new Error("missing");
        if (dead) return;
        const k = previewKind(doc);
        if (k === "pdf") { url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" })); setLoaded({ key, status: "ready", url }); }
        else if (k === "image") { url = URL.createObjectURL(blob); setLoaded({ key, status: "ready", url }); }
        else if (k === "docx") {
          const res = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
          if (!dead) setLoaded({ key, status: "ready", html: sanitizeHtml(res.value) });
        } else if (k === "text") { const t = (await blob.text()).slice(0, 200_000); if (!dead) setLoaded({ key, status: "ready", text: t }); }
        else setLoaded({ key, status: "ready" });
      } catch {
        if (!dead) setLoaded({ key, status: "error" });
      }
    })();
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [key, doc.hasFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const paper = !doc.hasFile ? buildPaper(doc, profile) : null;
  const pages = paper ? paper.pages.length : 1;
  const fit = Math.min(full ? 1.6 : 1.2, Math.max(0.3, (w - 32) / PAGE_W));
  const scale = fit * zoom;
  const cur = loaded.key === key ? loaded : { key, status: "loading" as const };
  const isPdf = kind === "pdf" && cur.status === "ready" && cur.url;
  const Z = (d: number) => setZoom((z) => Math.min(3, Math.max(0.4, +(z + d).toFixed(2))));

  let body;
  if (paper) body = <div className="docs-sheet-wrap" style={{ zoom: scale }}><div className="docs-sheet"><PaperPage paper={paper} page={page} /></div></div>;
  else if (cur.status === "loading") body = <div className="docs-stage-msg">Loading preview…</div>;
  else if (cur.status === "error") body = <div className="docs-stage-msg"><DocumentIcon /><b>Preview not available</b><span>The stored file could not be read.</span><button className="btn sm" onClick={onOpen}>Open</button></div>;
  else if (kind === "pdf" && cur.url) body = <iframe className="docs-pdf" title={`${doc.name} preview`} src={cur.url} style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }} />;
  else if (kind === "image" && cur.url) body = <img className="docs-img" alt={doc.name} src={cur.url} style={{ width: `${Math.max(10, zoom * 100)}%` }} />;
  else if (kind === "docx" && cur.html !== undefined) body = <div className="docs-sheet-wrap" style={{ zoom: scale }}><div className="docs-sheet docs-sheet-doc" dangerouslySetInnerHTML={{ __html: cur.html || "<p><i>This document is empty.</i></p>" }} /></div>;
  else if (kind === "text" && cur.text !== undefined) body = <div className="docs-sheet-wrap" style={{ zoom: scale }}><pre className="docs-sheet docs-sheet-text">{cur.text}</pre></div>;
  else body = <div className="docs-stage-msg"><DocumentIcon /><b>Preview not available</b><span>{doc.ext} files can't be previewed here.</span><button className="btn primary sm" onClick={onOpen}>Open in default app</button></div>;

  return (
    <div className={`docs-viewer ${full ? "full" : ""}`}>
      <div ref={stage} className={`docs-stage ${isPdf ? "pdf" : ""}`}>{body}</div>
      <div className="docs-pager">
        <div className="docs-pager-pg">
          <button className="icon-btn ghost" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeftIcon /></button>
          <span className="docs-pg-num">{page + 1}</span><span className="docs-pg-of">/ {pages}</span>
          <button className="icon-btn ghost" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRightIcon /></button>
        </div>
        <div className="docs-pager-zoom">
          <button className="icon-btn" aria-label="Zoom out" onClick={() => Z(-0.2)}><MagnifyingGlassMinusIcon /></button>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => Z(0.2)}><MagnifyingGlassPlusIcon /></button>
          <button className="icon-btn" aria-label="Fit to width" title={`${Math.round(zoom * 100)}% · click to fit`} onClick={() => setZoom(1)}><ArrowsPointingInIcon /></button>
          {onFull && <button className="icon-btn" aria-label="Full screen preview" onClick={onFull}><ArrowsPointingOutIcon /></button>}
        </div>
      </div>
      {isPdf && <p className="docs-pdf-hint">PDF not showing? <button onClick={onOpen}>Open it in your default app</button></p>}
    </div>
  );
}
