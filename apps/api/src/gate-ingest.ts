import { createHash } from "node:crypto";
import { fingerprintInput, type GateEnvelope, type GateStatus } from "@job-hunt-os/contracts";

/** Statuses the user (or expiry) set; the agent can never move an item out of these. */
export const USER_DECIDED: readonly GateStatus[] = ["approved", "dismissed", "saved_for_later", "expired"];
export const isUserDecided = (s: string) => (USER_DECIDED as readonly string[]).includes(s);

export const fingerprintOf = (item: Pick<GateEnvelope, "company" | "opportunity">) => `sha256:${createHash("sha256").update(fingerprintInput(item)).digest("hex")}`;

export type IngestPlan =
  | { action: "discard" }
  | { action: "insert"; gate_status: GateStatus }
  | { action: "update"; gate_status: GateStatus };

/** Pure ingest decision. Existing items only get their mutable facts refreshed and never lose a user decision. */
export function classifyIncoming(existing: { gate_status: GateStatus } | null, incoming: GateEnvelope): IngestPlan {
  if (incoming.agent.decision === "discard") return { action: "discard" };
  if (existing) return { action: "update", gate_status: existing.gate_status };
  const requested = incoming.metadata.gate_status;
  return { action: "insert", gate_status: requested === "expired" ? "expired" : "discovered" };
}

/** Only these facts may change on an existing item (dotted paths into the stored envelope). */
export function mutableUpdate(incoming: GateEnvelope, now = new Date()): Record<string, unknown> {
  const e = incoming;
  return {
    "envelope.source": e.source,
    "envelope.opportunity.application.status": e.opportunity.application.status,
    "envelope.opportunity.application.deadline": e.opportunity.application.deadline ?? null,
    "envelope.opportunity.description_summary": e.opportunity.description_summary,
    "envelope.eligibility": e.eligibility,
    "envelope.compensation": e.compensation ?? null,
    updatedAt: now,
  };
}

/** Notification wording for strong matches, or null. */
export function notificationFor(item: GateEnvelope, flags: string[]): { title: string; body: string; urgency: "high" | "normal" } | null {
  if (item.match.score < 85) return null;
  const tags = [flags.includes("cpt_confirmed") ? "CPT confirmed" : "", flags.includes("deadline_soon") ? "deadline soon" : ""].filter(Boolean);
  return { title: `Strong match: ${item.company.name}`, body: `${item.opportunity.title} (${Math.round(item.match.score)}%)${tags.length ? ` - ${tags.join(", ")}` : ""}`, urgency: flags.includes("deadline_soon") ? "high" : "normal" };
}

/* ───────── delivery outbox (Telegram today; other channels reuse the same lifecycle) ───────── */
export const DELIVERY_STATUSES = ["pending", "sending", "sent", "rate_limited", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type DeliveryState = { status: DeliveryStatus; retry_count: number; message_id?: number; sent_at?: Date; error?: string; retry_after?: number; next_retry_at?: Date | null; updated_at: Date };
export const MAX_DELIVERY_ATTEMPTS = 6;
/** A claimed item is leased this long; if the worker dies the lease expires and the item becomes eligible again. */
export const SENDING_LEASE_MS = 120_000;

export type DeliveryOutcome = { status: "sent"; message_id?: number } | { status: "failed" | "rate_limited"; error?: string; retry_after?: number };

/** Next delivery state after an attempt. Failures back off exponentially (1, 2, 4... min, max 60) or honour Telegram's retry_after, then give up. */
export function nextDelivery(prev: Partial<DeliveryState> | undefined, outcome: DeliveryOutcome, now = new Date()): DeliveryState {
  if (outcome.status === "sent") return { status: "sent", retry_count: prev?.retry_count ?? 0, message_id: outcome.message_id, sent_at: now, next_retry_at: null, updated_at: now };
  const retry_count = (prev?.retry_count ?? 0) + 1;
  const wait = outcome.retry_after ? outcome.retry_after * 1000 : Math.min(60, 2 ** (retry_count - 1)) * 60_000;
  return { status: outcome.status, retry_count, error: outcome.error?.slice(0, 300), retry_after: outcome.retry_after, next_retry_at: retry_count >= MAX_DELIVERY_ATTEMPTS ? null : new Date(now.getTime() + wait), updated_at: now };
}

/** The request that created a record sends its message right away; retries only pick it up after this grace period. */
export const FIRST_SEND_GRACE_MS = 60_000;
/** Initial delivery state for a new record. Backfills pass `alreadyDelivered` so they are never re-sent. */
export const initialDelivery = (alreadyDelivered: boolean, now = new Date()): DeliveryState =>
  alreadyDelivered ? { status: "sent", retry_count: 0, sent_at: now, next_retry_at: null, updated_at: now } : { status: "pending", retry_count: 0, next_retry_at: new Date(now.getTime() + FIRST_SEND_GRACE_MS), updated_at: now };
