# GATE: Gather, Assess, Track, Execute

GATE is the contract between the discovery agent ("GATE Scout") and Job Hunt OS. The agent returns structured opportunities; Job Hunt OS stores them in the **GATE Inbox**; only after the user approves one does it become a Job in the pipeline.

Source of truth for the schema: `packages/contracts/src/gate.ts` (zod). API: `apps/api/src/server.ts`, `apps/api/src/gate-ingest.ts`, `apps/api/src/repository.ts`.

## 1. Lifecycle

```
 GATHER                ASSESS               TRACK                 EXECUTE
 agent searches   ->   agent scores    ->   user reviews inbox -> user prepares/applies
 sources hourly        match+eligibility    Approve -> Job        (manual; app never submits)
       |                    |                    |
       +---- POST /v1/agent/gate/opportunities ---+--> gate_opportunities (gate_status=discovered)
                                                      desktop sync -> GATE Inbox -> Approve/Dismiss/Save for later
                                                      desktop POST /v1/desktop/gate/:id/status
```

### gate_status vs application stage

These are deliberately separate state machines.

| Concept | Values | Owner | Meaning |
|---|---|---|---|
| `gate_status` | `discovered`, `reviewing`, `approved`, `saved_for_later`, `dismissed`, `expired`, `duplicate` | Inbox (user decides) | Whether the user has accepted the *discovery* |
| Application stage | `Saved`, `Preparing`, `Applied`, `Interviewing`, `Offer` (plus terminal states in the Kanban) | Job pipeline | Progress of an actual application |

A Job only exists once `gate_status = approved`; it starts at stage `saved`. Stage changes never alter `gate_status` and vice versa. User decisions (`approved`, `dismissed`, `saved_for_later`, `expired`) are never overwritten by the agent.

## 2. Field reference

Types: `iso` = ISO-8601 datetime with offset (e.g. `2026-10-02T17:30:00-05:00`); `url` = absolute URL. "Req" = required (no default).

### Envelope (top level)
| Field | Type | Default | Meaning |
|---|---|---|---|
| `event` | literal `gate.opportunity.discovered` | same | Event type (batch: `gate.opportunity.batch`) |
| `schema_version` | string | `"1.0"` | Contract version |
| `search`, `opportunity`, `company`, `match`, `source`, `metadata` | objects | Req | See below |
| `eligibility` | object | all defaults | See below |
| `compensation` | object | optional | See below |
| `agent` | object | defaults | See below |

### search
| Field | Type | Default | Meaning |
|---|---|---|---|
| `watch_id` | string(100) | Req | Which saved watch produced this |
| `season` | string(60) | - | Target season, e.g. "Summer 2027" |
| `country` | string(60) | `US` | Search country |
| `searched_at` | iso | Req | When the search ran |

### opportunity
| Field | Type | Default | Meaning |
|---|---|---|---|
| `external_id` | string(3-200) | Req | Stable id at the source |
| `title` | string(1-200) | Req | Posting title |
| `track` | enum `software_engineering, frontend, backend, full_stack, mobile, cloud, platform, infrastructure, developer_tools, devops, security, ai, machine_learning, data_engineering, analytics_engineering, geospatial, other` | `other` | Discipline |
| `employment_type` | enum `internship, co_op, new_grad, full_time, part_time, contract` | `internship` | |
| `season` | string(60) | - | Season of the role |
| `location` | `{city?, state?, country}` | `{country:"US"}` | city/state nullable; country default US |
| `work_arrangement` | enum `remote, hybrid, onsite, unknown` | `unknown` | |
| `dates` | `{start?, end?: iso, duration_weeks?: int 1-104}` | `{}` | Role dates, nullable |
| `application.status` | enum `open, closed, reposted, unknown` | `open` | Posting state |
| `application.deadline` | iso, nullable | - | Deadline (becomes a Calendar event on Approve) |
| `application.apply_url` | url | Req | Where the user applies |
| `description_summary` | string(5000) | `""` | Short summary |

### company
| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string(1-200) | Req | Company name (upsert key on Approve) |
| `website`, `careers_url`, `logo_url` | url, nullable | - | |
| `industry` | string(120) | - | |
| `headquarters` | string(160) | - | |

### match
| Field | Type | Default | Meaning |
|---|---|---|---|
| `score` | number 0-100 | Req | Fit score |
| `level` | enum `strong, moderate, weak` | - | Derived by `levelOf`: >=85 strong, >=65 moderate, else weak |
| `matching_skills` | string(100)[] max 50 | `[]` | |
| `matching_experience` | string(300)[] max 50 | `[]` | |
| `matching_education` | string(300)[] max 20 | `[]` | |
| `missing_or_unclear` | string(200)[] max 50 | `[]` | Gaps |
| `reason` | string(2000) | `""` | Human-readable rationale |

### eligibility
| Field | Type | Default | Meaning |
|---|---|---|---|
| `degree_match`, `graduation_match`, `student_status_match` | boolean, nullable | - | null = unknown |
| `citizenship_required`, `us_person_required` | boolean | `false` | |
| `f1.status` | enum `eligible, likely_eligible, not_eligible, unknown` | `unknown` | F-1 eligibility |
| `f1.cpt_status`, `f1.opt_status` | enum `allowed, likely_allowed, not_allowed, unknown` | `unknown` | |
| `sponsorship.status` | enum `available, not_available, not_required, unknown` | `unknown` | |
| `sponsorship.internship_sponsorship`, `.future_sponsorship` | same enum | - | |
| `work_authorization_note` | string(1000) | - | Evidence quote |

### compensation (optional)
| Field | Type | Default | Meaning |
|---|---|---|---|
| `available` | boolean | `false` | |
| `min`, `max` | number >= 0, nullable | - | |
| `currency` | string(3) | `USD` | |
| `period` | enum `hour, week, month, year` | `hour` | |

### source
| Field | Type | Default | Meaning |
|---|---|---|---|
| `provider` | enum `company_careers, linkedin, indeed, handshake, simplify, ripplematch, greenhouse, lever, workday, ashby, ycombinator, university_board, other` | `other` | |
| `name` | string(200) | Req | Display name |
| `url` | url | Req | Source page |
| `official` | boolean | `false` | Official company source? `false` adds `source_unverified` |
| `first_seen_at`, `last_verified_at` | iso | Req | |

### agent
| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | string(100) | `GATE Scout` | |
| `agent_type` | string(60) | `job_discovery` | |
| `decision` | enum `surface, discard, needs_review, duplicate, expired` | `surface` | `discard` is never stored |
| `confidence` | number 0-1 | `0.5` | |
| `flags` | enum[] max 20: `strong_match, visa_friendly, cpt_confirmed, sponsorship_available, deadline_soon, new_company, high_compensation, remote, graduation_exact_match, citizenship_required, us_person_required, possible_duplicate, source_unverified` | `[]` | Merged server-side with `deriveFlags` |

### metadata
| Field | Type | Default | Meaning |
|---|---|---|---|
| `fingerprint` | string(200) | - | Agent's own fingerprint; used as a secondary dedupe key, replaced by the server's sha256 on store |
| `is_duplicate` | boolean | `false` | Agent's claim; server decides |
| `discovered_at` | iso | Req | |
| `gate_status` | enum GATE_STATUSES | `discovered` | Only `discovered`/`expired` honored on insert |
| `user_action_required` | boolean | `true` | |

### Derived flags (`deriveFlags`)
`strong_match` (score >= 85), `cpt_confirmed` (cpt_status = allowed), `sponsorship_available`, `citizenship_required`, `us_person_required`, `remote`, `deadline_soon` (deadline in the future and within 4 days), `source_unverified` (source.official = false). Agent-supplied flags are kept.

## 3. Example payload

```json
{
  "event": "gate.opportunity.discovered",
  "schema_version": "1.0",
  "search": {
    "watch_id": "summer-2027-software",
    "season": "Summer 2027",
    "country": "US",
    "searched_at": "2026-10-02T17:30:00-05:00"
  },
  "opportunity": {
    "external_id": "doordash-3536354",
    "title": "Software Engineer Intern - Summer 2027",
    "track": "software_engineering",
    "employment_type": "internship",
    "season": "Summer 2027",
    "location": {
      "city": "San Francisco",
      "state": "CA",
      "country": "US"
    },
    "work_arrangement": "hybrid",
    "dates": {
      "start": null,
      "end": null,
      "duration_weeks": 12
    },
    "application": {
      "status": "open",
      "deadline": "2026-10-15T23:59:59-07:00",
      "apply_url": "https://careers.example.com/jobs/3536354"
    },
    "description_summary": "Software engineering internship focused on production systems."
  },
  "company": {
    "name": "DoorDash",
    "website": "https://www.doordash.com",
    "careers_url": "https://careers.doordash.com",
    "logo_url": "https://example.com/logo.png",
    "industry": "Technology",
    "headquarters": "San Francisco, CA"
  },
  "match": {
    "score": 94,
    "level": "strong",
    "matching_skills": [
      "Python",
      "Java",
      "SQL"
    ],
    "matching_experience": [
      "Previous software engineering internship"
    ],
    "matching_education": [
      "Computer Science degree"
    ],
    "missing_or_unclear": [
      "Kubernetes production experience"
    ],
    "reason": "Strong overlap."
  },
  "eligibility": {
    "degree_match": true,
    "graduation_match": true,
    "student_status_match": true,
    "citizenship_required": false,
    "us_person_required": false,
    "f1": {
      "status": "eligible",
      "cpt_status": "allowed",
      "opt_status": "unknown"
    },
    "sponsorship": {
      "status": "unknown",
      "internship_sponsorship": "unknown",
      "future_sponsorship": "unknown"
    },
    "work_authorization_note": "Posting explicitly states F-1 students may participate using CPT."
  },
  "compensation": {
    "available": true,
    "min": 50,
    "max": 60,
    "currency": "USD",
    "period": "hour"
  },
  "source": {
    "provider": "company_careers",
    "name": "DoorDash Careers",
    "url": "https://careers.example.com/jobs/3536354",
    "official": true,
    "first_seen_at": "2026-10-02T17:30:00-05:00",
    "last_verified_at": "2026-10-02T17:30:00-05:00"
  },
  "agent": {
    "name": "GATE Scout",
    "agent_type": "job_discovery",
    "decision": "surface",
    "confidence": 0.96,
    "flags": [
      "strong_match",
      "cpt_confirmed",
      "deadline_soon"
    ]
  },
  "metadata": {
    "fingerprint": "sha256:abc",
    "is_duplicate": false,
    "discovered_at": "2026-10-02T17:30:00-05:00",
    "gate_status": "discovered",
    "user_action_required": true
  }
}
```

### Batch payload
Shared `search`, 1-100 `results` (each result is an envelope without `event`, `schema_version`, `search`).

```json
{
  "event": "gate.opportunity.batch",
  "schema_version": "1.0",
  "search": {
    "watch_id": "summer-2027-software",
    "season": "Summer 2027",
    "country": "US",
    "searched_at": "2026-10-02T17:30:00-05:00"
  },
  "results": [
    {
      "opportunity": {
        "external_id": "doordash-3536354",
        "title": "Software Engineer Intern - Summer 2027",
        "track": "software_engineering",
        "employment_type": "internship",
        "season": "Summer 2027",
        "location": {
          "city": "San Francisco",
          "state": "CA",
          "country": "US"
        },
        "work_arrangement": "hybrid",
        "dates": {
          "start": null,
          "end": null,
          "duration_weeks": 12
        },
        "application": {
          "status": "open",
          "deadline": "2026-10-15T23:59:59-07:00",
          "apply_url": "https://careers.example.com/jobs/3536354"
        },
        "description_summary": "Software engineering internship focused on production systems."
      },
      "company": {
        "name": "DoorDash",
        "website": "https://www.doordash.com",
        "careers_url": "https://careers.doordash.com",
        "logo_url": "https://example.com/logo.png",
        "industry": "Technology",
        "headquarters": "San Francisco, CA"
      },
      "match": {
        "score": 94,
        "level": "strong",
        "matching_skills": [
          "Python",
          "Java",
          "SQL"
        ],
        "matching_experience": [
          "Previous software engineering internship"
        ],
        "matching_education": [
          "Computer Science degree"
        ],
        "missing_or_unclear": [
          "Kubernetes production experience"
        ],
        "reason": "Strong overlap."
      },
      "eligibility": {
        "degree_match": true,
        "graduation_match": true,
        "student_status_match": true,
        "citizenship_required": false,
        "us_person_required": false,
        "f1": {
          "status": "eligible",
          "cpt_status": "allowed",
          "opt_status": "unknown"
        },
        "sponsorship": {
          "status": "unknown",
          "internship_sponsorship": "unknown",
          "future_sponsorship": "unknown"
        },
        "work_authorization_note": "Posting explicitly states F-1 students may participate using CPT."
      },
      "compensation": {
        "available": true,
        "min": 50,
        "max": 60,
        "currency": "USD",
        "period": "hour"
      },
      "source": {
        "provider": "company_careers",
        "name": "DoorDash Careers",
        "url": "https://careers.example.com/jobs/3536354",
        "official": true,
        "first_seen_at": "2026-10-02T17:30:00-05:00",
        "last_verified_at": "2026-10-02T17:30:00-05:00"
      },
      "agent": {
        "name": "GATE Scout",
        "agent_type": "job_discovery",
        "decision": "surface",
        "confidence": 0.96,
        "flags": [
          "strong_match",
          "cpt_confirmed",
          "deadline_soon"
        ]
      },
      "metadata": {
        "fingerprint": "sha256:abc",
        "is_duplicate": false,
        "discovered_at": "2026-10-02T17:30:00-05:00",
        "gate_status": "discovered",
        "user_action_required": true
      }
    }
  ]
}
```

## 4. Endpoints

All `/v1/agent/*` require `Authorization: Bearer $AGENT_API_KEY`; all `/v1/desktop/*` require `Authorization: Bearer $DESKTOP_SYNC_KEY`. Rate limit 120 req/min. Missing/incorrect key gives 401.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/agent/gate/opportunities` | agent | Submit one envelope or a batch |
| `POST /v1/agent/gate/opportunities/batch` | agent | Same handler, intended for batches |
| `POST /v1/agent/gate/legacy` | agent | Relay-era slim payloads (Vercel relay / Railway worker / Telegram backfill); normalized into full envelopes, then stored like any discovery |
| `POST /v1/agent/gate/:id/delivery` | agent | Report a Telegram attempt: `{channel:"telegram", status: sent\|failed\|rate_limited, message_id?, error?, retry_after?}` |
| `POST /v1/agent/gate/deliveries/claim` | agent | Lease up to 20 records whose Telegram message is still owed (outbox) |
| `GET /v1/agent/gate/decisions` | agent | Items the user decided, so the agent stops re-surfacing them |
| `GET /v1/desktop/gate/opportunities?since=<iso>` | desktop | Sync inbox items to the app |
| `POST /v1/desktop/gate/:id/status` | desktop | Report Approve/Dismiss/Saved-for-later |

The legacy `/v1/agent/opportunities*` endpoints are unchanged.

### POST /v1/agent/gate/opportunities[/batch]
- 400 `{error:"sensitive fields are forbidden"}` if any key looks like a password/secret/token (`containsSensitiveKey`).
- 422 `{error:"invalid payload", details:"path: message; ..."}` on schema failure.
- 201 if at least one item was created, otherwise 200.
- Single envelope response: `{ "success": true, "result": { "gate_opportunity_id": "...", "gate_status": "discovered", "duplicate": false } }`
- Batch response: `{ "success": true, "results": [ ...same shape... ], "summary": { "received": 2, "created": 1, "duplicates": 1, "discarded": 0 } }`
- Duplicates return `duplicate: true` with the existing id, current `gate_status`, and `existing_job_id` when the item was already approved into a Job. Discarded items return `discarded: true` and an empty id.

```bash
curl -X POST "$API/v1/agent/gate/opportunities" -H "Authorization: Bearer $AGENT_API_KEY" -H "Content-Type: application/json" -d @envelope.json
curl -X POST "$API/v1/agent/gate/opportunities/batch" -H "Authorization: Bearer $AGENT_API_KEY" -H "Content-Type: application/json" -d @batch.json
```

### GET /v1/agent/gate/decisions
Returns `[{ gate_opportunity_id, external_id, gate_status, updatedAt }]` for `approved`, `dismissed`, `saved_for_later`, `expired`.
```bash
curl "$API/v1/agent/gate/decisions" -H "Authorization: Bearer $AGENT_API_KEY"
```

### GET /v1/desktop/gate/opportunities
Returns `{ items: [{ gate_opportunity_id, fingerprint, gate_status, received_at, envelope }] }`, ascending by `updatedAt`, max 100. Without `since`, returns undelivered items and marks them delivered (updated duplicates are re-queued as undelivered). With `since` (ISO), returns items updated after it and does not touch delivery state; page by passing the last item's time. Invalid `since` gives 422.
```bash
curl "$API/v1/desktop/gate/opportunities" -H "Authorization: Bearer $DESKTOP_SYNC_KEY"
curl "$API/v1/desktop/gate/opportunities?since=2026-10-02T00:00:00Z" -H "Authorization: Bearer $DESKTOP_SYNC_KEY"
```

### POST /v1/desktop/gate/:id/status
Body `{ "gate_status": "<GATE_STATUSES>", "linked_job_id"?: string }`. 200 `{success:true}`, 404 unknown id, 422 invalid body. Audited.
```bash
curl -X POST "$API/v1/desktop/gate/$ID/status" -H "Authorization: Bearer $DESKTOP_SYNC_KEY" -H "Content-Type: application/json" -d '{"gate_status":"approved","linked_job_id":"job_123"}'
```

## 5. Duplicate detection

1. **Fingerprint**: `sha256( normCompany | normTitleWithoutSeasonWords | canonicalApplyUrl )`, stored as `sha256:<hex>`.
   - `norm`: lowercase, `&` becomes "and", non-alphanumerics collapse to single spaces.
   - Title additionally strips `summer|fall|winter|spring`, years `20xx`, `intern|internship`.
   - `canonicalUrl`: lowercase host without `www.`, path without trailing slash, no query or hash (tracking params never matter).
2. **Lookup order** in `gate_opportunities`: server fingerprint, then `metadata.fingerprint` from the agent, then `source.provider + external_id`, then **soft key** (`normCompany | normTitle | normCity`, catches the same role reposted on another URL).
3. **New**: insert with `gate_status` `discovered` (or `expired` if the agent sent that), flags merged with `deriveFlags`, `deliveredAt: null`.
4. **Existing**: only mutable facts are refreshed: `source`, `application.status`, `application.deadline`, `description_summary`, `eligibility`, `compensation`, `updatedAt`. `gate_status` is never changed, so approved/dismissed/saved_for_later/expired items are never downgraded. Response is `duplicate: true`.
5. `agent.decision = discard` is never stored.
6. A unique index on `fingerprint` plus duplicate-key handling resolves concurrent inserts.

## 6. Approve maps to a Job

When the user clicks Approve in the desktop app:
1. Upsert the Company by name (fill website, careers_url, logo_url, industry, headquarters if missing).
2. Create a Job with stage `saved`, title, location, work arrangement, season, apply URL, compensation, description summary.
3. Preserve `match`, `eligibility`, `source`, and `agent` metadata on the Job (shown in the Job Drawer).
4. If `application.deadline` is set, create a Calendar **Deadline** event.
5. Report back with `POST /v1/desktop/gate/:id/status` `{gate_status:"approved", linked_job_id}`.
6. Approve never submits an application and never contacts the employer.

Notifications: the API creates a `notifications` doc for strong matches (score >= 85) at ingest, with "CPT confirmed" / "deadline soon" wording (urgency `high` when the deadline is soon). The desktop also raises a local reminder as a deadline approaches.

## 7. Integration points

| Surface | Use |
|---|---|
| Job Drawer | Shows match reason, matching/missing skills, eligibility (F-1/CPT/OPT, sponsorship), source and verification, agent confidence |
| Documents | Resume/cover letter tailoring suggestions use `matching_skills` and `missing_or_unclear` |
| Credentials Vault | Local only; GATE never reads or transmits vault data |
| Calendar | Deadline events from `application.deadline` |
| Agent Inbox | Summary message per run (counts from batch `summary`) |
| Notifications | `notifications` collection, delivered via `GET /v1/desktop/notifications` |

## 8. Security rules

- The agent key can only submit opportunities, read decisions, and read the search profile. It cannot read MongoDB, the vault, or credentials.
- Any payload (at any depth) containing a key matching password/secret/token patterns is rejected with 400 before parsing.
- Request bodies and Authorization headers are redacted from logs.
- Approve never submits an application; the user applies manually.
- Desktop sync uses a separate key (`DESKTOP_SYNC_KEY`) that must never be given to the agent.
- Agent content is untrusted text: render as plain text, validate URLs, never execute.

## 9. MongoDB layout

Collection `gate_opportunities`:
```
{ _id, fingerprint, softKey, external_id, provider, gate_status, flags[], linked_job_id|null,
  envelope: <GateEnvelope>, createdAt, updatedAt, deliveredAt|null }
```
Indexes: `fingerprint` (unique), `external_id`, `gate_status`, `updatedAt`.
Related: `notifications { title, body, urgency, opportunityExternalId, deliveredAt, createdAt }`, `audit_logs { action, externalId, createdAt }` (actions `gate.opportunity.created|duplicate|discarded`, `gate.status.<status>`).

## 10. Relay and Telegram backfill

The Vercel relay (`~/code/gate-telegram-relay/api/gate.js`, separate repo) saves each opportunity through `POST /v1/agent/gate/legacy` **before** sending the Telegram notification, so a Telegram failure never loses a record. It skips Telegram for duplicates and when called with `?notify=0`. Relay env: `GATE_API_URL`, `AGENT_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Backfill from the channel (the Bot API cannot read history): Telegram Desktop, open the channel, menu, **Export chat history**, untick media, format **JSON**. Then:

```bash
npx tsx apps/api/scripts/import-gate.ts --telegram ~/Downloads/Telegram\ Desktop/ChatExport_*/result.json --dry-run
GATE_API_URL=https://your-api AGENT_API_KEY=... npx tsx apps/api/scripts/import-gate.ts --telegram .../result.json
npx tsx apps/api/scripts/import-gate.ts --json backfill.json   # relay-shaped JSON, e.g. the Railway BACKFILL_JSON
```
Imports are idempotent (same fingerprint/external id/soft key rules as §5). Records recovered from Telegram text carry the fields the message showed (company, title, location, score, CPT, sponsorship, apply URL); the rest take defaults and `match.reason` says so.

## 11. Delivery outbox (Telegram)

Every stored record carries `delivery.telegram = { status, retry_count, message_id?, sent_at?, error?, retry_after?, next_retry_at }` with status `pending | sending | sent | rate_limited | failed`. Saving the record always comes first; Telegram success never decides whether a job exists.

- New record: `pending`, first send due after a 60 s grace so the request that created it sends it immediately and nobody double-sends.
- Failure: `rate_limited` honours Telegram's `retry_after`; `failed` backs off 1, 2, 4... up to 60 min; after 6 attempts it stops (`next_retry_at: null`).
- `deliveries/claim` leases items for 2 min (`sending`), so concurrent workers never double-send and a crashed worker's items come back automatically.
- Backfills (`notify:false` in the body or `?notify=0`) are created as `sent`, so they are never posted to Telegram. Records stored before the outbox existed have no `delivery` field and are treated as already sent.
- Relay (`~/code/gate-telegram-relay`): `api/gate.js` saves, sends, reports; it also drains up to 3 queued items per request. `api/retry.js` drains on demand and from a daily Vercel cron. Optional `GATE_INGEST_TOKEN` requires `Authorization: Bearer` on `/api/gate`; `CRON_SECRET` protects `/api/retry`.

## 12. Hosting

The API runs as a Vercel function: `npm run build:vercel -w @job-hunt-os/api` bundles `apps/api/src/vercel.ts` into `deploy/vercel-api/` (one file, no install step); `cd deploy/vercel-api && vercel deploy --prod` publishes it as project `job-hunt-os-api`. Production env: `MONGODB_URI`, `AGENT_API_KEY`, `DESKTOP_SYNC_KEY` (Vercel Sensitive). Public address: `https://job-hunt-os-api.vercel.app`. Local development is unchanged (`npm run dev:api`). Atlas must allow Vercel's addresses (Network Access 0.0.0.0/0 with strong credentials, since Vercel has no fixed IPs).

Flow: Railway worker or Scout `POST https://gate-telegram-relay.vercel.app/api/gate` -> relay saves to this API (`/v1/agent/gate/legacy`) -> relay notifies Telegram and reports delivery -> the desktop app syncs `GET /v1/desktop/gate/opportunities?since=<cursor>` every 2 minutes while open and catches up on launch.
