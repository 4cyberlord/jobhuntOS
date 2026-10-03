# Job Hunt OS

Private macOS-first job-search workflow with a secure watcher ingestion API.

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
