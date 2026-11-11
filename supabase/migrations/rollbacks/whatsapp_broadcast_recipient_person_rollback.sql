-- ROLLBACK — Outreach: the person behind a journey broadcast recipient.
-- Reverses supabase/migrations/20270128000004_whatsapp_broadcast_recipient_person.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- WHAT IT GIVES UP. The send-time check returns to number-only: a person-level restriction
-- no longer stops a journey broadcast to a number without its own restriction. The person
-- identities written on recipients are DROPPED with the columns and cannot be restored by
-- re-applying the forward migration. Deploy the application without expandPersonRecipients
-- and the person-aware processBatch BEFORE running this, or the writer fails on a missing column.
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DROP TRIGGER IF EXISTS trg_whatsapp_broadcast_recipients_person_guard ON public.whatsapp_broadcast_recipients;
DROP FUNCTION IF EXISTS public.whatsapp_broadcast_recipients_person_guard();
ALTER TABLE public.whatsapp_broadcast_recipients DROP CONSTRAINT IF EXISTS whatsapp_broadcast_recipients_person_tenant_fk;
DROP INDEX IF EXISTS public.idx_whatsapp_broadcast_recipients_person;
ALTER TABLE public.whatsapp_broadcast_recipients
  DROP COLUMN IF EXISTS person_company_id,
  DROP COLUMN IF EXISTS person_id;

COMMIT;
