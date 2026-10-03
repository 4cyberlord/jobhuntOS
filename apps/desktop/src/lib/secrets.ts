import { useMemo } from "react";
import type { Credential } from "./types";
import { useData } from "./store";
import { useRequireVault, useUI } from "./ui";
import { vaultUnlocked, revealPassword } from "./vault";
import { copyToClipboard } from "./tauri";

export const CLIPBOARD_CLEAR_SECONDS = 45;

/** Shared credential operations: every secret access is gated on the vault being unlocked and is logged. */
export function useSecrets() {
  const requireVault = useRequireVault();
  const { act } = useData();
  const { toast } = useUI();
  return useMemo(() => {
    const ensure = async () => vaultUnlocked() || (await requireVault());
    return {
      ensure,
      /** Returns the plaintext password, or null if the vault stayed locked / no password is stored. */
      async reveal(c: Credential): Promise<string | null> {
        if (!c.secret) {
          toast("No password saved for this portal yet.", "warn");
          return null;
        }
        if (!(await ensure())) return null;
        try {
          const pw = await revealPassword(c.secret);
          act.logCredential(c.id, "Viewed password");
          return pw;
        } catch {
          toast("Could not decrypt this password.", "warn");
          return null;
        }
      },
      async copyPassword(c: Credential) {
        if (!c.secret) return toast("No password saved for this portal yet.", "warn");
        if (!(await ensure())) return;
        try {
          await copyToClipboard(await revealPassword(c.secret), CLIPBOARD_CLEAR_SECONDS * 1000);
          act.logCredential(c.id, "Copied password");
          toast(`Password copied. Clipboard clears in ${CLIPBOARD_CLEAR_SECONDS}s.`);
        } catch {
          toast("Could not copy the password.", "warn");
        }
      },
      async copyUsername(c: Credential) {
        await copyToClipboard(c.username);
        act.logCredential(c.id, "Copied username");
        toast("Username copied.");
      },
    };
  }, [requireVault, act, toast]);
}
