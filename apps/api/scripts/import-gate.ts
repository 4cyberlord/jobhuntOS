// Backfill the GATE inbox from the Telegram channel (Telegram Desktop "Export chat history" → JSON) and/or relay-shaped JSON.
//   npx tsx apps/api/scripts/import-gate.ts --telegram ~/Downloads/Telegram\ Desktop/ChatExport_*/result.json [--dry-run]
//   npx tsx apps/api/scripts/import-gate.ts --json backfill.json
// Reads GATE_API_URL (default http://127.0.0.1:8787) and AGENT_API_KEY from the environment / apps/api/.env.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import axios, { AxiosError } from "axios";
import { readFileSync } from "node:fs";
config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
import { flattenTelegramText, legacyToEnvelope, parseTelegramMessage, type LegacyGate } from "@job-hunt-os/contracts";

type Item = LegacyGate & { received_at?: string };
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const load = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Telegram exports are `{messages}` for one chat or `{chats:{list:[{messages}]}}` for an account dump. */
function messagesOf(doc: any): any[] {
  if (Array.isArray(doc?.messages)) return doc.messages;
  if (Array.isArray(doc?.chats?.list)) return doc.chats.list.flatMap((c: any) => c.messages ?? []);
  return [];
}

function fromTelegram(path: string): Item[] {
  const out: Item[] = [];
  for (const m of messagesOf(load(path))) {
    if (m?.type !== "message") continue;
    const parsed = parseTelegramMessage(flattenTelegramText(m.text));
    if (!parsed) continue;
    const unix = Number(m.date_unixtime);
    out.push({ ...parsed, received_at: Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000).toISOString() : undefined });
  }
  return out;
}

function fromJson(path: string): Item[] {
  const doc = load(path) as any;
  return Array.isArray(doc) ? doc : Array.isArray(doc?.items) ? doc.items : [doc];
}

async function post(client: ReturnType<typeof axios.create>, batch: Item[]) {
  for (let attempt = 1; ; attempt++) {
    try { return (await client.post("/v1/agent/gate/legacy", { items: batch, notify: false })).data; } catch (e) {
      const status = (e as AxiosError).response?.status;
      if (attempt >= 4 || (status && status < 500 && status !== 429)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function main() {
  const tg = arg("telegram"), js = arg("json");
  if (!tg && !js) { console.error("Usage: --telegram <result.json> and/or --json <file.json> [--dry-run]"); process.exit(2); }
  const items = [...(tg ? fromTelegram(tg) : []), ...(js ? fromJson(js) : [])];
  const seen = new Set<string>(); const unique: Item[] = []; const problems: string[] = [];
  for (const it of items) {
    const n = legacyToEnvelope(it);
    if (!n.ok) { problems.push(n.error); continue; }
    if (seen.has(n.envelope.opportunity.external_id)) continue;
    seen.add(n.envelope.opportunity.external_id); unique.push(it);
  }
  console.log(`Parsed ${items.length} record(s): ${unique.length} unique and valid, ${items.length - unique.length - problems.length} duplicate(s) in the source, ${problems.length} invalid.`);
  for (const p of problems) console.log(`  invalid: ${p}`);
  if (flag("dry-run")) { for (const it of unique) console.log(`  ${String(it.match?.score).replace("%", "").padStart(3)}%  ${it.company?.name} — ${it.opportunity?.title}`); return; }

  const key = process.env.AGENT_API_KEY;
  if (!key) { console.error("AGENT_API_KEY is not set."); process.exit(2); }
  const client = axios.create({ baseURL: (process.env.GATE_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, ""), headers: { Authorization: `Bearer ${key}` }, timeout: 30_000 });
  let created = 0, duplicates = 0, invalid = 0;
  for (let i = 0; i < unique.length; i += 50) {
    const r = await post(client, unique.slice(i, i + 50));
    created += r.summary.created; duplicates += r.summary.duplicates; invalid += r.summary.invalid;
    console.log(`  batch ${i / 50 + 1}: created=${r.summary.created} duplicates=${r.summary.duplicates} invalid=${r.summary.invalid}`);
  }
  console.log(`Done. created=${created} already-present=${duplicates} invalid=${invalid}`);
}

main().catch((e) => { console.error(e instanceof AxiosError ? `${e.code ?? ""} ${e.response?.status ?? ""} ${JSON.stringify(e.response?.data ?? e.message)}` : e); process.exit(1); });
