-- Rollback of 20270120000002_whatsapp_broadcast_recipient_unique.sql.
-- Restores the defect: expandRecipients fails 42P10 again and no broadcast can gain a
-- recipient. Do not run this on a database where the constraint predated the migration:
-- it came from database/whatsapp_system.sql there, and this would remove it. No row changes.
ALTER TABLE public.whatsapp_broadcast_recipients DROP CONSTRAINT IF EXISTS unique_broadcast_recipient;
