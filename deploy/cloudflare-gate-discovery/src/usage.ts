export const TAVILY_DAILY_LIMIT = 28;

export async function reserveTavilyCredit(status: KVNamespace) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `tavily-usage:${day}`;
  const used = Number(await status.get(key) || "0");
  if (used >= TAVILY_DAILY_LIMIT) return false;
  await status.put(key, String(used + 1), { expirationTtl: 60 * 60 * 24 * 3 });
  return true;
}
