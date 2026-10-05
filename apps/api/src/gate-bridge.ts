import { parseGatePayload, type GateEnvelope } from "@job-hunt-os/contracts";
import { ingestGate, type GateIngestResult } from "./repository.js";

type BridgeRecord = { id: string; fingerprint?: string; envelope?: unknown; record?: unknown; payload?: unknown };
type Claimed = { id: string; lease_token?: string; fingerprint?: string; envelope?: unknown; record?: unknown; payload?: unknown };
type Fetcher = typeof fetch;

const MAX_PER_RUN = 20;
const text = async (response: Response) => (await response.text()).slice(0, 500);
const endpoint = (base: string, path: string) => `${base.replace(/\/+$/, "")}${path}`;
const recordPayload = (record: BridgeRecord | Claimed) => record.envelope ?? record.record ?? record.payload;

/**
 * The Railway bridge is a durable, HTTP-only inbox. This API owns MongoDB
 * persistence; it never opens a Railway/Postgres connection.
 */
export async function importGateBridge(opts: {
  baseUrl?: string;
  token?: string;
  fetcher?: Fetcher;
  ingest?: (item: GateEnvelope) => Promise<GateIngestResult>;
} = {}) {
  const baseUrl = opts.baseUrl ?? process.env.GATE_BRIDGE_URL;
  const token = opts.token ?? process.env.GATE_INGEST_TOKEN;
  if (!baseUrl || !token) throw new Error("GATE_BRIDGE_URL and GATE_INGEST_TOKEN are required");
  const call = opts.fetcher ?? fetch;
  const ingest = opts.ingest ?? ingestGate;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const list = await call(endpoint(baseUrl, `/v1/opportunities?status=ready&limit=${MAX_PER_RUN}`), { headers });
  if (!list.ok) throw new Error(`bridge_list_${list.status}:${await text(list)}`);
  const listed = await list.json() as { items?: BridgeRecord[] } | BridgeRecord[];
  const rows = Array.isArray(listed) ? listed : listed.items ?? [];
  const result = { listed: rows.length, claimed: 0, stored: 0, duplicates: 0, invalid: 0, acknowledged: 0 };

  for (const row of rows) {
    if (!row?.id) { result.invalid++; continue; }
    const claim = await call(endpoint(baseUrl, `/v1/opportunities/${encodeURIComponent(row.id)}/claim`), { method: "POST", headers, body: JSON.stringify({ lease_seconds: 120 }) });
    // Another importer owns it, or the bridge has moved it; neither is a run failure.
    if (claim.status === 404 || claim.status === 409) continue;
    if (!claim.ok) throw new Error(`bridge_claim_${claim.status}:${await text(claim)}`);
    const claimed = await claim.json() as Claimed;
    result.claimed++;
    const parsed = parseGatePayload(recordPayload(claimed));
    if (!parsed.ok || parsed.items.length !== 1) {
      result.invalid++;
      // Invalid data remains claimed/failed at the bridge for correction. It is deliberately not ACKed.
      continue;
    }
    // This is the transaction boundary: an ACK is impossible until MongoDB persistence has returned.
    const stored = await ingest(parsed.items[0]);
    if (stored.discarded || !stored.gate_opportunity_id) throw new Error("bridge_ingest_did_not_persist");
    result.stored++;
    if (stored.duplicate) result.duplicates++;
    const ack = await call(endpoint(baseUrl, `/v1/opportunities/${encodeURIComponent(claimed.id || row.id)}/ack`), {
      method: "POST", headers,
      body: JSON.stringify({ gate_opportunity_id: stored.gate_opportunity_id, fingerprint: stored.fingerprint ?? claimed.fingerprint ?? row.fingerprint, lease_token: claimed.lease_token }),
    });
    if (!ack.ok) throw new Error(`bridge_ack_${ack.status}:${await text(ack)}`);
    result.acknowledged++;
  }
  return result;
}
