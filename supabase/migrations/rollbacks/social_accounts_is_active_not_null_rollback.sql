-- Rollback for 20270216000002_social_accounts_is_active_not_null.sql.
--
-- Makes social_accounts.is_active nullable again (DEFAULT true is unchanged). After this the
-- WhatsApp disconnected-account guard's `is_active === false` again lets a NULL row send, as it
-- did before the migration.

BEGIN;

ALTER TABLE public.social_accounts ALTER COLUMN is_active DROP NOT NULL;

COMMIT;
