CREATE TABLE IF NOT EXISTS discovery_candidates (
  url_hash TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  title_hint TEXT,
  company_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  discovered_count INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  lease_expires_at INTEGER,
  queued_at INTEGER,
  completed_at INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status_priority
  ON discovery_candidates(status, priority DESC, first_seen_at ASC);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_lease
  ON discovery_candidates(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS discovery_sources (
  candidate_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  query_hint TEXT,
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  seen_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(candidate_hash, provider),
  FOREIGN KEY(candidate_hash) REFERENCES discovery_candidates(url_hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discovery_sources_provider
  ON discovery_sources(provider, last_seen_at DESC);
