# Job Hunt OS

Private macOS-first job-search workflow with a secure watcher ingestion API.

Track opportunities, applications, companies, contacts, a calendar and documents in one desktop app, with an encrypted credential
vault and an AI "GATE" inbox that surfaces matches found by your agent. Everything is stored on **your own server** (MongoDB behind the
API in `apps/api`); the desktop app keeps nothing but your sign-in on the device.

## Install and update

Download the latest `.dmg` from [Releases](https://github.com/4cyberlord/jobhuntOS/releases). After that the app updates itself:
**Settings → About → Check for updates → Get update**. See [docs/RELEASING.md](docs/RELEASING.md) for how releases are published.

## Sign-in and secrets

Sign-in details and keys live in the database, not in environment files. The only server environment variable is `MONGODB_URI`.
Run `npx tsx apps/api/scripts/store-secrets.ts` once to store your owner email/password hash (and optionally the agent key hash).

## Local development

1. Run `npm install` once at the repository root.
2. Copy `apps/api/.env.example` to `apps/api/.env` and enter your own non-production local values.
3. Run `npm run dev:api` and `npm run dev:desktop` in separate terminals. The latter opens the native macOS application.
3. The watcher sends `Authorization: Bearer $AGENT_API_KEY` with JSON to `POST /v1/agent/opportunities`.

## VPS deployment

Set `/etc/job-hunt-os/api.env` to `MONGODB_URI`, `AGENT_API_KEY`, and `API_PORT`. Install the systemd unit and Nginx configuration from `deploy/`, replace `api.example.com`, configure DNS and TLS, then enable the service. MongoDB must remain network-private.

## GATE

GATE (Gather, Assess, Track, Execute) is the agent data contract: the agent submits scored opportunities to `POST /v1/agent/gate/opportunities` (single or batch), they land in the desktop GATE Inbox, and only Approve turns one into a Job. See [docs/GATE.md](docs/GATE.md) for the full spec. Env vars: `AGENT_API_KEY` (agent, submit-only), `DESKTOP_SYNC_KEY` (desktop sync and status), `MONGODB_URI`, `API_PORT`.

## Security

The watcher only receives the sanitized search profile and review decisions. It cannot query MongoDB, retrieve desktop vault secrets, submit applications, or access any portal credential.
