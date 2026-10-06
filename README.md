<div align="center">

<img src="assets/job-hunt-os-mark.svg" alt="Job Hunt OS" width="112" height="112" />

# Job Hunt OS

**A macOS-first command center for discovering, evaluating, and managing job opportunities.**

Track applications, automate opportunity intake with GATE, organize company intelligence, connect Outlook, manage documents and credentials, and keep the entire search lifecycle in one desktop workspace.

![macOS](https://img.shields.io/badge/macOS-first-111827?style=flat-square&logo=apple&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-desktop-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-UI-149ECA?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-typed-3178C6?style=flat-square&logo=typescript&logoColor=white)
![GATE](https://img.shields.io/badge/GATE-2.x-7A56EE?style=flat-square)

</div>

---

## What Job Hunt OS does

Job Hunt OS turns scattered job-search activity into one structured system. Opportunities discovered by agents, job boards, career pages, email, and manual entry flow into a single workspace where they can be reviewed, approved, tracked, enriched, and acted on.

The desktop app is designed around a simple rule: **automation may discover, classify, and organize, but important user actions stay explicit and auditable.**

### Core workspace

- **Dashboard** — high-level activity, pipeline health, upcoming events, and agent results.
- **Opportunities** — every role you saved, imported, or approved from GATE.
- **GATE Inbox** — agent-discovered opportunities waiting for review.
- **Company Intelligence** — canonical employer registry, verified career sources, scan health, and discovered postings.
- **Companies** — your personal company relationships, contacts, application context, and notes.
- **Calendar** — interviews, assessments, deadlines, and other scheduled events.
- **Conferences** — discovered events and application opportunities.
- **Documents** — résumés and supporting application material.
- **Credential Vault** — encrypted credentials that remain under the user's control.
- **Agent Inbox & Notifications** — automation activity, review items, and change history.
- **Settings** — account, integrations, appearance, sync, and app preferences.

## GATE

**GATE — Gather, Assess, Track, Execute** is the opportunity discovery and intake system behind Job Hunt OS.

A GATE agent can discover a role and submit a complete GATE 2.x record to:

`POST /v1/agent/gate/opportunities`

Each record can carry:

- original posting evidence;
- company and role identity;
- required and preferred skills;
- technologies and technical stack;
- compensation and location;
- internship dates and duration;
- work authorization and sponsorship language;
- application requirements and instructions;
- hiring-process details;
- match score and eligibility risk;
- provenance, timestamps, and canonical apply URL.

Approving a GATE opportunity creates a normal Job Hunt OS opportunity. **Approval never submits an application.**

See [docs/GATE.md](docs/GATE.md) for the full contract.

## Company Intelligence

Company Intelligence is the shared employer knowledge layer used by GATE and the desktop app.

It maintains:

- canonical company identities;
- verified company websites;
- official career pages and ATS sources;
- source verification and health;
- technical-employer status;
- discovered job postings;
- GATE IDs and posting lineage;
- scan state and scheduling metadata.

Company Intelligence is intentionally separate from the personal **Companies** section. A company may exist globally in Company Intelligence without being added to the user's relationship/application workspace.

The UI uses the same shared logo system as the rest of Job Hunt OS: known brand marks first, then verified-site icons, then a deterministic fallback tile.

## Opportunity flow

1. GATE discovers an opportunity and places it in the **GATE Inbox**.
2. The user reviews the evidence and match assessment.
3. **Approve to pipeline** creates a Job in **Saved** and preserves the source and GATE metadata.
4. After the user applies, matching email activity can advance the opportunity to **Applied**.
5. Assessments, interviews, offers, and rejections update the pipeline when confidence is high.
6. Ambiguous email events become review notifications instead of silently changing application state.

The app does not auto-submit applications, auto-send email, or silently downgrade pipeline stages.

## Outlook email sync

Job Hunt OS uses a **server-managed Microsoft Graph connection** for Outlook.com and Microsoft 365 work/school accounts.

From **Settings → Integrations**, choose **Connect Outlook** and approve read-only Inbox access.

The desktop never receives Azure client secrets or long-lived Graph tokens. The API stores encrypted OAuth material and maintains the Graph delta cursor. Only the message metadata required for classification and matching is retained by the Job Hunt OS workflow.

The integration:

- reads Inbox events used for application tracking;
- does not send email;
- does not write to Outlook Calendar;
- does not retain raw message bodies;
- does not read attachments.

### Outlook server configuration

Create a Microsoft Entra application that supports personal and organizational Microsoft accounts and configure:

```text
https://YOUR_API_HOST/v1/desktop/outlook/callback
```

Delegated permissions:

- `Mail.Read`
- `User.Read`
- `offline_access`

Server-only environment values:

```text
OUTLOOK_CLIENT_ID
OUTLOOK_CLIENT_SECRET
OUTLOOK_REDIRECT_URI
OUTLOOK_TOKEN_ENCRYPTION_KEY
CRON_SECRET
```

## Architecture

```text
                           ┌──────────────────────┐
                           │   Discovery Agents   │
                           │  Cloudflare / GATE   │
                           └──────────┬───────────┘
                                      │
                                      ▼
┌──────────────────┐       ┌──────────────────────┐
│  Job Hunt OS     │◄─────►│   Job Hunt OS API    │
│  Tauri Desktop   │       │      Vercel          │
│  React + TS      │       └──────────┬───────────┘
└────────┬─────────┘                  │
         │                            ├──────────────► MongoDB
         │                            │                workspace / applications
         │                            │
         │                            └──────────────► Render PostgreSQL
         │                                             Company Intelligence
         │
         └────────────► local settings, cache, and encrypted vault material
```

Additional delivery and automation services may be used by GATE without changing the desktop contract. The desktop talks to the authenticated Job Hunt OS API rather than directly to infrastructure databases.

## Technology

| Area | Stack |
| --- | --- |
| Desktop | Tauri |
| Frontend | React, TypeScript, Vite |
| API | Node.js, TypeScript |
| Primary workspace data | MongoDB |
| Company Intelligence | PostgreSQL |
| Opportunity discovery | GATE 2.x |
| Email integration | Microsoft Graph |
| Deployment | Vercel, Render, Cloudflare, Railway |
| Shared contracts | npm workspaces / TypeScript packages |

## Local development

### Requirements

- Node.js
- npm
- Rust toolchain required by Tauri
- macOS for the primary desktop development workflow
- a configured API environment for features that require backend services

### Install

```bash
git clone https://github.com/4cyberlord/jobhuntOS.git
cd jobhuntOS
npm install
```

Copy the API environment template:

```bash
cp apps/api/.env.example apps/api/.env
```

Configure the services you need in `apps/api/.env`.

### Run the full development workspace

```bash
npm start
```

Or run the API and desktop separately:

```bash
npm run dev:api
npm run dev:desktop
```

### Checks

```bash
npm run typecheck
npm test
```

### Desktop build

```bash
npm run build:desktop
```

## Repository layout

```text
apps/
  api/                 Job Hunt OS API
  desktop/             Tauri + React desktop application

packages/
  contracts/           Shared TypeScript contracts and helpers

deploy/
  cloudflare-gate-discovery/
  railway-gateway/
  render-company-intelligence/
  macos/
  nginx/
  systemd/

docs/
  GATE.md
  RELEASING.md

assets/
  job-hunt-os-mark.svg
```

## Data and security model

Job Hunt OS separates user-facing workflow data, global company intelligence, local desktop state, and agent permissions.

- GATE receives submit-only access for opportunity ingestion.
- Desktop synchronization uses an authenticated user session.
- Company Intelligence uses a separate service boundary and database.
- Outlook OAuth credentials remain server-side and encrypted.
- Vault passwords are not exported to agents.
- Secrets are never committed to the repository.
- Automated decisions create traceable records and notifications.

## Release documentation

See [docs/RELEASING.md](docs/RELEASING.md) for the current release process.

---

<div align="center">

<img src="assets/job-hunt-os-mark.svg" alt="Job Hunt OS logo" width="52" height="52" />

**Job Hunt OS**

*Discover intelligently. Decide deliberately. Track everything.*

</div>
