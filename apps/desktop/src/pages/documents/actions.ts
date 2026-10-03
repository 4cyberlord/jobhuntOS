import { useMemo } from "react";
import { useData } from "../../lib/store";
import { useUI } from "../../lib/ui";
import { copyToClipboard, isTauri, openWithSystem, saveBlob } from "../../lib/tauri";
import type { DocItem } from "../../lib/types";
import { fmtBytes, fmtDate } from "../../lib/format";
import { docFile } from "./content";

export function useDocActions() {
  const { data, act } = useData();
  const { toast } = useUI();
  const profile = data.settings.profile;
  return useMemo(() => {
    const open = async (doc: DocItem, versionId?: string) => {
      try {
        const f = await docFile(doc, profile, versionId);
        const r = await openWithSystem(f.blob, f.fileName);
        toast(r === "opened" ? `Opening ${f.fileName} in your default app…` : `Downloaded ${f.fileName} — open it in ${/\.docx?$/.test(f.fileName) ? "Word" : "your app"}`);
      } catch (e) {
        toast(`Couldn't open the file: ${e instanceof Error ? e.message : "unknown error"}`, "warn");
      }
    };
    const download = async (doc: DocItem, versionId?: string) => {
      try {
        const f = await docFile(doc, profile, versionId);
        saveBlob(f.blob, f.fileName);
        toast(`Downloaded ${f.fileName}`);
      } catch {
        toast("Couldn't read the file", "warn");
      }
    };
    const share = async (doc: DocItem) => {
      try {
        if (!isTauri() && typeof navigator.share === "function") {
          const f = await docFile(doc, profile);
          const file = new File([f.blob], f.fileName, { type: f.blob.type });
          if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: doc.name }); return; }
          await navigator.share({ title: doc.name, text: `${doc.name} (${fmtBytes(doc.size)})` });
          return;
        }
        await copyToClipboard(`${doc.name}.${doc.ext.toLowerCase()} · ${fmtBytes(doc.size)} · modified ${fmtDate(doc.modifiedAt)}`);
        toast("Document details copied to clipboard");
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") toast("Sharing isn't available here", "warn");
      }
    };
    return {
      open, download, share,
      trash: (ids: string[]) => { ids.forEach((id) => act.trashDocument(id, true)); toast(ids.length > 1 ? `${ids.length} documents moved to Trash` : "Moved to Trash"); },
      restore: (ids: string[]) => { ids.forEach((id) => act.trashDocument(id, false)); toast("Restored"); },
      remove: async (ids: string[]) => {
        if (!window.confirm(ids.length > 1 ? `Permanently delete ${ids.length} documents? This can't be undone.` : "Permanently delete this document? This can't be undone.")) return false;
        for (const id of ids) await act.deleteDocument(id);
        toast("Deleted permanently");
        return true;
      },
      duplicate: (id: string) => { act.duplicateDocument(id); toast("Duplicated"); },
      move: (ids: string[], folder: string) => { ids.forEach((id) => act.updateDocument(id, { folder })); toast(`Moved to ${folder}`); },
    };
  }, [act, toast, profile]);
}
