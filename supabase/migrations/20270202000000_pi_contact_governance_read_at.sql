-- P0 CONTACT GOVERNANCE — the decision instant, read from the database, on the
-- same statement as the rows it describes.
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────────
-- `contact_governance_records.effective_from` / `.effective_until` are
-- database-stamped (`DEFAULT now()`, and a writer that clamps a provider
-- timestamp to the database clock). The evaluator compared them against an
-- instant the APPLICATION produced with its own clock. Two clocks, and the
-- stored side is not the one that moved: measured on the development host, Node
-- ran behind Postgres in 1458 of 1485 samples, and a `w32time` step moved it
-- 3.135 s mid-run. On a suppression check the error has a direction — a hold
-- that has just started reads as "not yet in force", which PERMITS contact.
--
-- ─── WHY A FUNCTION, AND NOT A COLUMN OR A SECOND QUERY ─────────────────────
-- The instant has to arrive on the SAME statement as the rows, or it is just a
-- third clock. Through PostgREST, `select` takes table columns and embedded
-- resources — NOT arbitrary expressions — so `select('…, now()')` does not
-- exist. A PostgREST COMPUTED FIELD is a function whose only argument is the
-- table's composite type; it is selectable exactly like a column, and it is the
-- only mechanism that keeps this to one statement.
--
-- The alternatives were weighed and rejected:
--   • a second `SELECT now()` beside the rows — the two reads can straddle a
--     write and NEITHER ORDER IS FAIL-CLOSED. Clock first: the instant predates
--     the snapshot, so a hold written in between reads as "not yet started".
--     Rows first: the instant postdates them, so `until <= now` is likelier and
--     a live deferment reads as "lapsed". Both PERMIT contact. It trades one
--     fail-open for its mirror image.
--   • a stored column — `now()` is not a property of the row. A column would
--     record when the row was WRITTEN, which is already `created_at`.
--   • a direct `pg` client — gives the hottest governance read a second
--     connection path outside the `ownedDbTable` write-owner seam and its
--     observability, with its own credential surface, for one scalar.
--
-- ─── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────
-- No table, column, constraint, index, policy, RLS rule, trigger or default is
-- added, altered or dropped. The suppression model is untouched. This creates
-- ONE read-only function and sets its privileges, and nothing else.

-- `transaction_timestamp()` — NOT `clock_timestamp()`. PostgREST serves one
-- transaction per request, so `transaction_timestamp()` is identical for every
-- row of one response and IS that response's snapshot instant.
-- `clock_timestamp()` is VOLATILE and advances row by row, which would hand the
-- evaluator a different instant per record out of one read.
--
-- STABLE, because PostgREST will not accept a VOLATILE function as a computed
-- field, and because within one transaction the value genuinely does not change.
--
-- SECURITY INVOKER (the default, stated anyway): this needs no privilege the
-- caller lacks. It reads no row — not even the one it is handed — so there is
-- nothing for a DEFINER to escalate, and a DEFINER would be a standing
-- escalation surface created for no reason.
--
-- The search_path is pinned tighter than the house default of
-- `public, extensions, pg_temp`: the body resolves exactly one name and resolves
-- it fully qualified, so nothing from `public` is needed, and `pg_catalog` alone
-- is the smallest path that works. `pg_temp` is last so a temporary object can
-- never shadow a catalog one.
CREATE OR REPLACE FUNCTION public.read_at(governance_record public.contact_governance_records)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT pg_catalog.transaction_timestamp()
$function$;

COMMENT ON FUNCTION public.read_at(public.contact_governance_records) IS
  'PostgREST computed field: the database instant this request''s snapshot was '
  'taken at. Selected alongside the governance rows so contact-governance '
  'evaluation judges each read against its own instant rather than a host clock.';

-- A newly created function is EXECUTABLE BY PUBLIC by default — that is the
-- PostgreSQL default for functions, unlike tables. The revoke is therefore not
-- belt-and-braces; without it every role in the cluster can call this.
--
-- `anon` and `authenticated` are named explicitly as well as PUBLIC, because a
-- Supabase project can carry `ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS
-- TO anon, authenticated, service_role`, which grants them DIRECTLY rather than
-- through PUBLIC. Revoking PUBLIC alone would leave those direct grants in
-- place, and the sandbox — which has no such default — would not show it.
REVOKE EXECUTE ON FUNCTION public.read_at(public.contact_governance_records) FROM PUBLIC, anon, authenticated;

-- The one role that reads this table. `contact_governance_records` is read
-- through the service-role client (`ownedDbTable`), and no client role has any
-- business asking the database what time it thinks it is.
GRANT EXECUTE ON FUNCTION public.read_at(public.contact_governance_records) TO service_role;

-- ─── POSTCONDITION ──────────────────────────────────────────────────────────
-- Asserted here, in the same migration, rather than left to a later audit: a
-- hosted project's default privileges can re-grant what the statements above
-- revoked, and that difference does not exist in the sandbox. If it happens,
-- this RAISES at apply time instead of shipping an open function.
DO $$
DECLARE
  fn regprocedure := 'public.read_at(public.contact_governance_records)'::regprocedure;
  acl aclitem[];
BEGIN
  SELECT proacl INTO acl FROM pg_catalog.pg_proc WHERE oid = fn;

  -- A NULL `proacl` is the DEFAULT acl, and the default for a function is
  -- EXECUTE TO PUBLIC. `aclexplode(NULL)` returns no rows, so a check that only
  -- looked for an explicit PUBLIC grant would PASS on the most open state there
  -- is — a gate that cannot fail. This is why the NULL case is tested first.
  IF acl IS NULL THEN
    RAISE EXCEPTION 'public.read_at has a default ACL, which grants EXECUTE to PUBLIC';
  END IF;

  -- grantee 0 is PUBLIC in an aclitem.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.aclexplode(acl) a
    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'public.read_at still grants EXECUTE to PUBLIC';
  END IF;

  -- `has_function_privilege` accounts for privileges held via PUBLIC and via
  -- role membership, so these are the effective answers, not just direct grants.
  IF pg_catalog.has_function_privilege('anon', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.read_at still grants EXECUTE to anon';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.read_at still grants EXECUTE to authenticated';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.read_at does not grant EXECUTE to service_role';
  END IF;

  -- The properties the application depends on, read back from the catalog
  -- rather than assumed from the text above.
  PERFORM 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = fn
      AND p.provolatile = 's'          -- STABLE: PostgREST rejects VOLATILE here
      AND p.prosecdef IS FALSE         -- SECURITY INVOKER
      AND p.proretset IS FALSE
      AND p.prorettype = 'pg_catalog.timestamptz'::regtype;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.read_at is not a STABLE, SECURITY INVOKER, scalar timestamptz function';
  END IF;
END
$$;
