import type { ReactNode } from "react";
import type { DocItem, Settings } from "../../lib/types";
import { getFile } from "../../lib/filedb";
import { fmtDate } from "../../lib/format";

/* ───────── kinds ───────── */
export type PreviewKind = "pdf" | "image" | "docx" | "text" | "other";
export const extLower = (d: Pick<DocItem, "ext">) => d.ext.toLowerCase();
export function previewKind(d: DocItem): PreviewKind {
  const e = extLower(d);
  if (e === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(e)) return "image";
  if (e === "docx") return "docx";
  if (["txt", "tex", "md", "markdown", "csv", "json", "log"].includes(e)) return "text";
  return "other";
}
export const typeLabel = (ext: string) => {
  const m: Record<string, string> = { PDF: "PDF Document", DOCX: "Word Document", DOC: "Word Document", TXT: "Text Document", MD: "Markdown Document", RTF: "Rich Text Document", PNG: "PNG Image", JPG: "JPEG Image", JPEG: "JPEG Image", PAGES: "Pages Document" };
  return m[ext.toUpperCase()] ?? `${ext.toUpperCase()} File`;
};
export const isWordish = (ext: string) => ["DOC", "DOCX", "RTF"].includes(ext.toUpperCase());

/* ───────── structured paper content for seeded (byte-less) docs ───────── */
type Entry = { role: string; org: string; dates: string; bullets: string[] };
type Section = { heading: string; text?: string[]; entries?: Entry[]; list?: string[] };
export type Paper = {
  kind: "resume" | "letter" | "generic";
  name: string;
  title: string;
  contact: string[];
  pages: Section[][];
  letter?: { date: string; to: string[]; salutation: string; paras: string[]; closing: string };
};

const yr = new Date().getFullYear();

export function buildPaper(doc: DocItem, profile: Settings["profile"]): Paper {
  const name = profile.name || "Your Name";
  const contact = [profile.email, profile.phone, profile.location, profile.linkedin].filter(Boolean);
  const dash = doc.name.split(" - ")[1];
  const isResume = doc.folder === "Resumes" || /resume|cv/i.test(doc.name);
  const isLetter = doc.folder === "Cover Letters" || /cover letter/i.test(doc.name);
  if (isResume) {
    const title = dash || profile.title || "Professional";
    return {
      kind: "resume", name, title, contact,
      pages: [
        [
          { heading: "Summary", text: [`${title} with 4+ years of experience building scalable products and applications. Passionate about solving real problems and creating intuitive user experiences.`] },
          {
            heading: "Experience",
            entries: [
              { role: title, org: "Brightline Systems", dates: `${yr - 3} – Present`, bullets: ["Built and maintained core infrastructure used by 1M+ users", "Improved API performance by 40% through system optimization", "Led a team of 4 engineers on key product initiatives"] },
              { role: title, org: "Harbor Analytics", dates: `${yr - 5} – ${yr - 3}`, bullets: ["Developed and launched multiple customer-facing features", "Worked with cross-functional teams to ship on schedule", "Reduced system latency by 30% through architecture improvements"] },
            ],
          },
        ],
        [
          { heading: "Education", entries: [{ role: "B.S. Computer Science", org: "State University", dates: `${yr - 9} – ${yr - 5}`, bullets: [] }] },
          { heading: "Skills", list: ["TypeScript, Python, SQL, Go", "React, Node.js, REST and GraphQL APIs", "AWS, Docker, CI/CD, observability"] },
          { heading: "Projects", entries: [{ role: "Open-source workflow toolkit", org: "Personal project", dates: `${yr - 1}`, bullets: ["Automation toolkit adopted by 300+ developers", "Designed plugin architecture and documentation"] }] },
        ],
      ],
    };
  }
  if (isLetter) {
    const role = doc.description || "the open role";
    const co = doc.company || (dash ?? "your company");
    return {
      kind: "letter", name, title: profile.title, contact,
      pages: [[]],
      letter: {
        date: fmtDate(doc.modifiedAt),
        to: ["Hiring Manager", co],
        salutation: "Dear Hiring Team,",
        paras: [
          `I am excited to apply for the ${role} position at ${co}. With a background in ${profile.title || "software and product work"}, I have built products that balance craft, reliability, and measurable impact.`,
          "In my recent work I led delivery of customer-facing features, partnered closely with design and product, and improved system performance by double digits. I enjoy turning ambiguous problems into shipped, well-tested solutions.",
          `I would welcome the chance to discuss how my experience can contribute to ${co}. Thank you for your time and consideration.`,
        ],
        closing: "Sincerely,",
      },
    };
  }
  return {
    kind: "generic", name: doc.name, title: doc.description, contact: [],
    pages: [[
      { heading: "Overview", text: [doc.description || "Document", `Owner: ${name}`, `Folder: ${doc.folder}`, `Last modified ${fmtDate(doc.modifiedAt)}`] },
      { heading: "Contents", list: ["Section 1 – Introduction", "Section 2 – Details", "Section 3 – Supporting material"] },
    ]],
  };
}

/* ───────── paper renderer (designed look) ───────── */
export function PaperPage({ paper, page }: { paper: Paper; page: number }): ReactNode {
  if (paper.kind === "letter" && paper.letter) {
    const l = paper.letter;
    return (
      <div className="docs-paper letter">
        <h2>{paper.name}</h2>
        <p className="muted">{paper.contact.join("  ·  ")}</p>
        <p className="gap">{l.date}</p>
        <p className="gap">{l.to.map((t) => <span key={t} className="blk">{t}</span>)}</p>
        <p className="gap">{l.salutation}</p>
        {l.paras.map((p, i) => <p key={i} className="para">{p}</p>)}
        <p className="gap">{l.closing}</p>
        <p><b>{paper.name}</b></p>
      </div>
    );
  }
  const sections = paper.pages[Math.min(page, paper.pages.length - 1)] ?? [];
  return (
    <div className="docs-paper">
      {page === 0 && (
        <div className="docs-paper-top">
          <div>
            <h2>{paper.name}</h2>
            <h3>{paper.title}</h3>
          </div>
          {paper.contact.length > 0 && <div className="docs-paper-contact">{paper.contact.map((c) => <span key={c}>{c}</span>)}</div>}
        </div>
      )}
      {sections.map((s) => (
        <section key={s.heading}>
          <h4>{s.heading}</h4>
          {s.text?.map((t) => <p key={t} className="para">{t}</p>)}
          {s.list && <ul>{s.list.map((t) => <li key={t}>{t}</li>)}</ul>}
          {s.entries?.map((e) => (
            <div key={e.role + e.org} className="docs-paper-entry">
              <div className="row"><b>{e.role}</b><span className="muted">{e.dates}</span></div>
              <div>{e.org}</div>
              {e.bullets.length > 0 && <ul>{e.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ───────── plain-text flattening (for generated files) ───────── */
type Line = { t: string; size: number; bold?: boolean; gap?: number };
function paperLines(paper: Paper): Line[] {
  const out: Line[] = [];
  const wrap = (t: string, size: number, indent = "", bold = false) => {
    const max = Math.floor(92 * (11 / size));
    const words = t.split(/\s+/);
    let cur = indent;
    for (const w of words) {
      if ((cur + " " + w).length > max && cur.trim()) { out.push({ t: cur, size, bold }); cur = indent + "  " + w; } else cur = cur.trim() ? `${cur} ${w}` : indent + w;
    }
    if (cur.trim()) out.push({ t: cur, size, bold });
  };
  if (paper.kind === "letter" && paper.letter) {
    const l = paper.letter;
    out.push({ t: paper.name, size: 20, bold: true });
    if (paper.contact.length) out.push({ t: paper.contact.join("  |  "), size: 9 });
    out.push({ t: "", size: 11 }, { t: l.date, size: 11 }, { t: "", size: 11 });
    l.to.forEach((t) => out.push({ t, size: 11 }));
    out.push({ t: "", size: 11 }, { t: l.salutation, size: 11 }, { t: "", size: 11 });
    l.paras.forEach((p) => { wrap(p, 11); out.push({ t: "", size: 11 }); });
    out.push({ t: l.closing, size: 11 }, { t: paper.name, size: 11, bold: true });
    return out;
  }
  out.push({ t: paper.name, size: 20, bold: true });
  if (paper.title) out.push({ t: paper.title, size: 13 });
  if (paper.contact.length) out.push({ t: paper.contact.join("  |  "), size: 9 });
  paper.pages.flat().forEach((s) => {
    out.push({ t: "", size: 8 }, { t: s.heading.toUpperCase(), size: 12, bold: true });
    s.text?.forEach((t) => wrap(t, 10.5));
    s.list?.forEach((t) => wrap(`- ${t}`, 10.5));
    s.entries?.forEach((e) => {
      out.push({ t: `${e.role}  (${e.dates})`, size: 11, bold: true }, { t: e.org, size: 10.5 });
      e.bullets.forEach((b) => wrap(`- ${b}`, 10, "  "));
    });
  });
  return out;
}

/* ───────── generators ───────── */
const pdfEsc = (s: string) => s.replace(/[\u2013\u2014]/g, "-").replace(/[^\x20-\x7e]/g, (c) => (c.charCodeAt(0) < 256 ? c : "?")).replace(/([\\()])/g, "\\$1");

/** Hand-written minimal PDF (Helvetica, US Letter, multi-page) — no dependencies. */
export function makePdf(lines: Line[]): Blob {
  const pages: Line[][] = [[]];
  let y = 740;
  for (const l of lines) {
    const lh = l.size * 1.45;
    if (y - lh < 56) { pages.push([]); y = 740; }
    y -= lh;
    pages[pages.length - 1].push({ ...l, gap: y });
  }
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const n = pages.length;
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((p, i) => {
    const content = p.filter((l) => l.t).map((l) => `BT /${l.bold ? "F2" : "F1"} ${l.size} Tf 56 ${l.gap!.toFixed(1)} Td (${pdfEsc(l.t)}) Tj ET`).join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
    objs[6 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return new Blob([bytes], { type: "application/pdf" });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Word-compatible HTML (opens in Microsoft Word as an editable document). */
export function makeWordDoc(paper: Paper): Blob {
  let body = "";
  if (paper.kind === "letter" && paper.letter) {
    const l = paper.letter;
    body = `<h1>${esc(paper.name)}</h1><p class=m>${esc(paper.contact.join("  |  "))}</p><p>${esc(l.date)}</p><p>${l.to.map(esc).join("<br>")}</p><p>${esc(l.salutation)}</p>${l.paras.map((p) => `<p>${esc(p)}</p>`).join("")}<p>${esc(l.closing)}<br><b>${esc(paper.name)}</b></p>`;
  } else {
    body = `<h1>${esc(paper.name)}</h1><p><b>${esc(paper.title)}</b></p><p class=m>${esc(paper.contact.join("  |  "))}</p>`;
    paper.pages.flat().forEach((s) => {
      body += `<h2>${esc(s.heading)}</h2>`;
      s.text?.forEach((t) => (body += `<p>${esc(t)}</p>`));
      if (s.list) body += `<ul>${s.list.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
      s.entries?.forEach((e) => {
        body += `<p><b>${esc(e.role)}</b> &mdash; ${esc(e.org)} <span class=m>(${esc(e.dates)})</span></p>`;
        if (e.bullets.length) body += `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
      });
    });
  }
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(paper.name)}</title><!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#222}h1{font-size:22pt;margin:0}h2{font-size:12pt;border-bottom:1px solid #999;margin-top:14pt}p{margin:4pt 0}.m{color:#666;font-size:9pt}</style></head><body>${body}</body></html>`;
  return new Blob(["﻿", html], { type: "application/msword" });
}

export type DocFile = { blob: Blob; fileName: string; generated: boolean };
/** Bytes for a document (real file from IndexedDB, or a generated stand-in for seeded docs). */
export async function docFile(doc: DocItem, profile: Settings["profile"], versionId?: string): Promise<DocFile> {
  const vid = versionId ?? doc.currentVersion;
  if (doc.hasFile) {
    const b = await getFile(`${doc.id}:${vid}`);
    if (b) return { blob: b, fileName: `${doc.name}.${extLower(doc)}`, generated: false };
  }
  const paper = buildPaper(doc, profile);
  const e = extLower(doc);
  if (e === "pdf") return { blob: makePdf(paperLines(paper)), fileName: `${doc.name}.pdf`, generated: true };
  if (isWordish(doc.ext)) return { blob: makeWordDoc(paper), fileName: `${doc.name}.doc`, generated: true };
  const txt = paperLines(paper).map((l) => l.t).join("\n");
  return { blob: new Blob([txt], { type: "text/plain" }), fileName: `${doc.name}.txt`, generated: true };
}

/** Strip anything executable from mammoth's HTML before injecting it. */
export function sanitizeHtml(html: string): string {
  const d = new DOMParser().parseFromString(html, "text/html");
  d.querySelectorAll("script,iframe,object,embed,style,link,meta,form,base").forEach((n) => n.remove());
  d.body.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith("on") || ((a.name === "href" || a.name === "src" || a.name === "xlink:href") && /^(javascript|vbscript):/.test(v)) || (a.name === "src" && v.startsWith("data:text"))) el.removeAttribute(a.name);
    }
    if (el.tagName === "A") { el.setAttribute("rel", "noopener noreferrer"); el.setAttribute("target", "_blank"); }
  });
  return d.body.innerHTML;
}
