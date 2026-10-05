# Job Hunt OS

Job Hunt OS is a macOS-first application tracker. It turns job-search signals into an organized workflow: discover an opportunity, approve it into a pipeline, track its application and assessment stages in Kanban, and surface scheduled events and decisions in Calendar and Notifications.

## Opportunity flow

1. A GATE agent discovers an opportunity and adds it to the separate GATE Inbox.
2. **Approve to pipeline** creates a Job in the **Saved** Kanban stage, preserves its source and match evidence, and creates a company record when needed. It never submits an application.
3. After you apply, a matching confirmation email advances the Job to **Applied**. A coding challenge, online assessment, take-home, or live-code invitation advances it to **Assessment**; an interview, offer, or rejection moves it to the corresponding stage.
4. Every email-driven action creates a Notification and audit entry naming the sender, subject, confidence, and change. A dated interview or assessment creates a Calendar event; assessments also create a high-priority task.

High-confidence matches advance automatically. Ambiguous or low-confidence messages create a review notification and never silently move a Job. The app never auto-downgrades a stage, creates a Job from an unrelated email, or sends email.

## Outlook email sync

The app uses a **server-managed Microsoft Graph connection**, supporting Outlook.com and Microsoft 365 work/school accounts. In **Settings → Integrations**, click **Connect Outlook** and approve Microsoft’s read-only Inbox permission. You never paste an Azure Client ID, client secret, or token into the desktop app.

The API checks the Inbox every five minutes, and the desktop also provides **Sync email now**. The server keeps encrypted OAuth tokens and a Graph delta cursor; the desktop receives only the minimum message metadata needed to classify and match messages. Raw message bodies are not retained, attachments are not read, and the integration never writes to Outlook mail or Outlook Calendar.

> The `marlonluo2018/outlook-mcp-server` project is Windows-only: it requires Outlook desktop and `win32COM`. It cannot run in this macOS app or a hosted service. This app uses Microsoft Graph because it is cross-platform and supports the same Inbox workflow.

### Server setup

Create a Microsoft Entra application that supports personal and organizational Microsoft accounts. Add this deployed callback URL:

`https://YOUR_API_HOST/v1/desktop/outlook/callback`

Give it delegated `Mail.Read`, `User.Read`, and `offline_access` permissions. Set these server-only values on Vercel, your VPS, or local `apps/api/.env`:

- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET`
- `OUTLOOK_REDIRECT_URI`
- `OUTLOOK_TOKEN_ENCRYPTION_KEY` — a unique 32-byte base64 key or 64 hexadecimal characters
- `CRON_SECRET` — a separate random secret protecting scheduled syncs

The Vercel deployment includes a five-minute cron route. On a VPS, call `POST /v1/internal/outlook/sync` every five minutes with `Authorization: Bearer $CRON_SECRET`.

## Install and development

Run `npm install` at the repository root. Copy `apps/api/.env.example` to `apps/api/.env`, configure MongoDB and the values you need locally, then run `npm run dev:api` and `npm run dev:desktop` in separate terminals.

The desktop keeps its sign-in/session settings, presentation preferences, local cache, and encrypted vault material on the device. The API stores synchronized workspace records, GATE data, document chunks, sessions, and encrypted Outlook connection data in MongoDB. Vault passwords are never exported or exposed to the agent.

## GATE and security

GATE (Gather, Assess, Track, Execute) accepts agent discoveries at `POST /v1/agent/gate/opportunities`. Production agents send one complete GATE 2.x opportunity at a time and wait for the server acknowledgement/fingerprint before sending the next; direct batch imports use the documented `results` wrapper. The agent has submit-only access and cannot retrieve credentials, workspace data, or submit applications. The desktop sync endpoint uses its own authenticated session.

See [docs/GATE.md](docs/GATE.md) for the discovery contract and [docs/RELEASING.md](docs/RELEASING.md) for release instructions.
