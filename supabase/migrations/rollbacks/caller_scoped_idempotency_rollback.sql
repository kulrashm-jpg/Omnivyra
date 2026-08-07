-- Rollback for 20260916000000_caller_scoped_idempotency.sql (OR-09).
--
-- Restores caller-blind idempotency. Doing so REINSTATES the replay-before-
-- authorization exposure that migration was written to close, so it should only
-- be run as part of reverting the middleware change in the same operation.
--
-- ORDER MATTERS: revert backend/middleware/withIdempotency.ts FIRST. While the
-- caller-scoped middleware is live, running this script narrows storage back to
-- a shape the running code does not expect.
--
-- PRE-FLIGHT — the old UNIQUE cannot be restored if any duplicate exists:
--
--   SELECT scope, idempotency_key, COUNT(*)
--   FROM api_idempotency_keys
--   GROUP BY scope, idempotency_key
--   HAVING COUNT(*) > 1;
--
-- Any rows returned are records two distinct callers created under the same key
-- while caller scoping was live — exactly the case the old constraint could not
-- represent. Resolve them deliberately (keep the newest, or delete both and let
-- the callers retry) before proceeding. Do not delete blindly: a completed row
-- is the stored response for a request that already executed.

ALTER TABLE api_idempotency_keys
  ADD CONSTRAINT api_idempotency_keys_scope_idempotency_key_key
  UNIQUE (scope, idempotency_key);

DROP INDEX IF EXISTS api_idempotency_keys_caller_scoped_key;

-- `caller_id` is deliberately LEFT IN PLACE. It is nullable and unread by the
-- reverted middleware, so retaining it is harmless and preserves the forensic
-- record of which principal created each row. Drop it only if the revert is
-- being made permanent:
--   ALTER TABLE api_idempotency_keys DROP COLUMN IF EXISTS caller_id;
