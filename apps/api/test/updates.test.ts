import { describe, expect, it } from "vitest";
import { compareVersions, updateFor, type LatestJson } from "../src/updates.js";

const latest: LatestJson = { version: "1.2.0", notes: "Fixes", platforms: {
  "darwin-aarch64": { signature: "SIG-A", url: "https://github.com/o/r/releases/download/v1.2.0/Job.Hunt.OS_universal.app.tar.gz" },
  "darwin-x86_64": { signature: "SIG-X", url: "https://github.com/o/r/releases/download/v1.2.0/Job.Hunt.OS_universal.app.tar.gz" } } };
const assets = [{ id: 7, name: "latest.json" }, { id: 42, name: "Job.Hunt.OS_universal.app.tar.gz" }];
const url = (id: number) => `https://api.example/v1/desktop/update/asset/${id}`;

describe("updates for a private repo", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("v1.2.0", "1.2")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("2.0.0-beta.1", "1.9.9")).toBe(1);
  });
  it("offers a newer version with a proxied download url and the signature", () => {
    const r = updateFor({ latest, assets, current: "1.0.0", target: "darwin", arch: "aarch64", assetUrl: url });
    expect(r).toMatchObject({ version: "1.2.0", url: "https://api.example/v1/desktop/update/asset/42", signature: "SIG-A", notes: "Fixes" });
    expect(updateFor({ latest, assets, current: "1.0.0", target: "darwin", arch: "x86_64", assetUrl: url })?.signature).toBe("SIG-X");
  });
  it("says nothing when already current or newer, or when the platform or file is missing", () => {
    expect(updateFor({ latest, assets, current: "1.2.0", target: "darwin", arch: "aarch64", assetUrl: url })).toBeNull();
    expect(updateFor({ latest, assets, current: "1.3.0", target: "darwin", arch: "aarch64", assetUrl: url })).toBeNull();
    expect(updateFor({ latest, assets, current: "1.0.0", target: "linux", arch: "x86_64", assetUrl: url })).toBeNull();
    expect(updateFor({ latest, assets: [], current: "1.0.0", target: "darwin", arch: "aarch64", assetUrl: url })).toBeNull();
  });
});
