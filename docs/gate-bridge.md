# GATE Railway Bridge Contract

The Railway bridge is a short-lived durable inbox. Job Hunt OS accesses it only
over HTTPS; neither the desktop app nor its users receive a Railway database URL
or database credential.

All routes require `Authorization: Bearer <GATE_INGEST_TOKEN>`.

## Import lifecycle

1. `GET /v1/opportunities?status=ready&limit=20` returns `{ "items": [{ "id", "fingerprint" }] }`.
2. `POST /v1/opportunities/:id/claim` atomically leases one ready row and returns
   `{ "id", "lease_token", "fingerprint", "envelope" }`, where `envelope` is one
   full canonical GATE 2.x object.
3. Job Hunt OS validates and stores the envelope in MongoDB through its normal
   idempotent GATE ingest path.
4. `POST /v1/opportunities/:id/ack` receives `gate_opportunity_id`, `fingerprint`,
   and `lease_token`, then changes the row to `imported`.

The bridge must reject ACKs for invalid or expired leases. Job Hunt OS never ACKs
before MongoDB persistence succeeds. A missing or failed ACK is retryable because
the MongoDB fingerprint prevents duplicate opportunities and preserves user-owned
GATE/Kanban status.

## Retention and deletion

Only `imported` rows may be deleted through `DELETE /v1/opportunities/:id`.
The bridge retains imported rows for 24 hours, then automatically removes them.
It never automatically deletes `ready`, `claimed`, or `failed` rows. Telegram is
sent by the bridge only after its durable PostgreSQL insert succeeds.
