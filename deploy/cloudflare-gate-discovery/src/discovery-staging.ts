export type StagingCandidate = {
  url: string;
  title?: string;
  source: string;
  discovered_at: string;
  company_id?: string;
  company_name?: string;
  allowed_host?: string;
};

export type StageInput = {
  url: string;
  title?: string;
  company?: string;
  provider: string;
  query?: string;
  priority?: number;
};

const sha256 = async (value: string) =>
  `sha256:${[...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, "0")).join("")}`;

export const canonicalizeDiscoveryUrl = (value: string) => {
  const u = new URL(value);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|gh_src$|source$|src$|ref$)/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
};

export async function stageDiscoveryCandidates(db: D1Database, inputs: StageInput[]) {
  let received = 0, inserted = 0, refreshed = 0, alreadyKnown = 0;
  for (const input of inputs) {
    received++;
    const url = canonicalizeDiscoveryUrl(input.url);
    const hash = await sha256(url);
    const existingJournal = await db.prepare(
      "SELECT state FROM gate_journal WHERE url_hash = ?"
    ).bind(hash).first<{ state: string }>();
    const existing = await db.prepare(
      "SELECT status FROM discovery_candidates WHERE url_hash = ?"
    ).bind(hash).first<{ status: string }>();
    const status = existingJournal ? "already_known" : (existing?.status ?? "pending");

    if (existing) {
      await db.prepare(
        `UPDATE discovery_candidates
         SET last_seen_at = unixepoch(),
             discovered_count = discovered_count + 1,
             title_hint = COALESCE(title_hint, ?),
             company_hint = COALESCE(company_hint, ?),
             priority = MAX(priority, ?),
             status = CASE WHEN ? = 'already_known' THEN 'already_known' ELSE status END
         WHERE url_hash = ?`
      ).bind(input.title ?? null, input.company ?? null, input.priority ?? 100, status, hash).run();
      refreshed++;
    } else {
      await db.prepare(
        `INSERT INTO discovery_candidates
         (url_hash, canonical_url, title_hint, company_hint, status, priority, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`
      ).bind(hash, url, input.title ?? null, input.company ?? null, status, input.priority ?? 100).run();
      inserted++;
    }

    await db.prepare(
      `INSERT INTO discovery_sources(candidate_hash, provider, query_hint, first_seen_at, last_seen_at, seen_count)
       VALUES (?, ?, ?, unixepoch(), unixepoch(), 1)
       ON CONFLICT(candidate_hash, provider) DO UPDATE SET
         last_seen_at = unixepoch(),
         seen_count = seen_count + 1,
         query_hint = COALESCE(excluded.query_hint, discovery_sources.query_hint)`
    ).bind(hash, input.provider.slice(0, 80), input.query?.slice(0, 500) ?? null).run();

    if (existingJournal) alreadyKnown++;
  }
  return { received, inserted, refreshed, already_known: alreadyKnown };
}

async function reclaimExpiredLeases(db: D1Database) {
  await db.prepare(
    `UPDATE discovery_candidates
     SET status='pending', claimed_at=NULL, lease_expires_at=NULL,
         last_error=COALESCE(last_error, 'lease_expired')
     WHERE status='claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < unixepoch()`
  ).run();
}

export async function drainDiscoveryStaging(
  db: D1Database,
  queue: Queue<StagingCandidate>,
  limit = 5
) {
  await reclaimExpiredLeases(db);
  const rows = await db.prepare(
    `SELECT url_hash, canonical_url, title_hint, company_hint, attempts
     FROM discovery_candidates
     WHERE status IN ('pending','retrying') AND attempts < 12
     ORDER BY priority DESC, first_seen_at ASC
     LIMIT ?`
  ).bind(Math.max(1, Math.min(limit, 25))).all<{
    url_hash: string; canonical_url: string; title_hint: string | null;
    company_hint: string | null; attempts: number;
  }>();

  let claimed = 0, queued = 0, skippedKnown = 0, failed = 0;
  for (const row of rows.results ?? []) {
    const journal = await db.prepare(
      "SELECT state FROM gate_journal WHERE url_hash = ?"
    ).bind(row.url_hash).first<{ state: string }>();
    if (journal) {
      await db.prepare(
        "UPDATE discovery_candidates SET status='already_known', completed_at=unixepoch(), lease_expires_at=NULL WHERE url_hash=?"
      ).bind(row.url_hash).run();
      skippedKnown++;
      continue;
    }

    const claim = await db.prepare(
      `UPDATE discovery_candidates
       SET status='claimed', claimed_at=unixepoch(), lease_expires_at=unixepoch()+300, attempts=attempts+1
       WHERE url_hash=? AND status IN ('pending','retrying')`
    ).bind(row.url_hash).run();
    if (!claim.meta.changes) continue;
    claimed++;

    try {
      await queue.send({
        url: row.canonical_url,
        title: row.title_hint ?? undefined,
        source: "staging",
        discovered_at: new Date().toISOString(),
        company_name: row.company_hint ?? undefined,
      });
      await db.prepare(
        "UPDATE discovery_candidates SET status='queued', queued_at=unixepoch(), lease_expires_at=NULL, last_error=NULL WHERE url_hash=?"
      ).bind(row.url_hash).run();
      queued++;
    } catch (error) {
      await db.prepare(
        "UPDATE discovery_candidates SET status='retrying', lease_expires_at=NULL, last_error=? WHERE url_hash=?"
      ).bind(String(error instanceof Error ? error.message : error).slice(0, 1000), row.url_hash).run();
      failed++;
    }
  }
  return { claimed, queued, already_known: skippedKnown, failed };
}

export async function markStagingOutcome(
  db: D1Database,
  url: string,
  status: "completed" | "retrying" | "rejected",
  error?: string
) {
  const hash = await sha256(canonicalizeDiscoveryUrl(url));
  await db.prepare(
    `UPDATE discovery_candidates
     SET status=?,
         completed_at=CASE WHEN ? IN ('completed','rejected') THEN unixepoch() ELSE completed_at END,
         lease_expires_at=NULL,
         last_error=?
     WHERE url_hash=?`
  ).bind(status, status, error?.slice(0, 1000) ?? null, hash).run();
}

export async function stagingStatus(db: D1Database) {
  const rows = await db.prepare(
    "SELECT status, COUNT(*) AS count FROM discovery_candidates GROUP BY status"
  ).all<{ status: string; count: number }>();
  const providers = await db.prepare(
    `SELECT provider, SUM(seen_count) AS seen_count, COUNT(*) AS unique_candidates
     FROM discovery_sources GROUP BY provider ORDER BY unique_candidates DESC`
  ).all<{ provider: string; seen_count: number; unique_candidates: number }>();
  const counts = Object.fromEntries((rows.results ?? []).map((r) => [r.status, Number(r.count)]));
  return {
    generated_at: new Date().toISOString(),
    counts,
    total: Object.values(counts).reduce((a, b) => a + Number(b), 0),
    providers: providers.results ?? [],
  };
}
