import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Password hashes look like `scrypt$<salt hex>$<hash hex>`; the plain password is never stored anywhere. */
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 32).toString("hex")}`;
}
/** Always does the full scrypt work (even for a malformed stored hash) so timing does not reveal anything. */
export function verifyPassword(password: string, stored: string | undefined) {
  const [scheme, saltHex, hashHex] = (stored ?? "").split("$");
  const ok = scheme === "scrypt" && !!saltHex && !!hashHex;
  const salt = Buffer.from(ok ? saltHex : "00", "hex"); const want = Buffer.from(ok ? hashHex : "00".repeat(32), "hex");
  const got = scryptSync(password, salt, want.length || 32);
  return ok && got.length === want.length && timingSafeEqual(got, want);
}
