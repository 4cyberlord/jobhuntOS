# GATE Cloudflare Discovery Pipeline

This Worker has two schedules: discovery runs every 30 minutes, while a separate one-minute trigger asks the Job Hunt OS API to import ready records from the Railway bridge. The trigger never contacts Railway/Postgres itself.

The source-only Queue consumer stores each complete record in the Railway bridge before Job Hunt OS imports it. It never sends a discovered record directly to MongoDB.

```text
Cloudflare cron → Tavily → Queue → source-only processor → D1 journal
→ Job Hunt OS API → MongoDB → Telegram outbox → desktop API
```

## Data boundaries

- Queue messages contain URL/title/source metadata only and stay below Cloudflare's 128 KB limit.
- D1 stores hashes, URLs, state, attempts, error summaries, and the MongoDB opportunity ID. It never stores raw posting bodies or credentials.
- MongoDB remains the permanent source of truth for opportunities and official-posting snapshots.
- The worker performs no AI inference. It extracts only literal source facts, retains the original posting text in the GATE record, and marks unknown facts as unknown.
- Telegram remains owned by the Vercel outbox/relay. This Worker never sends Telegram.

## Required secrets

```bash
npx wrangler secret put TAVILY_API_KEY --name gate-discovery
npx wrangler secret put RAILWAY_DELIVERY_TOKEN --name gate-discovery
npx wrangler secret put GATE_BRIDGE_CRON_SECRET --name gate-discovery
```

`RUN_TOKEN` is an optional operator-only secret for `POST /internal/run`, useful for controlled acceptance testing. Cron runs do not use it.

`GATE_BRIDGE_CRON_SECRET` must exactly match the server-only API environment value. `GATE_INGEST_TOKEN` remains only on Job Hunt OS and the Railway bridge; Cloudflare receives only the separate delivery token used to persist a discovery record.

## Manual candidate ingestion

Trusted discovery tools may enqueue one official ATS URL without receiving the Job Hunt OS API credential:

```http
POST https://gate-discovery.4cyberlord.workers.dev/internal/candidates
Authorization: Bearer <RUN_TOKEN>
Content-Type: application/json

{ "url": "https://job-boards.greenhouse.io/company/jobs/123", "title": "Optional source title" }
```

The route accepts only HTTPS official careers/ATS URLs, queues URL metadata only, and returns `202`. It does not accept full GATE records, raw posting text, or a client-supplied score; the Queue consumer obtains the factual posting snapshot itself.

## Operations

```bash
npm run typecheck
npx wrangler d1 execute gate-discovery-journal --remote --file=migrations/0001_gate_journal.sql
npx wrangler deploy
curl https://gate-discovery.4cyberlord.workers.dev/health
```

`/status` reports only the latest discovery-run counts. Inspect the compact journal state with:

```bash
npx wrangler d1 execute gate-discovery-journal --remote --command \
  "SELECT state, COUNT(*) FROM gate_journal GROUP BY state"
```

Railway is rollback-only until the agreed observation period passes; it is not part of this Worker’s delivery path.
