# GATE Cloudflare Discovery Pipeline

This Worker runs three schedules: broad discovery hourly, Company Intelligence every 15 minutes, and the Job Hunt OS bridge import every minute. The import trigger never contacts Railway/Postgres directly.

The source-only Queue consumer stores each complete record in the Railway bridge before Job Hunt OS imports it. It never sends a discovered record directly to MongoDB.

```text
Cloudflare cron → Provider Broker → Queue → source-only processor → D1 journal
→ Job Hunt OS API → MongoDB → Telegram outbox → desktop API

Company Intelligence → direct career/ATS fetch → crawler fallback → federated search fallback
→ Queue → normal GATE 2.x research/import path
```

## Data boundaries

- Queue messages contain URL/title/source metadata only and stay below Cloudflare's 128 KB limit.
- D1 stores hashes, URLs, state, attempts, error summaries, and the MongoDB opportunity ID. It never stores raw posting bodies or credentials.
- MongoDB remains the permanent source of truth for opportunities and official-posting snapshots.
- The worker performs no AI inference. It extracts only literal source facts, retains the original posting text in the GATE record, and marks unknown facts as unknown.
- Telegram remains owned by the Vercel outbox/relay. This Worker never sends Telegram.

## Required secrets

Core pipeline:

```bash
npx wrangler secret put TAVILY_API_KEY --name gate-discovery
npx wrangler secret put RAILWAY_DELIVERY_TOKEN --name gate-discovery
npx wrangler secret put GATE_BRIDGE_CRON_SECRET --name gate-discovery
```

Federated discovery providers are optional and activated only when their server-side key exists:

```bash
npx wrangler secret put EXA_API_KEY --name gate-discovery
npx wrangler secret put FIRECRAWL_API_KEY --name gate-discovery
npx wrangler secret put LANGSEARCH_API_KEY --name gate-discovery
npx wrangler secret put SEARCHAPI_API_KEY --name gate-discovery
npx wrangler secret put SERPLY_API_KEY --name gate-discovery
npx wrangler secret put SEARCH1API_KEY --name gate-discovery
npx wrangler secret put YEP_API_KEY --name gate-discovery
npx wrangler secret put CRAWLERAPI_API_KEY --name gate-discovery
npx wrangler secret put SIMPLECRAWL_API_KEY --name gate-discovery
npx wrangler secret put PILOTERR_API_KEY --name gate-discovery
npx wrangler secret put YAERIS_API_KEY --name gate-discovery
```

The current verified adapters are Tavily, Exa, Firecrawl, LangSearch, SearchAPI.io, Serply, Search1API, SimpleCrawl, and Piloterr. Yep, CrawlerAPI, and Yaeris remain cataloged as `adapter_pending` until their exact production endpoint/result contract is configured and smoke-tested; the broker will never report them as successful merely because a credential exists.

Provider keys are never returned by status endpoints and never sent to the desktop.

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


## Provider broker

The Worker records provider configuration, health, soft-budget usage, failures, and the last successful verification in `GATE_STATUS`.

Public, secret-free status:

```http
GET /providers
```

A provider is reported as one of:

- `not_configured`
- `configured_untested`
- `verified`
- `failing`
- `credential_present_adapter_pending`

Operator-only smoke test:

```http
POST /providers/test
Authorization: Bearer <RUN_TOKEN>
```

The smoke test only marks a provider `verified` after a real authenticated API request succeeds. Search providers run a small Summer 2027 query. Crawler providers fetch `https://example.com/`. Missing credentials are reported as `not_configured`, not as failures.

The provider broker uses daily soft limits and reserve percentages so one service cannot consume all of its free allowance early in the month. One-time signup balances are deliberately conserved and used after recurring pools.

## Free-provider policy

Only providers that offer a usable free tier without mandatory card verification are included in the catalog. The broker keeps recurring monthly/daily pools separate from one-time signup credits. If a provider changes its signup or billing policy, disable its key and mark the catalog entry inactive before routing new work to it.


## GitHub Actions secret sync

The production deployment workflow reads provider keys from GitHub Actions secrets and syncs only the non-empty values into the existing Cloudflare Worker before deployment. Missing optional provider secrets are skipped and do not delete existing Cloudflare secrets.

Required for deployment itself:

```text
CLOUDFLARE_API_TOKEN
```

Optional provider secrets:

```text
TAVILY_API_KEY
EXA_API_KEY
FIRECRAWL_API_KEY
YEP_API_KEY
LANGSEARCH_API_KEY
SEARCHAPI_API_KEY
SERPLY_API_KEY
SEARCH1API_KEY
CRAWLERAPI_API_KEY
SIMPLECRAWL_API_KEY
PILOTERR_API_KEY
YAERIS_API_KEY
```

This keeps provider credentials out of source control and gives the deployment pipeline one controlled place to install or rotate integrations.


## Durable discovery staging inbox

Discovery is intentionally decoupled from research and delivery. Search providers write lightweight candidate metadata into D1 first; the Worker drains that inbox into the existing Cloudflare Queue at a controlled rate.

Flow:

```text
Tavily / Exa / Firecrawl / other search providers
                    |
                    v
          D1 discovery_candidates
          + discovery_sources
                    |
        claim with 5-minute lease
                    |
                    v
          Cloudflare CANDIDATES Queue
                    |
                    v
      official posting verification/research
                    |
                    v
          Railway delivery gateway
                    |
                    v
       Job Hunt OS import -> MongoDB
```

The staging inbox uses the canonical URL SHA-256 as its durable identity. Repeated sightings from different providers update one candidate row while `discovery_sources` preserves provider provenance and seen counts. Before a staged row is queued, the Worker checks `gate_journal`; anything already known is marked `already_known` instead of being handed off again.

Candidate states are `pending`, `claimed`, `queued`, `retrying`, `already_known`, `completed`, and `rejected`. Claims have a five-minute lease so an interrupted drain can be recovered without permanently stranding work.

The minute scheduler now performs three independent recovery/flow-control jobs: bridge import, GATE retry recovery, and draining up to five staged candidates into the research queue. The protected `POST /internal/candidates` endpoint accepts either one candidate or a batch and stages them rather than bypassing the inbox. `GET /staging/status` exposes non-secret queue counts and provider provenance totals; `POST /internal/staging/drain` is an operator-only manual drain.

Migration `0004_discovery_staging.sql` creates the staging tables and indexes. The Cloudflare deployment workflow applies pending D1 migrations before deploying the Worker.
