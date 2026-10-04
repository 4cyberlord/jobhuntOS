CREATE TABLE IF NOT EXISTS gate_journal (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  gate_opportunity_id TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS gate_journal_state_updated_idx ON gate_journal (state, updated_at);
