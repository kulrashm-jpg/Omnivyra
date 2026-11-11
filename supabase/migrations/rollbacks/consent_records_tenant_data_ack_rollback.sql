-- ROLLBACK for 20270209000002_consent_records_tenant_data_ack.sql
--
-- Restores consent_records_capability_check to the 7 capability values of
-- 20260514. REFUSES if any 'tenant_data_controller_ack' row exists: the ledger
-- is append-only (DELETE is blocked by trigger), so those rows cannot be
-- removed, and the narrowed CHECK could never be validated against them. Once
-- acceptances exist, this change is forward-only by design - an acceptance is
-- an audit record and is never deleted. Grants nothing.

BEGIN;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.consent_records WHERE capability = 'tenant_data_controller_ack') THEN
    RAISE EXCEPTION 'consent ack rollback REFUSED: tenant_data_controller_ack acceptances exist in the append-only ledger and cannot be removed';
  END IF;
END
$guard$;

ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_capability_check;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_capability_check
  CHECK (capability IN (
    'publish', 'listen', 'monitor_competitors',
    'ingest_dms', 'ingest_comments', 'ingest_mentions', 'ingest_communities'
  ));

COMMIT;
