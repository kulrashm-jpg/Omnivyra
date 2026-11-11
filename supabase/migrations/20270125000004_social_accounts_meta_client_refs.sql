-- WhatsApp / Meta (closure D, WA-2): the two columns `getSocialAccountAuthContext` has
-- always selected, so the select stops failing, constrained so they can never hold a
-- plaintext secret or name an arbitrary environment variable.
--
-- NOT APPLIED ANYWHERE. Written for, and tested only on, a disposable test database.
-- Applying it to any real environment needs a separate owner decision. WhatsApp stays
-- BLOCKED (owner ruling, Checkpoint 1): this removes one failure (WA-2) and enables no
-- send; WA-1, WA-3, L-4 and CR-X-01 still stand between it and Meta.
--
-- THE DEFECT. backend/auth/metaAuthService.ts:70 selects `auth_client_id_ref` and
-- `auth_client_secret_ref`. They are defined only in database/whatsapp_system.sql, which
-- is outside the migration chain, so on a governed schema the select fails and every
-- Meta auth context throws "Social account not found" (ENGINE-READINESS-D7.md §2.2).
--
-- WHY THE CHECKS. `resolveClientRef` (metaAuthService.ts:52-59) treats ANY upper-case
-- value as an environment variable NAME and returns that variable, which is then sent to
-- Meta as the OAuth client id or secret. Unconstrained, a row naming e.g.
-- SUPABASE_SERVICE_ROLE_KEY or ENCRYPTION_KEY would send that secret to a third party;
-- any other value would be stored and sent as plaintext. So each column accepts only:
--   * NULL (the code then falls back to its own fixed env names), or
--   * one of the SAME fixed Meta env names the code already falls back to, or
--   * an AES-256-GCM envelope in this codebase's credential format
--     (`<24 hex iv>:<32 hex tag>:<hex>`, credentialEncryption.ts / credentialSafety.ts).
-- The code-side half (allow-list the names in resolveClientRef and decrypt an envelope
-- rather than send it as-is) is a recorded follow-up; the database refuses the dangerous
-- values in the meantime.
--
-- `social_accounts` already holds tokens and is reachable by service_role only (RLS
-- policy `service_role_full_access`); adding columns does not change that. No existing
-- row changes: both columns are NULL on every current row.
--
-- Rollback: supabase/migrations/rollbacks/social_accounts_meta_client_refs_rollback.sql

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS auth_client_id_ref text,
  ADD COLUMN IF NOT EXISTS auth_client_secret_ref text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.social_accounts'::regclass
                    AND conname = 'social_accounts_auth_client_id_ref_safe') THEN
    ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_auth_client_id_ref_safe CHECK (
      auth_client_id_ref IS NULL
      OR auth_client_id_ref IN ('WHATSAPP_APP_ID', 'META_APP_ID', 'META_CLIENT_ID')
      OR auth_client_id_ref ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$'
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.social_accounts'::regclass
                    AND conname = 'social_accounts_auth_client_secret_ref_safe') THEN
    ALTER TABLE public.social_accounts ADD CONSTRAINT social_accounts_auth_client_secret_ref_safe CHECK (
      auth_client_secret_ref IS NULL
      OR auth_client_secret_ref IN ('WHATSAPP_APP_SECRET', 'META_APP_SECRET', 'META_CLIENT_SECRET')
      OR auth_client_secret_ref ~ '^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$'
    ) NOT VALID;
  END IF;
  -- A database that ran database/whatsapp_system.sql may already hold values; validating
  -- here refuses the migration (and names the constraint) rather than keep an unsafe one.
  ALTER TABLE public.social_accounts VALIDATE CONSTRAINT social_accounts_auth_client_id_ref_safe;
  ALTER TABLE public.social_accounts VALIDATE CONSTRAINT social_accounts_auth_client_secret_ref_safe;
END
$$;
