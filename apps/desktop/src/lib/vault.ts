// Credential vault crypto. Passwords are sealed with AES-256-GCM using a key derived (PBKDF2-SHA256, 310k rounds)
// from a master password that is never stored. Only a salt and a verifier ciphertext are persisted.
import { useSyncExternalStore } from "react";
import type { Strength } from "./types";

const META = "jhos.vault.meta";
const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s) as Uint8Array<ArrayBuffer>;
const dec = new TextDecoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

type Meta = { salt: string; verifier: { iv: string; ct: string } };
let key: CryptoKey | null = null;
let fpKey: CryptoKey | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const readMeta = (): Meta | null => {
  try {
    return JSON.parse(localStorage.getItem(META) ?? "null");
  } catch {
    return null;
  }
};

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey("raw", bytes(password), "PBKDF2", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const hmacBase = await crypto.subtle.importKey("raw", bytes(`fp:${password}`), "PBKDF2", false, ["deriveKey"]);
  const hmac = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 10_000, hash: "SHA-256" }, hmacBase, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return { aes, hmac };
}

async function seal(k: CryptoKey, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, bytes(text));
  return { iv: b64(iv), ct: b64(ct) };
}
async function open(k: CryptoKey, s: { iv: string; ct: string }) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) }, k, unb64(s.ct));
  return dec.decode(pt);
}

export const vaultExists = () => !!readMeta();
export const vaultUnlocked = () => key !== null;

export async function createVault(master: string) {
  if (master.length < 8) throw new Error("Use at least 8 characters for the master password.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { aes, hmac } = await derive(master, salt);
  localStorage.setItem(META, JSON.stringify({ salt: b64(salt), verifier: await seal(aes, "jhos-vault-ok") } satisfies Meta));
  key = aes;
  fpKey = hmac;
  emit();
}
export async function unlockVault(master: string): Promise<boolean> {
  const meta = readMeta();
  if (!meta) return false;
  const { aes, hmac } = await derive(master, unb64(meta.salt));
  try {
    if ((await open(aes, meta.verifier)) !== "jhos-vault-ok") return false;
  } catch {
    return false;
  }
  key = aes;
  fpKey = hmac;
  emit();
  return true;
}
export function lockVault() {
  key = null;
  fpKey = null;
  emit();
}
export async function sealPassword(pw: string) {
  if (!key) throw new Error("Vault is locked");
  return seal(key, pw);
}
export async function revealPassword(s: { iv: string; ct: string }) {
  if (!key) throw new Error("Vault is locked");
  return open(key, s);
}
/** Non reversible fingerprint used only to detect password reuse across portals. */
export async function fingerprint(pw: string) {
  if (!fpKey) throw new Error("Vault is locked");
  return b64(await crypto.subtle.sign("HMAC", fpKey, bytes(pw))).slice(0, 22);
}

export function scorePassword(pw: string): Strength {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s >= 5 ? "strong" : s >= 3 ? "medium" : "weak";
}
export function generatePassword(len = 20) {
  const set = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_";
  const out = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(out, (n) => set[n % set.length]).join("");
}

export function useVaultState() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (key ? "unlocked" : readMeta() ? "locked" : "none"),
  ) as "none" | "locked" | "unlocked";
}
