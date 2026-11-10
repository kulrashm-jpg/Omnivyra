-- ============================================================================
-- Extension 1.5.0: account binding + write-submit evidence
-- (docs/outreach/platform/EXTENSION-1.5.0-CONTRACT.md §3, §5.4, §6)
-- Owner-approved 2026-11-10 (E-1..E-4). Version reserved by Release-controls
-- (virality-83). LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- 1. extension_account_bindings: one ACTIVE binding of an Omnivyra user to the
--    LinkedIn member the extension is logged in as, per (org, user, platform).
--    A different member for an active binding is refused by the writer
--    (409 ACCOUNT_BINDING_CONFLICT); an org admin revokes first. Rows are
--    never deleted by the application: revocation stamps revoked_at/revoked_by.
--    user_id and revoked_by carry NO foreign key into public.users: revoked_by
--    is actor attribution (GOV-H: must survive actor deletion; nullable, since a
--    system revocation has no human actor), and user_id is validated by the
--    writer. organization ownership: FK to companies ON DELETE CASCADE.
-- 2. community_ai_actions: submit_attempted_at (the point after which a write is
--    never retried: uncertain, not failed), the acting member, and pre/post
--    submit evidence. Additive; the table's existing grants carry over.
--
-- Privileges (owner #23/#29 layer 2; #26 n/a: no view): RLS on; REVOKE ALL FROM
-- PUBLIC, anon, authenticated, both client roles named; explicit GRANT to
-- service_role pinned by a postcondition. Postconditions RAISE (each names its trigger):
--   P1 a client role holds any table privilege on extension_account_bindings
--   P2 a client role holds any column privilege on extension_account_bindings
--   P3 service_role lacks SELECT/INSERT/UPDATE on extension_account_bindings
--   P4 RLS is not enabled on extension_account_bindings
--   P5 the active-binding unique index is missing
--   P6 any of the four community_ai_actions columns is missing
-- Re-runnable. Rollback: rollbacks/extension_account_binding_and_submit_evidence_rollback.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL OR to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'extension binding: community_ai_actions or companies is absent';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.extension_account_bindings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL,
  platform          text        NOT NULL CHECK (platform IN ('linkedin')),
  acting_member_urn text        NOT NULL CHECK (acting_member_urn ~ '^urn:li:fsd_profile:[A-Za-z0-9_-]{6,128}$'),
  bound_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_by        uuid,
  CONSTRAINT extension_account_bindings_revocation_consistent
    CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_extension_account_bindings_active
  ON public.extension_account_bindings (org_id, user_id, platform)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_extension_account_bindings_member
  ON public.extension_account_bindings (org_id, platform, acting_member_urn)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.extension_account_bindings IS
  'Extension 1.5.0: the LinkedIn member an Omnivyra user''s extension acts as (one active binding per org, user, platform). Revocation stamps revoked_at/revoked_by; rows are never deleted by the application.';

ALTER TABLE public.extension_account_bindings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.extension_account_bindings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.extension_account_bindings TO service_role;

ALTER TABLE public.community_ai_actions
  ADD COLUMN IF NOT EXISTS submit_attempted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS acting_member_urn    text,
  ADD COLUMN IF NOT EXISTS pre_submit_evidence  jsonb,
  ADD COLUMN IF NOT EXISTS post_submit_evidence jsonb;

COMMENT ON COLUMN public.community_ai_actions.submit_attempted_at IS
  'Extension 1.5.0: written by /api/extension/authorize-submit immediately before the extension submits. Once set, a lost outcome is uncertain, never retried.';

DO $$
DECLARE
  r text;
  p text;
  privs text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  held text[] := ARRAY[]::text[];
  missing text[];
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    privs := array_append(privs, 'MAINTAIN');
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN CONTINUE; END IF;
    FOREACH p IN ARRAY privs LOOP
      IF has_table_privilege(r, 'public.extension_account_bindings', p) THEN
        held := held || format('%s %s', r, p);                                     -- P1
      END IF;
    END LOOP;
    IF has_any_column_privilege(r, 'public.extension_account_bindings', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
      held := held || format('%s column-privilege', r);                            -- P2
    END IF;
  END LOOP;
  IF array_length(held, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'extension binding postcondition P1/P2: client roles still hold: %', array_to_string(held, '; ');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND NOT (
       has_table_privilege('service_role', 'public.extension_account_bindings', 'SELECT')
   AND has_table_privilege('service_role', 'public.extension_account_bindings', 'INSERT')
   AND has_table_privilege('service_role', 'public.extension_account_bindings', 'UPDATE')) THEN
    RAISE EXCEPTION 'extension binding postcondition P3: service_role lacks SELECT/INSERT/UPDATE';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.extension_account_bindings'::regclass) THEN
    RAISE EXCEPTION 'extension binding postcondition P4: RLS is not enabled';
  END IF;

  IF to_regclass('public.uq_extension_account_bindings_active') IS NULL THEN
    RAISE EXCEPTION 'extension binding postcondition P5: active-binding unique index missing';
  END IF;

  SELECT array_agg(c) INTO missing
    FROM unnest(ARRAY['submit_attempted_at', 'acting_member_urn', 'pre_submit_evidence', 'post_submit_evidence']) c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'community_ai_actions' AND column_name = c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'extension binding postcondition P6: community_ai_actions missing %', array_to_string(missing, ', ');
  END IF;
END
$$;

COMMIT;
