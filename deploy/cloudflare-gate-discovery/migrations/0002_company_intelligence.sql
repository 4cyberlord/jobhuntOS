CREATE TABLE IF NOT EXISTS gate_companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  legal_name TEXT,
  state TEXT,
  website TEXT,
  industry TEXT,
  technical_employer INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  next_check_at INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS gate_companies_due_idx
  ON gate_companies (active, next_check_at, priority);

CREATE TABLE IF NOT EXISTS gate_career_sources (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  source_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'discovered',
  active INTEGER NOT NULL DEFAULT 1,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  last_http_status INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(company_id, url),
  FOREIGN KEY(company_id) REFERENCES gate_companies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS gate_career_sources_company_idx
  ON gate_career_sources (company_id, active);

CREATE INDEX IF NOT EXISTS gate_career_sources_host_idx
  ON gate_career_sources (host, active);
