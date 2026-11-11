-- Rollback for 20270128000007_whatsapp_unconfirmed_send_reconciliation.sql
--
-- Refuses while the audit holds rows, or while a ledger event carries a verified recipient:
-- dropping either would erase the only record of what was reconciled and why. Export first.
-- send_started_at is dropped with the rest; it is a timing hint, never evidence.

DO $wsr_rollback$
DECLARE
  v_rows boolean;
BEGIN
  IF to_regclass('public.whatsapp_send_reconciliations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.whatsapp_send_reconciliations)' INTO v_rows;
    IF v_rows THEN
      RAISE EXCEPTION 'whatsapp_send_reconciliations has rows; export them before rolling back';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.whatsapp_provider_events'::regclass
              AND attname = 'verified_recipient_id' AND NOT attisdropped) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.whatsapp_provider_events WHERE verified_recipient_id IS NOT NULL)' INTO v_rows;
    IF v_rows THEN
      RAISE EXCEPTION 'whatsapp_provider_events has verified recipients; export them before rolling back';
    END IF;
  END IF;
END
$wsr_rollback$;

DROP FUNCTION IF EXISTS public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid);
DROP FUNCTION IF EXISTS public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer);
DROP TABLE IF EXISTS public.whatsapp_send_reconciliations;
DROP FUNCTION IF EXISTS public.whatsapp_send_reconciliations_append_only();
DROP INDEX IF EXISTS public.idx_whatsapp_broadcast_recipients_unconfirmed;
DROP INDEX IF EXISTS public.idx_whatsapp_provider_events_verified_recipient;
ALTER TABLE public.whatsapp_provider_events DROP COLUMN IF EXISTS verified_recipient_id;
ALTER TABLE public.whatsapp_broadcast_recipients DROP COLUMN IF EXISTS send_started_at;
