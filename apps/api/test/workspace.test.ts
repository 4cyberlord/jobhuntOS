import { describe, expect, it } from "vitest";
import { incomingWins } from "../src/repository.js";
import { applyRemote, hash, mergeLegacy, newMeta, scan, stable } from "../../desktop/src/lib/workspaceCore.js";
import type { AppData } from "../../desktop/src/lib/types.js";

const LISTS = ["jobs", "companies", "contacts", "events", "tasks", "notifications", "inbox", "activity", "documents", "credentials", "gate"];
const data = (jobs: { id: string; role: string }[] = [], extra: Partial<AppData> = {}) =>
  ({ ...Object.fromEntries(LISTS.map((k) => [k, []])), jobs, folders: [], settings: { profile: {}, appearance: { theme: "light", fontScale: 100 } }, ...extra }) as unknown as AppData;

describe("workspace sync", () => {
  it("last writer wins on the server; ties keep the server copy", () => {
    expect(incomingWins(undefined, 5)).toBe(true);
    expect(incomingWins(5, 6)).toBe(true);
    expect(incomingWins(5, 5)).toBe(false);
    expect(incomingWins(9, 5)).toBe(false);
  });
  it("hashes independent of key order and undefined", () => {
    expect(hash(stable({ a: 1, b: [1, { c: 2 }] }))).toBe(hash(stable({ b: [1, { c: 2, z: undefined }], a: 1 })));
  });
  it("queues new, edited and removed items with the edit time", () => {
    const m = scan(data([{ id: "j1", role: "A" }]), newMeta(), 1000);
    expect(m.items["jobs:j1"]).toMatchObject({ u: 1000, p: true });
    expect(m.items["settings:main"]).toMatchObject({ p: true });
    for (const e of Object.values(m.items)) e.p = false;
    scan(data([{ id: "j1", role: "B" }]), m, 2000);
    expect(m.items["jobs:j1"]).toMatchObject({ u: 2000, p: true });
    m.items["jobs:j1"].p = false;
    scan(data([]), m, 3000);
    expect(m.items["jobs:j1"]).toMatchObject({ u: 3000, p: true, d: true });
  });
  it("applies newer remote items, ignores older ones, honours tombstones and does not echo", () => {
    const m = scan(data([{ id: "j1", role: "mine" }]), newMeta(), 1000);
    m.items["jobs:j1"] = { ...m.items["jobs:j1"], u: 500, p: false };
    const r = applyRemote(data([{ id: "j1", role: "mine" }]), [
      { c: "jobs", id: "j1", u: 400, doc: { id: "j1", role: "stale" } },
      { c: "jobs", id: "j2", u: 600, doc: { id: "j2", role: "new" } },
    ], m);
    expect((r.data.jobs as { role: string }[]).map((j) => j.role)).toEqual(["new", "mine"]);
    expect(m.items["jobs:j2"].p).toBe(false);
    const gone = applyRemote(r.data, [{ c: "jobs", id: "j2", u: 700, deleted: true }], m);
    expect(gone.data.jobs).toHaveLength(1);
    scan(gone.data, m, 9999);
    expect(m.items["jobs:j2"]).toMatchObject({ d: true, u: 700, p: false });
  });
  it("settings (appearance included), folders and the vault record all arrive from the server", () => {
    const m = newMeta();
    const r = applyRemote(data(), [
      { c: "settings", id: "main", u: 50, doc: { profile: { name: "Remote" }, appearance: { theme: "dark", fontScale: 85 } } },
      { c: "folders", id: "main", u: 50, doc: { list: ["A", "B"] } },
      { c: "vault", id: "meta", u: 50, doc: { salt: "s", verifier: { iv: "i", ct: "c" } } },
    ], m);
    expect(r.data.settings.appearance).toEqual({ theme: "dark", fontScale: 85 });
    expect(r.data.folders).toEqual(["A", "B"]);
    expect(r.data.vault).toMatchObject({ salt: "s" });
    scan(r.data, m, 99); // nothing should be queued: these were just received
    expect(Object.values(m.items).some((e) => e.p)).toBe(false);
  });
  it("an old on-device copy only contributes what the server has never seen", () => {
    const m = newMeta();
    const server = applyRemote(data(), [{ c: "jobs", id: "a", u: 10, doc: { id: "a", role: "server" } }, { c: "jobs", id: "gone", u: 10, deleted: true }], m).data;
    const legacy = data([{ id: "a", role: "old" }, { id: "gone", role: "old" }, { id: "b", role: "only-local" }], { vault: { salt: "x", verifier: { iv: "i", ct: "c" } } });
    const merged = mergeLegacy(server, legacy, m);
    expect((merged.jobs as { id: string; role: string }[]).map((j) => `${j.id}:${j.role}`).sort()).toEqual(["a:server", "b:only-local"]);
    expect(merged.vault).toMatchObject({ salt: "x" });
  });
});
