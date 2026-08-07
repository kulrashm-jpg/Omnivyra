-- OR-09 — caller-scoped idempotency.
--
-- PROBLEM (repository-proven)
-- `withIdempotency` performs its replay lookup BEFORE the handler runs, and
-- every adopting route authorizes INSIDE its handler. On a completed replay the
-- middleware returns the stored response and the handler never executes, so all
-- authorization is skipped. Because the cache was keyed only by
-- (scope, idempotency_key) — no caller identity — any caller presenting a valid
-- key with a byte-identical payload received another caller's stored response.
--
-- FIX
-- Scope the record to the authenticated principal. A cache entry then belongs to
-- exactly one caller, so cross-caller replay is impossible by construction and
-- the middleware's position relative to authorization stops mattering.
--
-- This requires only AUTHENTICATION (who is this), never AUTHORIZATION (may they
-- access this tenant) — which is why it does not need the async, resource-derived
-- tenant lookup that made the alternative approaches unworkable.
--
-- ADDITIVE + REVERSIBLE
--   * `caller_id` is nullable, so existing rows are preserved untouched.
--   * The uniqueness constraint moves from (scope, idempotency_key) to
--     (scope, caller_id, idempotency_key). Replacing it is the point of the
--     change: while the old constraint stood, two different callers using the
--     same key would collide on INSERT even though caller-scoped lookup treats
--     them as distinct records.
--   * Rollback: drop the new index, restore the old constraint. See
--     supabase/migrations/rollbacks/ for the paired script.
--     CAVEAT: if two callers have since stored the same (scope, idempotency_key),
--     restoring the old UNIQUE will fail until one row is removed. That is
--     inherent to narrowing a uniqueness constraint and is documented, not hidden.

ALTER TABLE api_idempotency_keys
  ADD COLUMN IF NOT EXISTS caller_id TEXT;

COMMENT ON COLUMN api_idempotency_keys.caller_id IS
  'Authenticated principal id (AuthenticatedPrincipal.userId) that created this record. '
  'NULL only on rows written before OR-09; the middleware never writes NULL — a request '
  'whose principal cannot be resolved is rejected rather than stored unscoped.';

-- New caller-inclusive uniqueness. NULLs compare as distinct in Postgres, which
-- is acceptable here: no new row can carry a NULL caller_id (the middleware
-- fails closed), so only pre-existing rows hold NULL and they are historical.
CREATE UNIQUE INDEX IF NOT EXISTS api_idempotency_keys_caller_scoped_key
  ON api_idempotency_keys (scope, caller_id, idempotency_key);

-- Retire the caller-blind constraint. It must go: it would reject a second
-- caller's INSERT for a key the new lookup considers unrelated, stranding that
-- request in a state the middleware cannot resolve.
ALTER TABLE api_idempotency_keys
  DROP CONSTRAINT IF EXISTS api_idempotency_keys_scope_idempotency_key_key;
