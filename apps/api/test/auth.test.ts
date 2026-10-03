import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

describe("owner password", () => {
  it("accepts the right password and rejects others", () => {
    const h = hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong password", h)).toBe(false);
    expect(verifyPassword("", h)).toBe(false);
  });
  it("salts every hash", () => { expect(hashPassword("same")).not.toBe(hashPassword("same")); });
  it("never accepts anything against a missing or malformed stored hash", () => {
    for (const bad of [undefined, "", "scrypt", "scrypt$zz$zz", "plain"]) expect(verifyPassword("anything", bad)).toBe(false);
  });
});
