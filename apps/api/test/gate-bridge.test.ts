import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { importGateBridge } from "../src/gate-bridge.js";
import { buildApp } from "../src/app.js";

const envelope = JSON.parse(readFileSync(new URL("./fixtures/gate-v2-complete.json", import.meta.url), "utf8"));
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Railway GATE bridge importer", () => {
  it("keeps the internal importer unavailable without its dedicated scheduler secret", async () => {
    const before = process.env.GATE_BRIDGE_CRON_SECRET;
    process.env.GATE_BRIDGE_CRON_SECRET = "bridge-cron-test";
    const app = await buildApp(); await app.ready();
    const response = await app.inject({ method: "POST", url: "/v1/internal/gate-bridge/import" });
    await app.close();
    if (before === undefined) delete process.env.GATE_BRIDGE_CRON_SECRET; else process.env.GATE_BRIDGE_CRON_SECRET = before;
    expect(response.statusCode).toBe(401);
  });

  it("claims, persists, and ACKs a complete record in that order", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("status=ready")) return ok({ items: [{ id: "queue-1", fingerprint: "sha256:bridge" }] });
      if (url.endsWith("/claim")) return ok({ id: "queue-1", lease_token: "lease-1", envelope });
      if (url.endsWith("/ack")) return ok({ ok: true, status: "imported" });
      throw new Error("unexpected bridge route");
    };
    const stored = await importGateBridge({ baseUrl: "https://bridge.example", token: "token", fetcher: fetcher as typeof fetch, ingest: async () => {
      calls.push("MONGO"); return { gate_opportunity_id: "mongo-1", gate_status: "discovered", duplicate: false, created: true, fingerprint: "sha256:bridge" };
    } });
    expect(stored).toMatchObject({ listed: 1, claimed: 1, stored: 1, acknowledged: 1 });
    expect(calls).toEqual(["GET https://bridge.example/v1/opportunities?status=ready&limit=20", "POST https://bridge.example/v1/opportunities/queue-1/claim", "MONGO", "POST https://bridge.example/v1/opportunities/queue-1/ack"]);
  });

  it("does not ACK an invalid bridge record", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("status=ready")) return ok({ items: [{ id: "bad" }] });
      return ok({ id: "bad", lease_token: "lease", envelope: { invalid: true } });
    };
    const result = await importGateBridge({ baseUrl: "https://bridge.example", token: "token", fetcher: fetcher as typeof fetch, ingest: async () => { throw new Error("must not persist"); } });
    expect(result).toMatchObject({ claimed: 1, invalid: 1, acknowledged: 0 });
    expect(calls.some((x) => x.includes("/ack"))).toBe(false);
  });

  it("fails before persistence when the bridge cannot list ready work", async () => {
    await expect(importGateBridge({ baseUrl: "https://bridge.example", token: "token", fetcher: async () => new Response("down", { status: 503 }) as Response })).rejects.toThrow("bridge_list_503");
  });
});
