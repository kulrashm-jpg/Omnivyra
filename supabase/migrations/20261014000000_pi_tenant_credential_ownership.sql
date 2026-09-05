-- A3M — tenant-owned provider credentials for Prospect Intelligence.
--
-- A3L found the defect this migration exists to make fixable: PI resolved
-- provider credentials from `process.env` and nothing else, so the moment any
-- provider key were configured, EVERY tenant would silently share Omnivyra's
-- key and Omnivyra's bill. The fix is tenant-owned credentials — but
-- `integration_credentials` could not hold one, because its only owner is a
-- `website_connections` row and a PI provider is not a website.
--
-- ─── WHY NOT A SYNTHETIC WEBSITE CONNECTION ────────────────────────────────
-- The shortcut is to create one `website_connections` row per provider per
-- tenant and hang the credential off that. It would work today and would be
-- wrong: `website_connections` would stop meaning "a website this tenant
-- connected", and `assertConnectionBelongsToCompany`'s three-hop resolution
-- (credential -> connection -> website -> company) would be walking a chain
-- that no longer describes anything real. A credential store whose ownership
-- chain is fiction cannot be audited.
--
-- ─── WHY NOT A POLYMORPHIC OWNER ───────────────────────────────────────────
-- The other shortcut is (owner_type, owner_id) with no foreign key. That buys
-- generality by giving up referential integrity on the one table where a
-- dangling row means an orphaned SECRET. Instead this adds a SECOND, fully
-- constrained ownership path beside the existing one, and a CHECK that admits
-- exactly one of them. Both paths keep a real foreign key.
--
-- ─── THE TWO OWNERSHIP PATHS ───────────────────────────────────────────────
--   website path (existing, untouched):  connection_id -> website_connections
--   provider path (new):                 company_id    -> companies
--                                        + provider_key (the A3C source id)
--
-- The provider path resolves a tenant in ONE hop instead of three, which is
-- the point: the shorter the ownership proof, the harder it is to get wrong.
--
-- ─── ADDITIVE AND SAFE FOR EXISTING ROWS ───────────────────────────────────
-- All 5 existing rows carry a non-null `connection_id` and will carry NULL in
-- both new columns, so every one of them satisfies the first branch of the
-- CHECK. Dropping NOT NULL from `connection_id` widens nothing on its own: the
-- CHECK immediately re-narrows it, and a row with no owner at all is now
-- IMPOSSIBLE where previously only the connection path was enforced.
--
-- ─── TENANT SAFETY ─────────────────────────────────────────────────────────
-- No RLS change. `integration_credentials` remains service-role-only, which is
-- deliberate (A3L §19): no `anon`/`authenticated` policy means no client can
-- reach the credential store directly at all, and every access is forced
-- through a server route that proves tenancy itself. Adding a tenant policy to
-- support Company Admin writes would WIDEN the credential surface; the service
-- layer proves ownership instead.
--
-- Re-runnable: `IF NOT EXISTS` throughout, and the CHECK is added inside a
-- guard because Postgres has no `ADD CONSTRAINT IF NOT EXISTS`.

ALTER TABLE public.integration_credentials
  ALTER COLUMN connection_id DROP NOT NULL;

ALTER TABLE public.integration_credentials
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.integration_credentials
  ADD COLUMN IF NOT EXISTS provider_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.integration_credentials'::regclass
      AND conname  = 'integration_credentials_one_owner'
  ) THEN
    ALTER TABLE public.integration_credentials
      ADD CONSTRAINT integration_credentials_one_owner CHECK (
        (connection_id IS NOT NULL AND company_id IS NULL     AND provider_key IS NULL)
     OR (connection_id IS NULL     AND company_id IS NOT NULL AND provider_key IS NOT NULL)
      );
  END IF;
END $$;

-- A provider key must be a real key, for the same reason `credential_key`
-- already carries this constraint: a blank string is not an identifier and
-- would let two different providers collide in the unique index below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.integration_credentials'::regclass
      AND conname  = 'integration_credentials_provider_key_not_blank'
  ) THEN
    ALTER TABLE public.integration_credentials
      ADD CONSTRAINT integration_credentials_provider_key_not_blank CHECK (
        provider_key IS NULL OR length(btrim(provider_key)) > 0
      );
  END IF;
END $$;

-- One credential per (tenant, provider, key). Partial, so it does not touch
-- the existing website-path rows and cannot collide with them.
CREATE UNIQUE INDEX IF NOT EXISTS integration_credentials_provider_unique
  ON public.integration_credentials (company_id, provider_key, credential_key)
  WHERE company_id IS NOT NULL;
