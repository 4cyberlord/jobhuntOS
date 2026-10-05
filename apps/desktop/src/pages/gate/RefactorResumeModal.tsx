import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownTrayIcon, ArrowPathIcon, CheckCircleIcon, ChevronDownIcon, DocumentIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { PlayIcon } from "@heroicons/react/24/solid";
import { SparklesIcon } from "@heroicons/react/20/solid";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { Logo } from "../../components/Logo";
import { getFile } from "../../lib/filedb";
import { buildPaper, previewKind } from "../documents/content";
import { invoke } from "@tauri-apps/api/core";
import { isTauri, saveBlob } from "../../lib/tauri";
import "./refactor.css";

type Props = { gateId: string; onClose: () => void };

const ESC_BS = "__LATEX_BS__";
const escapeLatex = (s: string) =>
  s
    .replace(/\\/g, ESC_BS)
    .replace(/[{}$%&#_~^]/g, (c) => ({ "{": "\\{", "}": "\\}", $: "\\$", "%": "\\%", "&": "\\&", "#": "\\#", _: "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" }[c]!))
    .replaceAll(ESC_BS, "\\textbackslash{}");

function paperToLatex(paper: ReturnType<typeof buildPaper>, jobTitle: string, company: string): string {
  const contact = paper.contact.join(" $\\mid$ ");
  const name = escapeLatex(paper.name);
  const contactCmd = contact ? escapeLatex(contact).replace(/\|/g, "\\;|\\;") : "";
  let out = `% Auto-converted from "${paper.name}" — tailored for ${company} — ${jobTitle}\n`;
  out += `\\documentclass[10pt,letterpaper]{article}\n\\usepackage{enumitem}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{titlesec}\n\\usepackage{xcolor}\n\n`;
  out += `\\newcommand{\\name}{${name}}\n\\newcommand{\\contact}{${contactCmd}}\n\n`;
  out += `\\begin{document}\n  \\begin{center}\n    {\\LARGE \\textbf{\\name}} \\\\\n    {\\small \\contact} \\\\\n  \\end{center}\n  \\vspace{-6pt}\n\n`;
  for (const page of paper.pages) {
    for (const sec of page) {
      out += `\\section*{${escapeLatex(sec.heading)}}\n`;
      sec.text?.forEach((t) => (out += `${escapeLatex(t)}\n\n`));
      if (sec.list?.length) {
        out += `\\begin{itemize}[leftmargin=*]\n`;
        sec.list.forEach((t) => (out += `  \\item ${escapeLatex(t)}\n`));
        out += `\\end{itemize}\n\n`;
      }
      sec.entries?.forEach((e) => {
        out += `\\textbf{${escapeLatex(e.role)}} \\hfill ${escapeLatex(e.dates)} \\\\\n`;
        out += `\\textit{${escapeLatex(e.org)}}\n`;
        if (e.bullets.length) {
          out += `\\begin{itemize}\n`;
          e.bullets.forEach((b) => (out += `  \\item ${escapeLatex(b)}\n`));
          out += `\\end{itemize}\n`;
        }
        out += `\n`;
      });
    }
  }
  out += `\\end{document}\n`;
  return out;
}

function rawTextToLatex(raw: string, name: string, contactLine: string, jobTitle: string, company: string): string {
  const safeName = escapeLatex(name || "Alex Chen");
  const safeContact = escapeLatex(contactLine || "").replace(/\|/g, "\\;|\\;");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  // Heuristic: detect headings; if none, keep one section
  const headingRe = /^(summary|professional summary|experience|work experience|employment|education|skills|technical skills|projects|certifications|awards|publications)\b/i;
  const sections: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  const pushLine = (line: string) => {
    if (headingRe.test(line) && line.length < 42) {
      const title = line.replace(/:$/, "").trim();
      cur = { title: title.charAt(0).toUpperCase() + title.slice(1), body: [] };
      sections.push(cur);
    } else {
      if (!cur) { cur = { title: "Resume", body: [] }; sections.push(cur); }
      cur.body.push(line);
    }
  };
  // Skip first lines that are name/contact/title (first up to 3 lines that look like name)
  let start = 0;
  if (lines[0] && lines[0].toLowerCase().includes(name.toLowerCase().split(" ")[0])) start = 1;
  if (lines[start] && /@|\(|\d{3}/.test(lines[start])) start += 1;
  for (let i = start; i < lines.length; i++) pushLine(lines[i]);
  if (sections.length === 0) sections.push({ title: "Resume", body: lines.slice(start) });

  let out = `% Auto-converted from base resume — tailored for ${company} — ${jobTitle}\n`;
  out += `\\documentclass[10pt,letterpaper]{article}\n\\usepackage{enumitem}\n\\usepackage[hidelinks]{hyperref}\n\\usepackage{titlesec}\n\\usepackage{xcolor}\n\n`;
  out += `\\newcommand{\\name}{${safeName}}\n\\newcommand{\\contact}{${safeContact}}\n\n`;
  out += `\\begin{document}\n  \\begin{center}\n    {\\LARGE \\textbf{\\name}} \\\\\n    {\\small \\contact} \\\\\n  \\end{center}\n  \\vspace{-6pt}\n\n`;
  for (const sec of sections) {
    out += `\\section*{${escapeLatex(sec.title)}}\n`;
    // group consecutive bullet-like lines into itemize
    let buf: string[] = [];
    const flush = (asList: boolean) => {
      if (!buf.length) return;
      if (asList) {
        out += `\\begin{itemize}[leftmargin=*]\n`;
        buf.forEach((b) => out += `  \\item ${escapeLatex(b.replace(/^[-•\u2022]\s*/, ""))}\n`);
        out += `\\end{itemize}\n\n`;
      } else {
        buf.forEach((b) => out += `${escapeLatex(b)}\n\n`);
      }
      buf = [];
    };
    let inList = false;
    for (const b of sec.body) {
      const isBullet = /^[-•\u2022]/.test(b) || b.startsWith("·");
      if (isBullet && !inList) { flush(false); inList = true; }
      if (!isBullet && inList) { flush(true); inList = false; }
      buf.push(b);
    }
    flush(inList);
  }
  out += `\\end{document}\n`;
  return out;
}

async function extractDocText(doc: import("../../lib/types").DocItem, profile: import("../../lib/types").Settings["profile"]): Promise<string> {
  if (!doc.hasFile) {
    const paper = buildPaper(doc, profile);
    // Flatten paper to plain text so rawTextToLatex keeps exact structure
    const parts: string[] = [];
    for (const page of paper.pages) for (const s of page) {
      parts.push(s.heading);
      s.text?.forEach((t) => parts.push(t));
      s.list?.forEach((t) => parts.push(`- ${t}`));
      s.entries?.forEach((e) => { parts.push(`${e.role} — ${e.org} (${e.dates})`); e.bullets.forEach((b) => parts.push(`- ${b}`)); });
    }
    if (paper.letter) parts.push(...paper.letter.paras);
    return parts.join("\n");
  }
  const key = `${doc.id}:${doc.currentVersion}`;
  const blob = await getFile(key);
  if (!blob) throw new Error("File not found");
  const kind = previewKind(doc);
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    // Prefer raw text to preserve content for LaTeX; fallback to html stripped
    try {
      const raw = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() } as never);
      if (raw.value && raw.value.trim().length > 20) return raw.value;
    } catch { /* fall through */ }
    const res = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() } as never);
    const html = res.value || "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    // Convert to text with newlines on block boundaries
    tmp.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    tmp.querySelectorAll("p, li, h1, h2, h3, tr").forEach((el) => { el.prepend("\n"); el.append("\n"); });
    return (tmp.textContent || html.replace(/<[^>]*>/g, " ")).replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (kind === "text") return (await blob.text()).slice(0, 200_000);
  if (kind === "pdf" || kind === "image" || kind === "other") {
    // Try text extraction; if not text, throw to trigger paper fallback
    try { const t = (await blob.text()).slice(0, 200_000); if (t.trim().length > 40 && !t.startsWith("%PDF")) return t; } catch { /* ignore */ }
    throw new Error("Binary file — use paper fallback");
  }
  return (await blob.text()).slice(0, 200_000);
}

export function RefactorResumeModal({ gateId, onClose }: Props) {
  const { data, act } = useData();
  const { toast, navigate } = useUI();
  const gate = useMemo(() => data.gate.find((g) => g.id === gateId), [data.gate, gateId]);
  const env = gate?.envelope as unknown as Record<string, unknown> | undefined;
  const opp = (env?.opportunity ?? {}) as Record<string, unknown>;
  const companyRaw = (env?.company ?? {}) as Record<string, unknown>;
  const sourceRaw = (env?.source ?? {}) as Record<string, unknown>;
  const facts = (env?.structured_facts ?? {}) as Record<string, unknown>;
  const requiredSkills = (facts.required_skills as { skill: string }[] | undefined)?.map((x) => x.skill) ?? [];
  const techs = (facts.technologies as string[] | undefined) ?? [];
  const preferred = (facts.preferred_skills as { skill: string }[] | undefined)?.map((x) => x.skill) ?? [];
  const allKeywords = [...requiredSkills, ...preferred, ...techs].filter(Boolean);
  const matched = allKeywords.slice(0, 12);
  const suggestions = [
    "Emphasize backend projects and distributed systems experience.",
    "Add more quantifiable impact (e.g. % improvements, scale).",
    "Highlight relevant internship experience at scale.",
    `Include keywords: ${(allKeywords.slice(0, 4).join(", ") || "GCP, Kubernetes, system design, microservices")}.`,
  ];

  const companyName = typeof companyRaw.name === "string" ? companyRaw.name : "Unknown";
  const jobTitle = typeof opp.title === "string" ? opp.title : "Software Engineer";
  const locationVal = (() => {
    const loc = opp.location as Record<string, unknown> | undefined;
    const city = typeof loc?.city === "string" ? loc.city : "";
    const state = typeof loc?.state === "string" ? loc.state : "";
    return [city, state].filter(Boolean).join(", ") || "Mountain View, CA";
  })();
  const applyUrl = typeof (opp.application as Record<string, unknown> | undefined)?.apply_url === "string" ? (opp.application as Record<string, unknown>).apply_url as string : "";
  const companyWebsite = typeof companyRaw.website === "string" ? companyRaw.website : undefined;
  const companyLogo = typeof companyRaw.logo_url === "string" ? companyRaw.logo_url : undefined;

  const resumes = useMemo(() => data.documents.filter((d) => d.folder === "Resumes" || /resume|cv/i.test(d.name)), [data.documents]);
  const [baseId, setBaseId] = useState<string>(resumes[0]?.id ?? "");
  const profile = data.settings.profile;
  const contactLine = [profile.email, profile.phone].filter(Boolean).join(" | ") || "alex.chen@gmail.com | (415) 123-4567";
  const [latex, setLatex] = useState<string>("");
  const [baseLatex, setBaseLatex] = useState<string>("");
  const [converted, setConverted] = useState(false);
  const [converting, setConverting] = useState(false);
  const [compiled, setCompiled] = useState(false);
  const [zoom, setZoom] = useState(80);
  const [page] = useState(1);
  const [previewPdf, setPreviewPdf] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Keep baseId in sync if resumes load after mount
  useEffect(() => {
    if (!baseId && resumes[0]) setBaseId(resumes[0].id);
  }, [resumes, baseId]);

  // ---- Convert base resume → LaTeX using EXACT text (docx/txt/pdf via extractDocText) ----
  // This ensures the editor and preview reflect the user's actual uploaded resume,
  // not a synthetic template. Edits in the LaTeX then flow through Compile → preview.
  useEffect(() => {
    if (!baseId) {
      const fallback = `% No base resume selected — tailored for ${companyName} — ${jobTitle}\n` +
        `\\documentclass[10pt,letterpaper]{article}\n\\begin{document}\nNo base resume selected.\\end{document}\n`;
      setLatex(fallback); setBaseLatex(fallback); setConverted(false); setCompiled(false); setPreviewPdf(null); return;
    }
    const doc = resumes.find((d) => d.id === baseId);
    if (!doc) return;
    let cancelled = false;
    setConverting(true); setConverted(false); setCompiled(false); setPreviewPdf(null); setCompileError(null);
    (async () => {
      let tex = "";
      try {
        if (doc.hasFile && !["docx", "text"].includes(previewKind(doc))) {
          throw new Error("This résumé format cannot be safely converted. Choose a DOCX, text, or LaTeX source file.");
        }
        let raw: string;
        try { raw = await extractDocText(doc, profile); } catch { raw = ""; }
        if (!raw || raw.trim().length < 20) {
          const paper = buildPaper(doc, profile);
          tex = paperToLatex(paper, jobTitle, companyName);
        } else {
          tex = rawTextToLatex(raw, profile.name || doc.name.replace(/ - .*/, "") || "Alex Chen", [profile.email, profile.phone].filter(Boolean).join(" | ") || raw.slice(0, 80), jobTitle, companyName);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not convert this résumé.";
        tex = `% ${message}\n\\documentclass{article}\n\\begin{document}\n% Choose a DOCX, text, or LaTeX source file.\n\\end{document}\n`;
        if (!cancelled) setCompileError(message);
      }
      if (cancelled) return;
      setLatex(tex); setBaseLatex(tex); setConverted(true); setConverting(false);
    })();
    return () => { cancelled = true; };
  }, [baseId, companyName, jobTitle, profile.email, profile.name, profile.phone, resumes]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- tiny latex → html compiler (works offline, no server TeX) ----
  // Edits in the LaTeX textarea flow through Compile → preview (live, in-app).
  const stripLatexComments = (src: string) => src.split("\n").map((l) => l.replace(/(?<!\\)%.*$/, "")).join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const latexInline = (s: string) => {
    let t = esc(s);
    t = t.replace(/\\textbf\{([^{}]*)\}/g, "<b>$1</b>");
    t = t.replace(/\\textit\{([^{}]*)\}/g, "<em>$1</em>");
    t = t.replace(/\\emph\{([^{}]*)\}/g, "<em>$1</em>");
    t = t.replace(/\\href\{[^}]*\}\{([^{}]*)\}/g, '<a href="#">$1</a>');
    t = t.replace(/\\%/g, "%");
    t = t.replace(/\\\\/g, "<br/>");
    t = t.replace(/\\hfill/g, " &mdash; ");
    t = t.replace(/\\vspace\{[^}]*\}/g, "");
    t = t.replace(/\\small\s*/g, "");
    t = t.replace(/\\LARGE\s*/g, "");
    return t;
  };
  const compileLatex = (src: string): string => {
    const clean = stripLatexComments(src);
    const bodyMatch = clean.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
    const body = bodyMatch ? bodyMatch[1] : clean;
    const nameM = clean.match(/\\newcommand\{\\name\}\{([^{}]*)\}/);
    const contactM = clean.match(/\\newcommand\{\\contact\}\{([\s\S]*?)\}/);
    const headerName = nameM ? latexInline(nameM[1]).replace(/<[^>]*>/g, "") : (profile.name || "Alex Chen");
    const headerContact = contactM ? latexInline(contactM[1]) : `${esc(profile.email || "alex.chen@gmail.com")} | ${esc(profile.phone || "(415) 123-4567")}`;
    let html = `<h1>${esc(headerName)}</h1><p class="refactor-contact">${headerContact} | <a href="#">LinkedIn</a> | <a href="#">GitHub</a></p>`;
    const centerM = body.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/);
    const sections = body.split(/\\section\*\{([^{}]*)\}/g);
    for (let i = 1; i < sections.length; i += 2) {
      const title = sections[i]?.trim();
      let content = sections[i + 1] ?? "";
      if (!title) continue;
      html += `<section><h2>${esc(title)}</h2>`;
      content = content.replace(/\\begin\{itemize\}[^}]*([\s\S]*?)\\end\{itemize\}/g, (_m, inner) => {
        const items = inner.split(/\\item\s*/g).filter((x: string) => x.trim());
        if (!items.length) return "";
        return "<ul>" + items.map((it: string) => `<li>${latexInline(it.trim())}</li>`).join("") + "</ul>";
      });
      const blocks = content.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
      for (const b of blocks) {
        if (b.startsWith("<ul")) { html += b; continue; }
        const stripped = b.replace(/\\[a-zA-Z]+\*?(\{[^}]*\})?(\[[^\]]*\])?/g, "").trim();
        if (!stripped) continue;
        if (/^[\s{}\\]+$/.test(b)) continue;
        html += `<p>${latexInline(b)}</p>`;
      }
      if (!blocks.length && content.trim()) {
        const t = latexInline(content.trim());
        if (t && !/^[\s{}\\]+$/.test(t)) html += `<p>${t}</p>`;
      }
      void centerM;
      html += `</section>`;
    }
    if (sections.length <= 1) {
      const paras = body.split(/\n\s*\n/).filter((x) => x.trim());
      for (const p of paras) html += `<p>${latexInline(p.trim())}</p>`;
    }
    return html;
  };
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);



  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);

  const highlightRef = useRef<HTMLPreElement>(null);
  const lines = latex.split("\n");
  const syncScroll = () => {
    if (taRef.current && gutterRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
    if (taRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = taRef.current.scrollTop;
      highlightRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const highlightLatex = (text: string) => {
    const out = text.split("\n").map((line) => {
      if (!line) return " ";
      if (/^\s*%/.test(line)) return `<span class="latex-comment">${escapeHtml(line)}</span>`;
      let html = "";
      let i = 0;
      while (i < line.length) {
        const ch = line[i];
        if (ch === "%") {
          html += `<span class="latex-comment">${escapeHtml(line.slice(i))}</span>`;
          break;
        }
        if (ch === "\\" && i + 1 < line.length && /[a-zA-Z@]/.test(line[i + 1])) {
          let j = i + 1;
          while (j < line.length && /[a-zA-Z@]/.test(line[j])) j++;
          if (line[j] === "*") j++;
          html += `<span class="latex-cmd">${escapeHtml(line.slice(i, j))}</span>`;
          i = j;
          continue;
        }
        if (ch === "\\") {
          // single char command like \\ or \;
          html += `<span class="latex-cmd">${escapeHtml(line.slice(i, i + 2))}</span>`;
          i += 2;
          continue;
        }
        if (ch === "{" || ch === "}") {
          html += `<span class="latex-brace">${escapeHtml(ch)}</span>`;
          i++;
          continue;
        }
        if (ch === "[" || ch === "]") {
          html += `<span class="latex-bracket">${escapeHtml(ch)}</span>`;
          i++;
          continue;
        }
        let j = i;
        while (j < line.length && !["\\", "%", "{", "}", "[", "]"].includes(line[j])) j++;
        html += escapeHtml(line.slice(i, j));
        i = j;
      }
      return html || " ";
    });
    return out.join("\n");
  };
  const highlightedHtml = useMemo(() => highlightLatex(latex), [latex]);

  useEffect(() => { const url = previewPdf ? URL.createObjectURL(previewPdf) : null; setPreviewUrl(url); return () => { if (url) URL.revokeObjectURL(url); }; }, [previewPdf]);
  const handleAutoMatch = () => {
    const kw = matched.join(", ") || "Python, Distributed Systems, APIs";
    const addition = `\n% --- AI Auto-matched for ${companyName} ${jobTitle} ---\n% Keywords: ${kw}\n`;
    const next = latex.includes("AI Auto-matched") ? latex : latex + addition;
    let tailored = next;
    if (!next.includes(kw) && next.includes("Keywords tailored")) {
      tailored = next.replace(/Keywords tailored:.*/, `Keywords tailored: ${kw}`);
    }
    setLatex(tailored);
    setCompiled(false);
    setPreviewPdf(null);
    setCompileError(null);
    toast("Tailored to job description — click Compile to update preview");
  };

  const handleCompile = async () => {
    try {
      if (!isTauri()) throw new Error("LaTeX compilation is available in the Job Hunt OS desktop app.");
      const out = await invoke<{ pdf: number[]; log: string }>("compile_latex", { source: latex });
      setPreviewPdf(new Blob([new Uint8Array(out.pdf)], { type: "application/pdf" }));
      setCompileError(null);
      setCompiled(true);
      toast("Compiled");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCompileError(msg);
      toast(`Compile failed: ${msg}`);
    }
  };
  const handleRestore = () => {
    setLatex(baseLatex);
    setCompiled(false);
    setPreviewPdf(null);
    setCompileError(null);
    toast("Restored base — click Compile to update preview");
  };

  const handleDownloadTex = () => {
    const blob = new Blob([latex], { type: "application/x-tex" });
    saveBlob(blob, `Resume - ${companyName} - ${jobTitle}.tex`);
  };
  const handleDownloadPdf = async () => {
    if (!previewPdf || !compiled) return toast("Compile successfully before downloading a PDF", "warn");
    saveBlob(previewPdf, `Resume - ${companyName} - ${jobTitle}.pdf`);
  };

  const handleSaveDraft = async () => {
    const file = new File([latex], `Resume - ${companyName} - ${jobTitle}.tex`, { type: "application/x-tex" });
    // Save draft to Documents so you can reuse it later — reloads as LaTeX source
    await act.addFiles([file], { folder: "Resumes", company: companyName, jobIds: gate ? [gate.id] : [] });
    toast("Draft saved to Documents");
  };
  const handleSaveToDocs = async () => {
    if (!previewPdf || !compiled) return toast("Compile successfully before saving", "warn");
    const file = new File([latex], `Resume - ${companyName} - ${jobTitle} (Tailored).tex`, { type: "application/x-tex" });
    const pdf = new File([previewPdf], `Resume - ${companyName} - ${jobTitle} (Tailored).pdf`, { type: "application/pdf" });
    await act.addFiles([file, pdf], { folder: "Resumes", company: companyName, jobIds: gate ? [gate.id] : [] });
    toast("Saved editable LaTeX and compiled PDF to Documents");
  };
  const handleUseForApplication = () => {
    toast(`Ready for application to ${companyName}`);
    onClose();
    if (gate?.linkedJobId) navigate("kanban");
  };

  if (!gate) return null;

  return (
    <div className="refactor-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="refactor-modal" role="dialog" aria-modal="true" aria-label="Refactor Resume to Match">
        <header className="refactor-head">
          <span className="refactor-spark"><SparklesIcon /></span>
          <div className="refactor-head-text">
            <h2>Refactor Resume to Match</h2>
            <p>Choose an uploaded resume, convert it to LaTeX, tailor it to the selected job, preview it live, then save and download it.</p>
          </div>
          <button className="icon-btn ghost" aria-label="Close" onClick={onClose}><XMarkIcon /></button>
        </header>

        <div className="refactor-context">
          <div className="refactor-context-card">
            <span className="refactor-context-label"><DocumentIcon />Selected Job</span>
            <div className="refactor-job">
              <Logo name={companyName} size={36} hints={{ website: companyWebsite, applyUrl: applyUrl, logoUrl: companyLogo }} />
              <b>{companyName}</b>
              <span>{jobTitle}</span>
              <span className="refactor-loc"><MagnifyingGlassIcon style={{ transform: "rotate(0deg)" }} />{locationVal}</span>
            </div>
          </div>
          <div className="refactor-context-card">
            <span className="refactor-context-label"><DocumentIcon />Base Resume</span>
            <div className="refactor-base">
              <select aria-label="Base resume" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {resumes.length === 0 && <option value="">No resumes uploaded</option>}
                {resumes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <span className={`refactor-badge ${converted ? "ok" : converting ? "" : ""}`}>{converting ? "Converting…" : converted ? <><CheckCircleIcon />Converted to LaTeX</> : "Not converted"}</span>
            </div>
          </div>
        </div>

        <div className="refactor-body">
          <div className="refactor-pane">
            <div className="refactor-pane-head">
              <div>
                <b><DocumentIcon />LaTeX Editor</b>
                <small>Edit your resume in LaTeX. Use AI to tailor it to the job description.</small>
              </div>
              <div className="refactor-pane-actions">
                <button type="button" className="refactor-btn auto" onClick={handleAutoMatch}><SparklesIcon aria-hidden />Auto-match</button>
                <button type="button" className="refactor-btn primary" onClick={handleCompile}><PlayIcon aria-hidden />Compile</button>
                <button type="button" className="refactor-btn ghost" onClick={handleRestore}><ArrowPathIcon aria-hidden />Restore Base</button>
              </div>
            </div>
            <div className="refactor-editor">
              <div className="refactor-gutter" ref={gutterRef} aria-hidden>{lines.map((_, i) => <span key={i}>{i + 1}</span>)}</div>
              <div className="refactor-code-wrap">
                <pre className="refactor-highlight" ref={highlightRef} aria-hidden dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
                <textarea ref={taRef} value={latex} onChange={(e) => { setLatex(e.target.value); setCompiled(false); setPreviewPdf(null); setCompileError(null); }} onScroll={syncScroll} spellCheck={false} className="refactor-input" />
              </div>
            </div>
            <div className="refactor-insights">
              <div className="refactor-insights-head"><span className="refactor-spark sm"><SparklesIcon /></span><div><b>AI Matching Insights</b><small>Based on the job description, here are key insights and suggestions.</small></div></div>
              <div className="refactor-insights-grid">
                <div>
                  <b className="with-check"><CheckCircleIcon />Matched keywords ({matched.length})</b>
                  <div className="refactor-chips">{matched.map((k) => <span key={k}>{k}</span>)}{matched.length === 0 && <span className="muted">No keywords captured</span>}</div>
                </div>
                <div>
                  <b className="with-bulb">💡 Suggestions ({suggestions.length})</b>
                  <ul>{suggestions.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              </div>
            </div>
          </div>

          <div className="refactor-pane">
            <div className="refactor-pane-head">
              <div>
                <b><DocumentIcon />Preview</b>
                <small>Live preview of your compiled resume.</small>
              </div>
              <div className="refactor-preview-controls">
                <span className="refactor-pager"><button className="icon-btn ghost sm" aria-label="Previous page" disabled>‹</button><span>Page {page} of 1</span><button className="icon-btn ghost sm" aria-label="Next page" disabled>›</button></span>
                <span className="refactor-zoom"><button className="icon-btn ghost sm" onClick={() => setZoom((z) => Math.max(60, z - 10))}>−</button><span>{zoom}%</span><button className="icon-btn ghost sm" onClick={() => setZoom((z) => Math.min(140, z + 10))}>+</button></span>
              </div>
            </div>
            {compileError && <div className="refactor-compile-error" role="alert">{compileError}</div>}
            <div className="refactor-preview">
              <div className="refactor-paper-wrap" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
                <div className="refactor-paper">{previewUrl ? <iframe className="docs-pdf" title="Compiled LaTeX resume" src={previewUrl} /> : <div className="refactor-not-compiled">Compile your LaTeX to see the exact PDF preview.</div>}</div>
              </div>
            </div>
          </div>
        </div>

        <footer className="refactor-foot">
          <button className="btn" onClick={handleDownloadTex}><ArrowDownTrayIcon />Download .tex</button>
          <div>
            <button className="btn" onClick={handleSaveDraft}>Save Draft</button>
            <button className="btn" disabled={!compiled} onClick={handleSaveToDocs}><ArrowDownTrayIcon style={{ transform: "rotate(0deg)" }} />Save to Documents</button>
            <button className="btn" disabled={!compiled} onClick={handleDownloadPdf}><ArrowDownTrayIcon />Download PDF</button>
            <button className="btn primary" onClick={handleUseForApplication}>Use for Application <ChevronDownIcon style={{ transform: "rotate(-90deg)" }} /></button>
          </div>
        </footer>
      </div>
    </div>
  );
}
