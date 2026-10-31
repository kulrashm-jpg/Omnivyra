-- Rollback for 20270111000000_canonical_leads_users_client_privileges_revoked.sql.
--
-- Restores production's pre-change ACL on canonical_leads and canonical_users
-- exactly as captured read-only on 2026-10-30T20:12Z:
--   anon=arwdxtm, authenticated=arwdxtm, service_role=arwdDxtm
-- (SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN for the client
-- roles; TRUNCATE stays revoked, as 20261026000000 left it). Policies were not
-- changed by the forward migration, so nothing else is restored.
--
-- This RE-OPENS the latent exposure documented in the forward migration. Use it
-- only to restore service, and only if a client-role path that the audit did not
-- find turns out to depend on these grants.

BEGIN;

-- grant-ok: rollback restores the exact pre-SEC-A1 production ACL
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, MAINTAIN
  ON TABLE public.canonical_leads, public.canonical_users TO anon, authenticated;
GRANT ALL ON TABLE public.canonical_leads, public.canonical_users TO service_role;

DO $rollback$
DECLARE
  t text;
  r text;
  p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canonical_leads', 'canonical_users'] LOOP
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        IF NOT has_table_privilege(r, ('public.' || t)::regclass, p) THEN
          RAISE EXCEPTION 'SEC-A1 rollback: % lacks % on public.% after restore', r, p, t;
        END IF;
      END LOOP;
      IF has_table_privilege(r, ('public.' || t)::regclass, 'TRUNCATE') THEN
        RAISE EXCEPTION 'SEC-A1 rollback: % holds TRUNCATE on public.%, which production never had after 3AH-70', r, t;
      END IF;
    END LOOP;
  END LOOP;
END
$rollback$;

COMMIT;
