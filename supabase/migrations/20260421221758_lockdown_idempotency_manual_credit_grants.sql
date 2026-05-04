-- Reconstructed by Phase B0 on 2026-05-03
-- Source: supabase_migrations.schema_migrations (canonical, applied via supabase db push)
-- Version: 20260421221758  Name: lockdown_idempotency_manual_credit_grants
-- Idempotency: GUARDED.

ALTER TABLE manual_credit_grants
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS manual_credit_grants_idempotency_key_unique
  ON manual_credit_grants (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
