-- PI / Opportunity workflow — opportunity-level snooze, one active owner per
-- role, and tenant-composite references for the two workflow tables it touches.
--
-- Design record: docs/architecture/PROSPECT-OPPORTUNITY-LIFECYCLE.md (gaps G2,
-- G3, G4; proposals P2 and P3). Service: backend/services/opportunityWorkflowService.ts
-- (snoozeOpportunity / unsnoozeOpportunity / readOpportunitySnooze /
-- listOpportunitySnoozeHistory / listExpiredOpportunitySnoozes, assignOpportunity).
-- Pure derivation: lib/prospectOpportunity/snooze.ts.
--
-- ─── OWNER DECISION (2026-10-30) ──────────────────────────────────────────
-- Snooze is an OPPORTUNITY-level workflow property, not a prospect-level one,
-- and must reuse the existing opportunity workflow model rather than add a
-- parallel status vocabulary.
--
-- ─── CARRIER: opportunity_dispositions.snoozed_until ──────────────────────
-- The existing disposition vocabulary already has `revisit_later` ("come back
-- to this"); what it lacks is WHEN. A snooze is therefore an ordinary
-- `revisit_later` disposition row that carries a typed deadline:
--   * per opportunity   — the row is keyed by opportunity_feed_item_id;
--   * history           — dispositions are append-style (the service only
--                         inserts), so every snooze, re-snooze and early
--                         unsnooze is a row with its own actor and time;
--   * current state     — the LATEST disposition of the item; a snooze is in
--                         force while that row is `revisit_later` and
--                         snoozed_until > now. It expires by time alone, so
--                         nothing has to run to "wake" an opportunity;
--   * status untouched  — opportunity_lifecycle_states keeps its 9-state
--                         vocabulary; a qualified opportunity can be snoozed
--                         and stays qualified. No 'snoozed' state is invented.
--
-- Why a typed column and not `metadata` jsonb:
--   * a CHECK can bind the deadline to `revisit_later`; jsonb cannot be typed;
--   * text→timestamptz casts are not IMMUTABLE, so a jsonb deadline cannot be
--     indexed for an expiry query; the partial index below can;
--   * the schema-parity verifier can require a column, not a jsonb key.
-- Why not a lifecycle state: it would add a 10th state to a DB-checked
-- vocabulary and make snooze overwrite the status (owner rule: no new status
-- vocabulary). Why not operational_tasks.due_at: entity_id/company_id are
-- untyped text with no FK — not tenant-safe by constraint.
--
-- ─── ONE ACTIVE OWNER (G3) ────────────────────────────────────────────────
-- `opp_assignment_unique_active UNIQUE (opportunity_feed_item_id, role,
-- unassigned_at)` treats NULLs as distinct, so two concurrent assignments
-- could both stay active. The partial unique index below makes "one active
-- assignment per (item, role)" a database fact; the service retries its
-- close-then-insert on 23505 instead of leaving two owners.
--
-- ─── TENANCY (G4, the two tables this migration relies on) ────────────────
-- Both tables reference the feed item by a single-column FK plus a separate
-- organization_id → companies FK, so a row's tenant could differ from its
-- item's. Composite (opportunity_feed_item_id, organization_id) FKs onto
-- uq_opportunity_feed_items_id_org (added by 20270107000000) make a
-- cross-tenant snooze or assignment a 23503. ON DELETE CASCADE matches the
-- existing single-column FKs, so retention behaviour is unchanged.
-- opportunity_lifecycle_states is deliberately NOT touched here.
--
-- ─── PRODUCTION PRECONDITIONS ─────────────────────────────────────────────
-- Read-only check 2026-10-30 (orchestrator): opportunity_dispositions and
-- opportunity_assignments exist with 0 rows. The preflight still re-proves
-- that no existing row would violate the new index or FKs, and fails closed
-- rather than building a constraint that is silently NOT VALID.
--
-- RLS, policies and grants are untouched: no table is created.
-- Re-runnable: columns/indexes IF NOT EXISTS, constraints guarded by name,
-- and the postcondition block re-proves the end state on every replay.

BEGIN;

DO $preflight$
DECLARE
  v_n bigint;
BEGIN
  IF to_regclass('public.opportunity_dispositions') IS NULL
     OR to_regclass('public.opportunity_assignments') IS NULL
     OR to_regclass('public.opportunity_feed_items') IS NULL THEN
    RAISE EXCEPTION 'OPP-SNOOZE preflight: opportunity_feed_items / opportunity_dispositions / opportunity_assignments missing (phase 6, 20260520)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'uq_opportunity_feed_items_id_org') THEN
    RAISE EXCEPTION 'OPP-SNOOZE preflight: uq_opportunity_feed_items_id_org missing — apply 20270107000000 first';
  END IF;

  SELECT count(*) INTO v_n FROM (
    SELECT 1 FROM public.opportunity_assignments
     WHERE unassigned_at IS NULL
     GROUP BY opportunity_feed_item_id, role HAVING count(*) > 1) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPP-SNOOZE preflight: % (item, role) pair(s) already have more than one active assignment — resolve before enforcing one active owner', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.opportunity_assignments a
    JOIN public.opportunity_feed_items f ON f.id = a.opportunity_feed_item_id
   WHERE f.organization_id <> a.organization_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPP-SNOOZE preflight: % opportunity_assignments row(s) belong to a different tenant than their feed item', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.opportunity_dispositions d
    JOIN public.opportunity_feed_items f ON f.id = d.opportunity_feed_item_id
   WHERE f.organization_id <> d.organization_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPP-SNOOZE preflight: % opportunity_dispositions row(s) belong to a different tenant than their feed item', v_n;
  END IF;
END
$preflight$;

-- ── 1. The snooze carrier ─────────────────────────────────────────────────
-- Nullable, no default, no backfill: every existing disposition (including an
-- untimed `revisit_later`) is "not snoozed".

ALTER TABLE public.opportunity_dispositions
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

DO $snooze_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'opp_disposition_snooze_requires_revisit_later'
                    AND conrelid = 'public.opportunity_dispositions'::regclass) THEN
    ALTER TABLE public.opportunity_dispositions
      ADD CONSTRAINT opp_disposition_snooze_requires_revisit_later
      CHECK (snoozed_until IS NULL OR disposition = 'revisit_later');
  END IF;
END
$snooze_check$;

COMMENT ON COLUMN public.opportunity_dispositions.snoozed_until IS
  'Opportunity-level snooze deadline. Only on a revisit_later disposition '
  '(opp_disposition_snooze_requires_revisit_later). The opportunity is snoozed '
  'while its LATEST disposition is revisit_later with snoozed_until > now; it '
  'expires by time alone. NULL = not a timed snooze (an early unsnooze is a new '
  'revisit_later row with NULL). Never changes opportunity_lifecycle_states.';

-- Expiry / due-list lookups ("which snoozes in this tenant end before T").
CREATE INDEX IF NOT EXISTS idx_opp_dispositions_snooze_expiry
  ON public.opportunity_dispositions (organization_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- ── 2. One active assignment per (item, role) ─────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_opp_assignment_one_active
  ON public.opportunity_assignments (opportunity_feed_item_id, role)
  WHERE unassigned_at IS NULL;

-- ── 3. Composite tenant FKs onto the feed item ────────────────────────────

DO $tenant_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'opp_dispositions_item_tenant_fk'
                    AND conrelid = 'public.opportunity_dispositions'::regclass) THEN
    ALTER TABLE public.opportunity_dispositions
      ADD CONSTRAINT opp_dispositions_item_tenant_fk
      FOREIGN KEY (opportunity_feed_item_id, organization_id)
      REFERENCES public.opportunity_feed_items (id, organization_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'opp_assignments_item_tenant_fk'
                    AND conrelid = 'public.opportunity_assignments'::regclass) THEN
    ALTER TABLE public.opportunity_assignments
      ADD CONSTRAINT opp_assignments_item_tenant_fk
      FOREIGN KEY (opportunity_feed_item_id, organization_id)
      REFERENCES public.opportunity_feed_items (id, organization_id) ON DELETE CASCADE;
  END IF;
END
$tenant_fks$;

-- ── 4. Postconditions ─────────────────────────────────────────────────────

DO $verify$
DECLARE
  v_type text;
  v_null boolean;
  v_def  text;
  r      record;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), NOT a.attnotnull INTO v_type, v_null
    FROM pg_attribute a
   WHERE a.attrelid = 'public.opportunity_dispositions'::regclass
     AND a.attname = 'snoozed_until' AND NOT a.attisdropped;
  IF v_type IS DISTINCT FROM 'timestamp with time zone' OR v_null IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OPP-SNOOZE postcondition: opportunity_dispositions.snoozed_until must be nullable timestamptz, found % (nullable=%)', v_type, v_null;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conname = 'opp_disposition_snooze_requires_revisit_later'
     AND conrelid = 'public.opportunity_dispositions'::regclass AND contype = 'c' AND convalidated;
  IF v_def IS NULL OR v_def NOT LIKE '%snoozed_until IS NULL%' OR v_def NOT LIKE '%revisit_later%' THEN
    RAISE EXCEPTION 'OPP-SNOOZE postcondition: validated CHECK opp_disposition_snooze_requires_revisit_later missing, found %', v_def;
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'uq_opp_assignment_one_active' AND i.indisunique AND i.indisvalid
     AND i.indpred IS NOT NULL;
  IF v_def IS NULL OR v_def NOT LIKE '%(opportunity_feed_item_id, role) WHERE (unassigned_at IS NULL)%' THEN
    RAISE EXCEPTION 'OPP-SNOOZE postcondition: uq_opp_assignment_one_active must be a valid UNIQUE (opportunity_feed_item_id, role) WHERE unassigned_at IS NULL, found %', v_def;
  END IF;

  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'idx_opp_dispositions_snooze_expiry' AND i.indpred IS NOT NULL;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'OPP-SNOOZE postcondition: partial index idx_opp_dispositions_snooze_expiry missing';
  END IF;

  FOR r IN SELECT * FROM (VALUES
      ('opp_dispositions_item_tenant_fk', 'public.opportunity_dispositions'),
      ('opp_assignments_item_tenant_fk',  'public.opportunity_assignments')) AS t(con, tbl)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conname = r.con AND conrelid = r.tbl::regclass AND contype = 'f'
       AND convalidated AND confdeltype = 'c';
    IF v_def IS NULL
       OR v_def NOT LIKE 'FOREIGN KEY (opportunity_feed_item_id, organization_id) REFERENCES %opportunity_feed_items(id, organization_id)%' THEN
      RAISE EXCEPTION 'OPP-SNOOZE postcondition: % must be a validated composite FK ON DELETE CASCADE onto opportunity_feed_items(id, organization_id), found %', r.con, v_def;
    END IF;
  END LOOP;

  RAISE NOTICE 'OPP-SNOOZE: opportunity_dispositions.snoozed_until (timestamptz, revisit_later-only CHECK, expiry index); uq_opp_assignment_one_active; 2 composite tenant FKs — verified.';
END
$verify$;

COMMIT;
