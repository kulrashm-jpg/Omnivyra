-- communication_registry idempotency key (WS-2B)
-- Canonical Communication Registration (OMNIVYRA · Zone A2 · Intelligence & Egress).
--
-- Adds the idempotency key that makes registerCommunication(...) replay-/retry-safe:
-- a duplicate registration with the same (company_id, idempotency_key) collapses onto
-- the existing row instead of inserting a duplicate. The unique index is PARTIAL
-- (WHERE idempotency_key IS NOT NULL) so pre-WS-2B rows (null key) are unaffected.
--
-- Additive + reversible (DROP INDEX / DROP COLUMN). Metadata only; no runtime behaviour
-- change (persistence is opt-in via COORDINATION_REGISTRY_PERSIST_ENABLED and the pipeline
-- is dark by default). Depends on 20260720120000 (communication_registry).
-- Application: manual SQL-editor apply, then verify with scripts/verify-schema-parity.js.

ALTER TABLE public.communication_registry ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Replay safety: one row per (company, idempotency_key). Partial ⇒ legacy null-key rows
-- (and any intentionally non-idempotent event) are never constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comm_registry_company_idempotency
  ON public.communication_registry (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
