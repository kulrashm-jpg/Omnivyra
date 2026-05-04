-- Token refresh distributed lock.
--
-- Purpose: prevent two workers (e.g. verify-config endpoint + connector cron)
-- from concurrently refreshing the same X token. Without this, both workers
-- read the same refresh_token, X rotates it on the first call, and the
-- losing writer overwrites the winner's rotated token, destroying the
-- single-use refresh_token.
--
-- Mechanism: insert-or-take-stale on a unique lock_key. TTL is enforced by
-- the caller comparing acquired_at against now-30s.

CREATE TABLE IF NOT EXISTS token_refresh_locks (
  lock_key    TEXT PRIMARY KEY,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acquired_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_refresh_locks_acquired_at
  ON token_refresh_locks (acquired_at);
