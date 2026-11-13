-- Rollback of 20270217000040_provider_invoice_imports_one_per_period.sql (6f).
-- Drops the partial unique index and recreates the non-unique idx_pii_period exactly as 20260711 defined it.
-- After this, a second cost invoice for one (provider, period) is refused by the application alone
-- (reconciliationPersist) - the check-then-insert race for identical bounds is open again.
-- The privilege statements of 040 restate the posture that already existed (anon / authenticated revoked by
-- 20261026000000; service_role SELECT, INSERT - hosted Supabase grants it ALL) and are deliberately NOT reverted:
-- revoking from service_role would break the reconcilers.
DROP INDEX IF EXISTS public.provider_invoice_imports_one_per_period_uidx;
CREATE INDEX IF NOT EXISTS idx_pii_period
  ON public.provider_invoice_imports (provider, period_start, period_end);

DO $verify$
BEGIN
  IF to_regclass('public.provider_invoice_imports_one_per_period_uidx') IS NOT NULL THEN
    RAISE EXCEPTION '040 rollback: provider_invoice_imports_one_per_period_uidx still exists';
  END IF;
  IF to_regclass('public.idx_pii_period') IS NULL THEN
    RAISE EXCEPTION '040 rollback: idx_pii_period was not recreated';
  END IF;
END
$verify$;
