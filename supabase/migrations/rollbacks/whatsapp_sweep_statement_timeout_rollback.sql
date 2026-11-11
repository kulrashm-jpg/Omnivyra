-- Rollback for 20270215000001_whatsapp_sweep_statement_timeout.sql.
--
-- Removes ONLY the statement_timeout from the four sweep functions; their search_path pin
-- (from 20270128000007) is kept. Without the timeout, a hung sweep statement abandoned by
-- the job's client-side race keeps running and holds its connection.

BEGIN;

ALTER FUNCTION public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer)
  RESET statement_timeout;
ALTER FUNCTION public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid)
  RESET statement_timeout;
ALTER FUNCTION public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid)
  RESET statement_timeout;
ALTER FUNCTION public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid)
  RESET statement_timeout;

COMMIT;
