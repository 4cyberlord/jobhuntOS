// Pull the GATE messages out of the private Telegram channel through the bot (the Bot API has no history call).
// For each message id the bot forwards the post into the same channel silently, reads the text from the response,
// and deletes the copy straight away. Output is the relay-shaped JSON that import-gate.ts --json understands.
//   npx tsx apps/api/scripts/fetch-telegram.ts --chat -100123... --out apps/api/data/telegram-backfill.json
// Token: TELEGRAM_BOT_TOKEN (or Telegram_Key) from the environment, apps/api/.env, or the repo-root .env.local.
import "dotenv/config";
import axios, { AxiosError } from "axios";
import { parse } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseTelegramMessage, flattenTelegramText } from "@job-hunt-os/contracts";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fileEnv = ["../../../.env.local"].flatMap((p) => { const f = new URL(p, import.meta.url); return existsSync(f) ? [parse(readFileSync(f))] : []; });
const lookup = (...names: string[]) => names.map((n) => process.env[n] ?? fileEnv.map((e) => e[n]).find(Boolean)).find(Boolean);

const token = lookup("TELEGRAM_BOT_TOKEN", "Telegram_Key");
const chat = arg("chat") ?? lookup("TELEGRAM_CHAT_ID");
const out = arg("out") ?? "apps/api/data/telegram-backfill.json";
const maxId = Number(arg("max") ?? 120), stopAfterMisses = 15;
if (!token || !chat) { console.error("Need a bot token (TELEGRAM_BOT_TOKEN / Telegram_Key) and --chat <id>."); process.exit(2); }
const api = axios.create({ baseURL: `https://api.telegram.org/bot${token}`, timeout: 20_000, validateStatus: () => true });

async function call(method: string, body: object): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await api.post(`/${method}`, body);
    if (r.status === 429) { const wait = (r.data?.parameters?.retry_after ?? 5) + 1; console.log(`  rate limited, waiting ${wait}s`); await sleep(wait * 1000); continue; }
    return r.data;
  }
  throw new Error(`${method}: gave up after repeated rate limits`);
}

async function main() {
  const me = await call("getMe", {});
  if (!me.ok) { console.error(`Bot token rejected: ${me.description}`); process.exit(1); }
  console.log(`Bot @${me.result.username} -> chat ${chat}`);
  const records: Record<string, unknown>[] = []; let misses = 0, nonGate = 0;
  for (let id = 1; id <= maxId && misses < stopAfterMisses; id++) {
    const f = await call("forwardMessage", { chat_id: chat, from_chat_id: chat, message_id: id, disable_notification: true });
    if (!f.ok) { if (/not found|can't be forwarded|to forward not found/i.test(f.description ?? "")) misses++; else console.log(`  #${id}: ${f.description}`); await sleep(400); continue; }
    misses = 0;
    const copy = f.result;
    const parsed = parseTelegramMessage(flattenTelegramText(copy.text ?? copy.caption ?? ""));
    await call("deleteMessage", { chat_id: chat, message_id: copy.message_id });
    if (!parsed) { nonGate++; continue; }
    records.push({ ...parsed, received_at: new Date((copy.forward_date ?? copy.date) * 1000).toISOString(), telegram_message_id: id });
    console.log(`  #${id}: ${parsed.company?.name} — ${parsed.opportunity?.title}`);
    await sleep(3200); // stay under Telegram's ~20 messages/minute channel limit
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(records, null, 2));
  console.log(`Saved ${records.length} GATE message(s) to ${out} (${nonGate} other message(s) skipped).`);
}
main().catch((e) => { console.error(e instanceof AxiosError ? e.message : e); process.exit(1); });
