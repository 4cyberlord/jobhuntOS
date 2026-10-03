import { invoke } from "@tauri-apps/api/core";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Hand a file to the OS default app (Word for .docx, Preview for .pdf …). Falls back to a browser download. */
export async function openWithSystem(blob: Blob, fileName: string): Promise<"opened" | "downloaded"> {
  if (isTauri()) {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    await invoke("open_document", { fileName, bytes });
    return "opened";
  }
  saveBlob(blob, fileName);
  return "downloaded";
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function openExternal(url: string) {
  const href = /^https?:\/\//.test(url) ? url : `https://${url}`;
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(href);
  } else {
    window.open(href, "_blank", "noopener");
  }
}

export async function copyToClipboard(text: string, clearAfterMs?: number) {
  await navigator.clipboard.writeText(text);
  if (clearAfterMs) {
    setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText("");
      } catch {
        /* clipboard read may be denied; the secret is still short lived */
      }
    }, clearAfterMs);
  }
}
