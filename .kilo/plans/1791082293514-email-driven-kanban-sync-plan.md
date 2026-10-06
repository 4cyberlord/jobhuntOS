# Plan: Email-Driven Pipeline Sync (Outlook → Kanban/Calendar/Notifications) + Tech Assessment Stage

## Goal
Make the single `Settings.profile.email` Outlook mailbox the source of truth for post-apply lifecycle: auto-advance Kanban, create calendar events, and surface provenance-rich notifications — without manual status dragging. Add a tech-specific Kanban stage for coding challenges/OAs.

## Context & Current System (read from codebase)
- **Types:** `Status = pending_review | saved | preparing | applied | interviewing | offer | rejected | dismissed`; `PIPELINE` has 6 columns (Saved/Preparing/Applied/Interviewing/Offer/Rejected). `Job.gate` preserves discovery metadata. `GateOpportunity.gateStatus` lifecycle is separate (`discovered/reviewing/approved/...`). `CalEvent` has `kind: interview|followup|deadline|assessment|personal`. `AppNotification.kind` includes `interview|deadline|match|recruiter|followup|document|stale|reminder|weekly`.
- **Approve flow today:** `GateDetail` CTA `Approve to Pipeline` calls `act.approveGate(id)` → `gate.ts:approve()` creates `Job{status:"saved"}` in Saved, upserts `Company`, creates `CalEvent{kind:"deadline"}` if deadline exists, marks `gateStatus:"approved"` with `linkedJobId`. User later manually drags Kanban `Saved→Preparing→Applied` or via `moveJob()`.
- **Outlook MCP reference:** `marlonluo2018/outlook-mcp-server` is Windows-only `win32COM` local processing (requires Outlook 2016+ running). Tools: `list_recent_emails`, `search_by_(subject|sender|body)`, `view_cache`, `get_by_number`, `reply`, `compose`, `get_folder_list` etc. Privacy-first/local vs Graph API alternative (full M365, cross-platform, OAuth 2.0 device-code flow, Mail+Calendar+Graph).
- **Desktop app:** Tauri + Vite + React 19, runs on macOS (`/Users/cyberlord/...`); `win32COM` is not viable cross-platform. Existing sync is workspace sync (`syncConfig`), not email.

## Decisions

### 1. Integration choice: Microsoft Graph (not win32COM) — recommended
- **Rationale:** Tauri desktop must work on macOS/Windows; `win32COM` fails on macOS and requires Outlook desktop running. Graph gives `Mail.Read`, `Calendars.ReadWrite`, `User.Read` with OAuth, matches the linked comparison doc in the MCP repo.
- **Implementation:** New Rust Tauri command or TS `outlookGraph.ts` that mirrors MCP tool surface but over Graph REST: `listMessages`, `searchMessages($search/$filter)`, `getMessage(id)`, `listFolders`, `createEvent`. Use incremental sync via `delta` + watermark `lastDeltaLink` stored in workspace `settings.agent` extension. Poll 5–15 min + manual "Sync email now" button + optional push via Graph subscriptions later.
- **Auth:** Device-code flow or OAuth2 auth-code with PKCE via `plugin-opener` → system browser, tokens stored in OS keychain via Tauri `plugin-stronghold` or `vault` pattern (never in workspace JSON). Scopes: `Mail.Read`, `Calendars.ReadWrite`, `offline_access`. Read-only for mail by default.

### 2. Kanban extension for tech — add `assessment` stage
- **Proposal (recommended):** Single new column `assessment` between `applied` and `interviewing` (covers OA, coding challenge, take-home, HackerRank/Codility). Subtype stored on `Job` and `CalEvent`:
  ```ts
  type Status = ... | "assessment" | ... ; // new
  PIPELINE: [..., {status:"assessment", name:"Assessment"}, {status:"interviewing", name:"Interviewing"}, ...]
  CalEvent.kind: already has "assessment" — reuse
  Job.assessmentKind?: "oa" | "take_home" | "live_coding" | "hirevue" | "other"
  ```
- **Alternative considered:** Two columns (`OA` + `Challenge`) — rejected as noisy columns; single column with pill subtype scales better.
- **Migration:** Existing seed `PIPELINE` order becomes `Saved → Preparing → Applied → Assessment → Interviewing → Offer → Rejected`. Filter dropdowns and `kanban/helpers.ts` `stageLabel/cardDate` updated; reordering is additive, no data loss.

### 3. Email → state mapping (classification)
- **Labels:**
  - `application_confirmed` → advance to `applied` (if Gate `discovered/reviewing` → auto-`approve` first, else `Job.status=applied`)
  - `assessment_invite` / `oa_invite` / `coding_challenge` → `assessment` (set `assessmentKind`, create `CalEvent{kind:"assessment"}` + `Task{dueAt}`)
  - `interview_invite` → `interviewing` (create `CalEvent{kind:"interview"}`)
  - `rejection` → `rejected`
  - `offer` → `offer`
  - `schedule` / `reschedule` / `followup` / `deadline_reminder` → `CalEvent` only (interview/followup/deadline)
- **Classifier:** Rules-first (subject/sender/keywords + regex for dates/links) + optional local LLM fallback later. Ship with 30+ sender patterns (`noreply@lever.co`, `greenhouse.io`, `workday`, `ashby`, `hackerrank`, `codility`) and subject cues (`"Thank you for applying"`, `"OA"`, `"Assessment"`, `"Invitation to interview"`, `"Update on your application"`). Confidence threshold 0.85 for auto-move; 0.6–0.85 → Notification with CTA to confirm.

### 4. Matching engine (which Job/Gate does this email belong to?)
- **Signals (ranked):** (1) `X-Job-Id` / `apply_url` embedded, (2) exact `company + role` fuzzy match, (3) `company domain` in sender (`@company.com` vs envelope `company.website`), (4) `opportunity.external_id` in URL params, (5) recency window (30 days since `receivedAt`/`addedAt`).
- **Resolution:** Score > threshold → auto-link. Ties or no match → create `AppNotification` + `Task` "Review unmatched email: <subject> from <sender>" without moving pipeline; surface in Notifications with `View email` → manual link picker. Never auto-create a new Job from email alone (prevents spam ingestion).

### 5. Idempotency & provenance (critical for notifications)
- De-duplicate by Graph `internetMessageId` + `conversationId`; store `emailSyncCursor:{lastRunAt, processedIds:Set, deltaLink}`.
- Every auto-transition writes: `Job.notes` append footer `Auto-moved via email <date> — <subject>`; `AppNotification.body` includes `Detected in your Outlook (Settings.profile.email): "<subject>" from <sender> on <date> — … → moved <Company> to <Stage>.` with `jobId/eventId` links; `activity` log entry; `CalEvent.description` includes `Source: email <messageId>`.
- Undo: Notification CTA `Undo` reverts `moveJob` one step via `act.moveJob(prevStatus)`.

### 6. Calendar integration
- Parse `date/time + timezone + duration + location/link` via `chrono` + regex for `Zoom/Teams/Google Meet` + sender signature. Fallback: extract ICS `.ics` attachment if present.
- Create `CalEvent{jobId, company, kind, start/end, format, link, attendees}`. Default duration 60m interview / 90m assessment if not stated. Respect `company` timezone fallback to `profile.location`.
- Conflicts: if overlap, still create with `prep` checklist item "Confirm time — overlaps with <other>".

### 7. Approve → pipeline → email lifecycle (the flow you asked about)
1. User discovers in `GateDetail` → `Refactor Resume` (LaTeX modal) → optional save to `Documents`.
2. User clicks **Approve to Pipeline** (today `Saved`) → `Job.status="saved"`, linked via `gate.linkedJobId`, deadline `CalEvent`.
3. User applies externally via `apply_url` (outside app).
4. Inbox receives confirmation (e.g., Lever/Workday "Application received") → email sync classifies `application_confirmed`, matches Gate/Job → auto-moves `Job.saved|preparing → applied` (if Gate still `discovered` → auto-approve then applied), moves `Gate.gateStatus` to `approved` if needed, creates/updates `dueAt/dueLabel="Applied <date>"`, posts Notification "Auto-moved to Applied — detected in Outlook".
5. Subsequent emails (OA/Interview/Rejection/Offer) drive `assessment/interviewing/rejected/offer` as above, plus calendar/tasks.

### 8. Notification center contract
- New kinds: `assessment`, `applied_auto`, `status_change` (map to existing `interview|deadline|match|recruiter|followup` plus one new `assessment` if allowed). Body template: `"We noticed <subject> from <sender> matching <Company · Role>. Based on your Kanban stages, we moved it to <Stage> and added <Calendar>. [View job] [Undo]"`.

## Edge Cases & Mitigations
- **Multiple jobs same company:** disambiguate via role tokens in subject/body; if ambiguous, require manual confirm.
- **Out-of-order emails** (offer before interview): allow forward-only by default, but allow `offer` from any prior stage; log warning, don't downgrade.
- **Re-apply / duplicate confirmations:** dedupe by `messageId`; second confirmation is no-op.
- **Reschedule/cancellation:** detect `cancelled|rescheduled` keywords → update `CalEvent.start/end` or delete; notify.
- **Timezone drift / all-day events:** normalize to `America/Los_Angeles` or `profile.location` + surface `UTC` in notes.
- **Unsubscribe/marketing noise:** filter via `List-Unsubscribe` header + sender allowlist of ATS domains; ignore newsletters.
- **Offline & rate limits:** Graph throttle handling (429 retry-after) + offline queue; sync button disabled when `!isConfigured`.
- **Privacy:** `Mail.Read` least privilege; never auto-reply/forward; `compose_email_tool` equivalent disabled unless user explicitly enables; tokens never leave device.

## Affected Boundaries
- `apps/desktop/src/lib/types.ts`: add `assessment` to `Status`, `PIPELINE`, `Job.assessmentKind`, extend `NotifKind`.
- `apps/desktop/src/lib/gate.ts`: auto-approve helper for email path.
- `apps/desktop/src/lib/store.tsx`: new actions `applyEmailDecisions`, `createAssessment`, idempotent email cursor.
- New `apps/desktop/src/lib/outlookGraph.ts` + `apps/desktop/src/lib/emailClassifier.ts` + `apps/desktop/src/lib/emailSync.ts`.
- `apps/desktop/src/pages/Kanban.tsx` + `apps/desktop/src/pages/kanban/helpers.ts` + `kanban.css` (new column).
- `apps/desktop/src/pages/Gate.tsx` + `GateDetail.tsx` copy update for post-approve messaging.
- Settings UI for Outlook connect/disconnect + test with user email (see Validation).

## Data Flow
Graph (delta) → `emailSync.fetchNew()` → `classify()` → `matchJobOrGate()` → `decideTransition()` (confidence-gated) → `store.replaceWorkspace(fn)` → `create CalEvent/Task` → `addNotification(+ activity)` → Kanban reflects new status.

## Rollout / Migration
1. Feature flag `emailSync` off by default.
2. Add `assessment` column (empty) — no migration of existing jobs.
3. Ship Graph auth + read-only sync behind Settings → "Connect Outlook".
4. For installs with `win32COM` scenario, docs note Graph is cross-platform replacement.

## Validation
- Unit: classifier fixtures (applied/confirmed, OA, interview, rejection, offer, reschedule), matcher (Lever/Workday/Greenhouse senders), idempotency (same `messageId` twice = one transition), timezone parsing.
- Integration: mock Graph delta feed → seed 5 jobs → inject 6 emails → assert `saved→applied`, `applied→assessment`, `assessment→interviewing`, calendar created, notification provenance includes `Settings.profile.email`.
- Manual (your email): Connect Outlook test account, send self a fake Lever "Application received for <Role> at <Company>" matching an existing Gate title → verify auto-approve + move to Applied + notification text. Then send "OA invite due 2026-10-07" → verify `Assessment` column + `CalEvent` + `Task` deadline.
- Failure: revoke token → sync shows `Sync error (401)`, no data loss; re-auth restores cursor.

## Open Questions (resolve before build)
1. **Email account:** Confirm `Settings.profile.email` is Outlook/Microsoft 365 (not Gmail) and you consent to `Mail.Read` — recommended yes.
2. **Auto-move vs confirm:** Default to auto-move only when confidence ≥0.85; below that show CTA to confirm — acceptable? (Recommended: yes.)
3. **Platform:** Are you on macOS for daily use (so we must use Graph, not win32COM)? (Assumed macOS → Graph.)

## Ordered Task List (for implementer)
1. Extend types & Kanban column (`assessment`) + helpers/styles.
2. Add Outlook Graph service (`outlookGraph.ts`) + auth (PKCE device code) + token storage.
3. Build email classifier rules + matcher (ATS allowlist, fuzzy scoring).
4. Implement `emailSync.ts` with delta cursor, dedupe, confidence gating.
5. Wire transitions: `application_confirmed → approve+applied`, `assessment→assessment`, `interview→interviewing`, `rejection/offer`.
6. Calendar `CalEvent` creation from parsed dates/attachments.
7. Notifications with provenance + undo + activity log.
8. Settings UI "Connect Outlook" + manual sync + status pill.
9. Tests/fixtures + migration for new status.
10. Docs + privacy notice.

## Risks
- Over-matching wrong job (same company, different role) → mitigated by role-aware scoring + confirm threshold.
- Graph permission friction — needs clear consent UX.
- ATS email variance — keep classifier rule set extensible.

