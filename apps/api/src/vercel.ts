// Vercel serverless entry. Requests are replayed into Fastify with inject(), which avoids sockets and any
// double-reading of a request body that Vercel has already parsed.
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./app.js";

const ready = buildApp().then(async (app) => { await app.ready(); return app; });

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const app = await ready;
  const raw = req.body;
  const payload = raw === undefined || raw === null ? undefined : typeof raw === "string" || Buffer.isBuffer(raw) ? raw : JSON.stringify(raw);
  const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
  delete headers["content-length"]; delete headers["transfer-encoding"];
  if (payload !== undefined) headers["content-length"] = String(Buffer.byteLength(payload));
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const r = await app.inject({ method: req.method as "GET", url: req.url ?? "/", headers: headers as never, payload, remoteAddress: forwarded || undefined });
  res.statusCode = r.statusCode;
  for (const [k, v] of Object.entries(r.headers)) if (v !== undefined) res.setHeader(k, v as string | string[]);
  res.end(r.rawPayload);
}
