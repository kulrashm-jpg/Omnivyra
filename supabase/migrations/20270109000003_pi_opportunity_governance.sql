-- PI / Opportunity workflow — governance closure (closure-D):
--   1. snooze is refused on a SNOOZE-TERMINAL opportunity (converted,
--      dismissed, archived) — at the database, not only in the service;
--   2. opportunity_dispositions becomes append-only at the database;
--   3. composite tenant FKs on opportunity_lifecycle_states and
--      opportunity_notes, matching the two 20270108000000 added for
--      dispositions and assignments.
--
-- Depends on: 20270107000000 (uq_opportunity_feed_items_id_org, the composite
-- parent key) and 20270108000000 (opportunity_dispositions.snoozed_until, the
-- composite FKs on dispositions/assignments, uq_opp_assignment_one_active).
-- Design record: docs/architecture/PROSPECT-OPPORTUNITY-LIFECYCLE.md §9a.
-- Application mirror: lib/prospectOpportunity/snooze.ts
-- (SNOOZE_TERMINAL_LIFECYCLE_STATES, OpportunitySnoozeRefusedError) and
-- backend/services/opportunityWorkflowService.ts (snoozeOpportunity).
--
-- ─── 1. WHAT "TERMINAL" MEANS FOR SNOOZE ──────────────────────────────────
-- No new vocabulary: a subset of the existing 9-state CHECK
-- (opp_lifecycle_state_check). The repo already uses "terminal" in two
-- DIFFERENT senses, and this is a third, named for its purpose:
--   * transition graph (backend/types/opportunityLifecycle.ts): converted and
--     archived are terminal; dismissed may be REOPENED to triaged;
--   * account deletion (FR-A38, isResolvedForAccountDeletion): archived only;
--   * snooze (this migration): converted, dismissed, archived — the three
--     states in which the opportunity is no longer being worked. Snoozing
--     ("come back to this later") is meaningless there. A dismissed
--     opportunity must be reopened (dismissed -> triaged) before it can be
--     snoozed; that path exists in the transition graph, so nothing is lost.
-- The current state is the latest opportunity_lifecycle_states row by
-- transitioned_at (the reader's rule). transitioned_at has no tiebreaker
-- (b21 finding L3b), so on a tie the guard FAILS CLOSED: if ANY row at the
-- latest instant is terminal, the snooze is refused. No lifecycle history at
-- all ("missing") is not terminal and is allowed — the same answer the
-- service gives.
--
-- Error semantics: SQLSTATE 23514 (check_violation, as the sibling
-- prospect_lifecycle_transitions guard uses for state rules), CONSTRAINT
-- opp_disposition_snooze_not_terminal, message prefixed with that name. The
-- service maps it to the same OpportunitySnoozeRefusedError it raises itself.
-- Only rows WITH snoozed_until are checked: an untimed revisit_later (e.g. an
-- early unsnooze) and every other disposition stay allowed on any state.
--
-- Race: a snooze and a concurrent transition to a terminal state. The guard
-- takes FOR UPDATE on the parent feed item; a lifecycle insert's FK check
-- holds FOR KEY SHARE on the same row until it commits, and the two conflict.
-- So whichever commits first wins and the other observes it (READ COMMITTED:
-- the guard's lifecycle read takes a fresh snapshot after the lock). A
-- snooze that commits BEFORE the terminal transition stays as history; it is
-- not retroactively removed (see "known limits" in the design record).
--
-- ─── 2. APPEND-ONLY DISPOSITIONS, AND HOW DELETION STILL WORKS ────────────
-- Mirrors trg_opp_lifecycle_block_mutation (20260520) and
-- trg_prospect_lifecycle_guard (20261028): BEFORE UPDATE / BEFORE DELETE row
-- triggers; message contains "append-only" and SQLSTATE 42501, so
-- backend/services/lifecycleGuardErrors.ts classifies a refusal as
-- append_only_violation.
-- Deliberate difference: the lifecycle guards also refuse the CASCADE from a
-- parent delete, which is why a lifecycle-bearing feed item / tenant cannot
-- be hard-deleted (retention pre-excludes them). Dispositions must not add a
-- second such blocker, so the guard admits exactly the referential actions
-- and nothing a client can issue directly:
--   * DELETE is admitted only when it is NESTED in another trigger
--     (pg_trigger_depth() > 1 — a client statement runs the guard at depth
--     1, an FK cascade at depth 2, measured on PG 17) AND the row's parent
--     feed item or tenant is already gone. That is the ON DELETE CASCADE from
--     opportunity_feed_items (retention hard-delete, both FKs) or companies
--     (tenant delete). A disposition never outlives its opportunity and is
--     never removed while it exists.
--   * UPDATE is admitted only when nested AND it is the ON DELETE SET NULL of
--     set_by_user_id: the user row is gone, the column goes non-NULL -> NULL,
--     and every other column is unchanged. So deleting a user still works.
-- Retention (backend/services/retentionService.ts) never targets this table;
-- it deletes opportunity_feed_items, whose cascade is admitted. Retention's
-- protected-children list (RETENTION_PROTECTED_CHILDREN) is therefore NOT
-- extended.
--
-- ─── 3. TENANT FKs ────────────────────────────────────────────────────────
-- (opportunity_feed_item_id, organization_id) -> opportunity_feed_items(id,
-- organization_id) ON DELETE CASCADE, the same action as the existing
-- single-column FKs, so deletion behaviour is unchanged: lifecycle rows still
-- refuse the cascade (their guard), notes still cascade. The single-column
-- FKs are kept (b21/retention suites pin their names).
--
-- ─── PRODUCTION PRECONDITIONS ─────────────────────────────────────────────
-- Read-only check 2026-10-30 (orchestrator): every opportunity_* table exists
-- with 0 rows. The preflight still re-proves that no existing row would
-- violate the new FKs and fails closed instead of building them NOT VALID.
--
-- No table is created; RLS, policies and grants are untouched. The trigger
-- functions are SECURITY INVOKER (they run with the caller's privileges, so
-- they cannot become a cross-tenant read primitive) with a pinned
-- search_path. Re-runnable: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER, constraints guarded by name, and $verify$
-- re-proves the end state on every replay.

BEGIN;

DO $preflight$
DECLARE
  v_n bigint;
BEGIN
  IF to_regclass('public.opportunity_feed_items') IS NULL
     OR to_regclass('public.opportunity_dispositions') IS NULL
     OR to_regclass('public.opportunity_assignments') IS NULL
     OR to_regclass('public.opportunity_notes') IS NULL
     OR to_regclass('public.opportunity_lifecycle_states') IS NULL THEN
    RAISE EXCEPTION 'OPP-GOV preflight: an opportunity workflow table is missing (phase 6, 20260520)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'uq_opportunity_feed_items_id_org') THEN
    RAISE EXCEPTION 'OPP-GOV preflight: uq_opportunity_feed_items_id_org missing — apply 20270107000000 first';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.opportunity_dispositions'::regclass
                    AND attname = 'snoozed_until' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'opp_dispositions_item_tenant_fk'
                       AND conrelid = 'public.opportunity_dispositions'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_indexes
                     WHERE schemaname = 'public' AND indexname = 'uq_opp_assignment_one_active') THEN
    RAISE EXCEPTION 'OPP-GOV preflight: 20270108000000 (snoozed_until, opp_dispositions_item_tenant_fk, uq_opp_assignment_one_active) is not applied — apply it first';
  END IF;

  SELECT count(*) INTO v_n
    FROM public.opportunity_lifecycle_states l
    JOIN public.opportunity_feed_items f ON f.id = l.opportunity_feed_item_id
   WHERE f.organization_id <> l.organization_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPP-GOV preflight: % opportunity_lifecycle_states row(s) belong to a different tenant than their feed item — resolve before adding the composite FK', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.opportunity_notes n
    JOIN public.opportunity_feed_items f ON f.id = n.opportunity_feed_item_id
   WHERE f.organization_id <> n.organization_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPP-GOV preflight: % opportunity_notes row(s) belong to a different tenant than their feed item — resolve before adding the composite FK', v_n;
  END IF;

  -- Informational only: snoozes recorded before this guard on opportunities
  -- that are terminal NOW are history, not violations (the rule is
  -- insert-time). Production had 0 disposition rows on 2026-10-30.
  SELECT count(*) INTO v_n
    FROM public.opportunity_dispositions d
   WHERE d.snoozed_until IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.opportunity_lifecycle_states l
        WHERE l.opportunity_feed_item_id = d.opportunity_feed_item_id
          AND l.state IN ('converted', 'dismissed', 'archived')
          AND l.transitioned_at = (SELECT max(l2.transitioned_at)
                                     FROM public.opportunity_lifecycle_states l2
                                    WHERE l2.opportunity_feed_item_id = d.opportunity_feed_item_id));
  IF v_n > 0 THEN
    RAISE NOTICE 'OPP-GOV preflight: % existing snooze row(s) sit on an opportunity that is terminal now; kept as history', v_n;
  END IF;
END
$preflight$;

-- ── 1. Snooze refused on a snooze-terminal opportunity ────────────────────

CREATE OR REPLACE FUNCTION public.trg_opp_disposition_snooze_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_state text;
BEGIN
  IF NEW.snoozed_until IS NULL THEN
    RETURN NEW;
  END IF;

  -- Serialise against a concurrent lifecycle insert for the same item: its FK
  -- check holds FOR KEY SHARE on this row until commit, which FOR UPDATE
  -- waits for. Tenant-scoped, so it can never lock another tenant's item.
  PERFORM 1 FROM public.opportunity_feed_items f
    WHERE f.id = NEW.opportunity_feed_item_id
      AND f.organization_id = NEW.organization_id
    FOR UPDATE;

  -- Latest state; on a transitioned_at tie, any terminal row wins (fail closed).
  SELECT l.state INTO v_state
    FROM public.opportunity_lifecycle_states l
   WHERE l.organization_id = NEW.organization_id
     AND l.opportunity_feed_item_id = NEW.opportunity_feed_item_id
     AND l.transitioned_at = (SELECT max(l2.transitioned_at)
                                FROM public.opportunity_lifecycle_states l2
                               WHERE l2.organization_id = NEW.organization_id
                                 AND l2.opportunity_feed_item_id = NEW.opportunity_feed_item_id)
   ORDER BY (l.state IN ('converted', 'dismissed', 'archived')) DESC, l.state
   LIMIT 1;

  IF v_state IN ('converted', 'dismissed', 'archived') THEN
    RAISE EXCEPTION 'opp_disposition_snooze_not_terminal: opportunity % is %; a converted, dismissed or archived opportunity cannot be snoozed',
      NEW.opportunity_feed_item_id, v_state
      USING ERRCODE = '23514',
            CONSTRAINT = 'opp_disposition_snooze_not_terminal',
            TABLE = 'opportunity_dispositions',
            COLUMN = 'snoozed_until';
  END IF;

  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.trg_opp_disposition_snooze_guard() IS
  'Refuses a snooze (snoozed_until IS NOT NULL) on an opportunity whose latest '
  'lifecycle state is converted, dismissed or archived (23514, '
  'opp_disposition_snooze_not_terminal). Mirror: lib/prospectOpportunity/snooze.ts '
  'SNOOZE_TERMINAL_LIFECYCLE_STATES. Migration 20270109000003.';

DROP TRIGGER IF EXISTS opp_disposition_snooze_guard ON public.opportunity_dispositions;
CREATE TRIGGER opp_disposition_snooze_guard
  BEFORE INSERT ON public.opportunity_dispositions
  FOR EACH ROW
  WHEN (NEW.snoozed_until IS NOT NULL)
  EXECUTE FUNCTION public.trg_opp_disposition_snooze_guard();

-- ── 2. Append-only dispositions ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_opp_disposition_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Admitted only as the ON DELETE CASCADE of the feed item or the tenant.
    IF pg_trigger_depth() > 1
       AND (NOT EXISTS (SELECT 1 FROM public.opportunity_feed_items f
                         WHERE f.id = OLD.opportunity_feed_item_id)
            OR NOT EXISTS (SELECT 1 FROM public.companies c
                            WHERE c.id = OLD.organization_id)) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'opportunity_dispositions is append-only (DELETE refused)'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Admitted only as the ON DELETE SET NULL of set_by_user_id.
    IF pg_trigger_depth() > 1
       AND OLD.set_by_user_id IS NOT NULL
       AND NEW.set_by_user_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.set_by_user_id)
       AND (to_jsonb(NEW) - 'set_by_user_id') = (to_jsonb(OLD) - 'set_by_user_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'opportunity_dispositions is append-only (UPDATE refused)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION public.trg_opp_disposition_block_mutation() IS
  'opportunity_dispositions is append-only (42501, message contains "append-only"). '
  'Admits only the referential actions: the ON DELETE CASCADE from '
  'opportunity_feed_items / companies (parent already gone, nested trigger) and '
  'the ON DELETE SET NULL of set_by_user_id. Migration 20270109000003.';

DROP TRIGGER IF EXISTS opp_disposition_block_update ON public.opportunity_dispositions;
CREATE TRIGGER opp_disposition_block_update
  BEFORE UPDATE ON public.opportunity_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.trg_opp_disposition_block_mutation();

DROP TRIGGER IF EXISTS opp_disposition_block_delete ON public.opportunity_dispositions;
CREATE TRIGGER opp_disposition_block_delete
  BEFORE DELETE ON public.opportunity_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.trg_opp_disposition_block_mutation();

-- ── 3. Composite tenant FKs on lifecycle states and notes ─────────────────

DO $tenant_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'opp_lifecycle_item_tenant_fk'
                    AND conrelid = 'public.opportunity_lifecycle_states'::regclass) THEN
    ALTER TABLE public.opportunity_lifecycle_states
      ADD CONSTRAINT opp_lifecycle_item_tenant_fk
      FOREIGN KEY (opportunity_feed_item_id, organization_id)
      REFERENCES public.opportunity_feed_items (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'opp_notes_item_tenant_fk'
                    AND conrelid = 'public.opportunity_notes'::regclass) THEN
    ALTER TABLE public.opportunity_notes
      ADD CONSTRAINT opp_notes_item_tenant_fk
      FOREIGN KEY (opportunity_feed_item_id, organization_id)
      REFERENCES public.opportunity_feed_items (id, organization_id) ON DELETE CASCADE;
  END IF;
END
$tenant_fks$;

-- ── 4. Postconditions ─────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_def text;
  v_n   integer;
  r     record;
BEGIN
  -- Composite tenant FKs: all four workflow tables (two from 20270108000000).
  FOR r IN SELECT * FROM (VALUES
      ('opp_lifecycle_item_tenant_fk',    'public.opportunity_lifecycle_states'),
      ('opp_notes_item_tenant_fk',        'public.opportunity_notes'),
      ('opp_dispositions_item_tenant_fk', 'public.opportunity_dispositions'),
      ('opp_assignments_item_tenant_fk',  'public.opportunity_assignments')) AS t(con, tbl)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conname = r.con AND conrelid = r.tbl::regclass AND contype = 'f'
       AND convalidated AND confdeltype = 'c';
    IF v_def IS NULL
       OR v_def NOT LIKE 'FOREIGN KEY (opportunity_feed_item_id, organization_id) REFERENCES %opportunity_feed_items(id, organization_id)%' THEN
      RAISE EXCEPTION 'OPP-GOV postcondition: % must be a validated composite FK ON DELETE CASCADE onto opportunity_feed_items(id, organization_id), found %', r.con, v_def;
    END IF;
  END LOOP;

  -- Triggers: name, table, BEFORE, row-level, event, enabled, function.
  FOR r IN SELECT * FROM (VALUES
      ('opp_disposition_snooze_guard', 'INSERT', 'trg_opp_disposition_snooze_guard'),
      ('opp_disposition_block_update', 'UPDATE', 'trg_opp_disposition_block_mutation'),
      ('opp_disposition_block_delete', 'DELETE', 'trg_opp_disposition_block_mutation')) AS t(tg, ev, fn)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.opportunity_dispositions'::regclass
       AND t.tgname = r.tg AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND (t.tgtype & 1) <> 0          -- ROW
       AND (t.tgtype & 2) <> 0          -- BEFORE
       AND (t.tgtype & CASE r.ev WHEN 'INSERT' THEN 4 WHEN 'DELETE' THEN 8 ELSE 16 END) <> 0
       AND p.proname = r.fn
       AND NOT p.prosecdef;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'OPP-GOV postcondition: trigger % (BEFORE % FOR EACH ROW, enabled, invoker % ) missing or wrong', r.tg, r.ev, r.fn;
    END IF;
  END LOOP;

  -- The snooze guard still sits next to the revisit_later CHECK (20270108000000).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'opp_disposition_snooze_requires_revisit_later'
                    AND conrelid = 'public.opportunity_dispositions'::regclass
                    AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION 'OPP-GOV postcondition: CHECK opp_disposition_snooze_requires_revisit_later missing';
  END IF;

  -- One active owner per (item, role) is still a database fact.
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'uq_opp_assignment_one_active' AND i.indisunique AND i.indisvalid
     AND i.indpred IS NOT NULL;
  IF v_def IS NULL OR v_def NOT LIKE '%(opportunity_feed_item_id, role) WHERE (unassigned_at IS NULL)%' THEN
    RAISE EXCEPTION 'OPP-GOV postcondition: uq_opp_assignment_one_active must be a valid partial UNIQUE (opportunity_feed_item_id, role), found %', v_def;
  END IF;

  -- The lifecycle append-only guard this migration mirrors is untouched.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.opportunity_lifecycle_states'::regclass
     AND tgname IN ('opp_lifecycle_block_update', 'opp_lifecycle_block_delete')
     AND tgenabled = 'O';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'OPP-GOV postcondition: opportunity_lifecycle_states append-only triggers expected 2, found %', v_n;
  END IF;

  RAISE NOTICE 'OPP-GOV: snooze-terminal guard, append-only opportunity_dispositions, composite tenant FKs on all 4 workflow tables — verified.';
END
$verify$;

COMMIT;
