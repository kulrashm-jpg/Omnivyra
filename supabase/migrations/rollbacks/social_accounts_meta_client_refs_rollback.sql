-- Rollback of 20270125000004_social_accounts_meta_client_refs.sql.
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- Restores WA-2: metaAuthService's select fails again. Do not run this on a database
-- where the columns predated the migration (from database/whatsapp_system.sql): it would
-- drop them and any references they hold. One transaction.

BEGIN;

ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_auth_client_id_ref_safe,
  DROP CONSTRAINT IF EXISTS social_accounts_auth_client_secret_ref_safe,
  DROP COLUMN IF EXISTS auth_client_id_ref,
  DROP COLUMN IF EXISTS auth_client_secret_ref;

COMMIT;
