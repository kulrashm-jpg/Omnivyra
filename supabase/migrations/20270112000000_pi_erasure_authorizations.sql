-- PI / person erasure — transaction-scoped AUTHORIZATION for sanctioned
-- erasure writes on otherwise-immutable or invariant-guarded tables.
--
-- WHY. Three tables refuse the writes a person erasure has to make:
--   * prospect_score_evaluations — BEFORE UPDATE trigger refuses every UPDATE
--     (append-only), so the person FK's ON DELETE SET NULL aborts the delete;
--   * leads — unified_person_id is NOT NULL while leads_person_tenant_fk is
--     ON DELETE SET NULL (unified_person_id), so the delete aborts (23502);
--   * (owner-selectable, later migrations) legacy lead redaction and the
--     outreach_decisions person reference.
-- Each needs ONE narrowly scoped exception that only the erasure flow can use.
--
-- THE SIGNAL. A row in public.pi_erasure_authorizations keyed by the CURRENT
-- transaction id (pg_current_xact_id()), a scope, a tenant and a person. The
-- guard triggers admit their sanctioned change only while such a row exists for
-- their own transaction, tenant and person. Why this and not a GUC/session flag:
--   * a custom GUC (set_config('x.y', ...)) can be set by ANY role with SQL
--     access, service_role included — it is a client-controlled flag;
--   * this table is owned by the migration owner, has RLS enabled with NO
--     policy, and every privilege is revoked from PUBLIC, anon, authenticated
--     AND service_role. Only SECURITY DEFINER functions owned by the migration
--     owner can write it, and none of those is executable by a client role
--     except through pi_person_erasure_finalize (20270112000003), which writes
--     authorizations only for the person it is deleting in the same transaction;
--   * the key is the transaction id: a row is useless to any other transaction,
--     disappears with a rollback, and the writer deletes it before it returns.
--     xid8 is epoch-extended and never wraps, so a stale row can never match a
--     later transaction.
--
-- No general bypass: there is no "erasure mode". A trigger admits exactly one
-- shape of change for exactly the (tenant, person) authorized, and nothing for
-- anyone else in the same transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pi_erasure_authorizations (
  xact_id         xid8        NOT NULL DEFAULT pg_current_xact_id(),
  scope           text        NOT NULL,
  organization_id uuid        NOT NULL,
  person_id       uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pi_erasure_authorizations_pk PRIMARY KEY (xact_id, scope, organization_id, person_id),
  CONSTRAINT pi_erasure_authorizations_scope_shape CHECK (scope ~ '^[a-z][a-z_]{2,62}$')
);

ALTER TABLE public.pi_erasure_authorizations ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy: nobody but the owner (and superusers) can see a row.
REVOKE ALL ON TABLE public.pi_erasure_authorizations FROM PUBLIC;
DO $revoke$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.pi_erasure_authorizations FROM %I', r);
    END IF;
  END LOOP;
END
$revoke$;

COMMENT ON TABLE public.pi_erasure_authorizations IS
  'Transaction-scoped authorization for sanctioned person-erasure writes. Written only by '
  'owner SECURITY DEFINER functions; no client role holds any privilege. A row is valid only '
  'inside the transaction whose pg_current_xact_id() it carries.';

-- ── grant / hold / release ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_erasure_authorize(p_scope text, p_organization_id uuid, p_person_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF p_scope IS NULL OR p_organization_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'pi_erasure_authorize: scope, tenant and person are required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pi_erasure_authorizations (scope, organization_id, person_id)
  VALUES (p_scope, p_organization_id, p_person_id)
  ON CONFLICT DO NOTHING;
END
$fn$;

CREATE OR REPLACE FUNCTION public.pi_erasure_release(p_scope text, p_organization_id uuid, p_person_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  DELETE FROM public.pi_erasure_authorizations a
   WHERE a.xact_id = pg_current_xact_id()
     AND a.scope = p_scope AND a.organization_id = p_organization_id AND a.person_id = p_person_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.pi_erasure_authorization_held(p_scope text, p_organization_id uuid, p_person_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT p_organization_id IS NOT NULL AND p_person_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pi_erasure_authorizations a
     WHERE a.xact_id = pg_current_xact_id()
       AND a.scope = p_scope AND a.organization_id = p_organization_id AND a.person_id = p_person_id);
$fn$;

DO $revoke_fn$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.pi_erasure_authorize(text, uuid, uuid)',
    'public.pi_erasure_release(text, uuid, uuid)',
    'public.pi_erasure_authorization_held(text, uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END
$revoke_fn$;

DO $verify$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND (
         has_table_privilege(r, 'public.pi_erasure_authorizations', 'SELECT')
      OR has_table_privilege(r, 'public.pi_erasure_authorizations', 'INSERT')
      OR has_table_privilege(r, 'public.pi_erasure_authorizations', 'UPDATE')
      OR has_table_privilege(r, 'public.pi_erasure_authorizations', 'DELETE')
      OR has_function_privilege(r, 'public.pi_erasure_authorize(text, uuid, uuid)', 'EXECUTE')
      OR has_function_privilege(r, 'public.pi_erasure_authorization_held(text, uuid, uuid)', 'EXECUTE')
      OR has_function_privilege(r, 'public.pi_erasure_release(text, uuid, uuid)', 'EXECUTE')) THEN
      RAISE EXCEPTION 'pi_erasure_authorizations postcondition: role % holds a privilege', r;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;

-- Rollback: only after 20270112000001/2/3 are rolled back (their guards call
-- pi_erasure_authorization_held):
--   DROP FUNCTION public.pi_erasure_authorization_held(text, uuid, uuid);
--   DROP FUNCTION public.pi_erasure_release(text, uuid, uuid);
--   DROP FUNCTION public.pi_erasure_authorize(text, uuid, uuid);
--   DROP TABLE public.pi_erasure_authorizations;
