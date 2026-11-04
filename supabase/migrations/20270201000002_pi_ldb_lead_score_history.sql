-- PI-LDB-3 — append-only score history per prospect.
--
-- ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
-- `canonical_leads.qualification_score` is a single NUMERIC(5,2) scalar. It
-- holds the current score and nothing else: no previous value, no reason, no
-- model version, no timestamp of its own. So "why is this lead a 72?" and "was
-- it ever higher?" are both unanswerable, and a scoring regression is
-- invisible — the new wrong score simply overwrites the old right one.
--
-- This table is the history that scalar cannot carry. It does NOT replace the
-- scalar: `canonical_leads` stays the fast current-value read that every
-- existing consumer already uses, and this is the audit trail beside it. One
-- current value, one history; no second prospect database and no second
-- scoring engine.
--
-- ─── APPEND-ONLY, WITHOUT ARMING A FOREIGN KEY ──────────────────────────────
-- This is the part that needed care. The established pattern in this
-- repository — `consent_records`, `opportunity_lifecycle_states` — pairs an
-- unconditional BEFORE DELETE refusal with `organization_id REFERENCES
-- companies(id) ON DELETE CASCADE`. Those two together mean a company can
-- never be deleted: the cascade reaches the child, the trigger refuses, and the
-- whole delete aborts. That is precisely the ARMED FOREIGN KEY the governance
-- review found on 19 tables, and copying the pattern here would make it 20.
--
-- So this table takes a narrower guarantee, deliberately:
--
--   * UPDATE is refused outright. A score history whose rows can be edited is
--     not a history, and no foreign key here performs an ON DELETE SET NULL,
--     so refusing UPDATE arms nothing.
--
--   * DELETE is refused only when it is issued DIRECTLY. A delete arriving as
--     a referential cascade from `companies` or `canonical_leads` is allowed
--     through, so deleting a tenant or a prospect still works and the parent
--     rows stay deletable.
--
-- `pg_trigger_depth()` is what separates the two: a cascade is executed by the
-- parent's internal referential-integrity trigger, so the child's trigger runs
-- nested at depth > 1, while a direct `DELETE FROM lead_score_history` runs at
-- depth 1.
--
-- The honest limit of that: it distinguishes NESTING, not intent. A direct
-- delete issued from inside some other trigger would also run nested and would
-- pass. It is a guard against accident and casual cleanup, not against a
-- determined service_role caller — who could in any case drop the trigger.
--
-- ─── WHY THERE IS NO ACTOR FOREIGN KEY ──────────────────────────────────────
-- For the same arming reason. This repository's actor pattern is `REFERENCES
-- users(id) ON DELETE SET NULL`, and a SET NULL is an UPDATE — which the
-- append-only guard above refuses. Pairing them would make every user who has
-- ever triggered a scoring run permanently undeletable. `computed_by` is
-- therefore a plain uuid with no foreign key, and that is a conscious trade:
-- referential integrity on the actor column is given up to keep both the
-- append-only guarantee and deletable users.
--
-- Creates no data. No existing table, column, index, constraint or policy is
-- modified.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_score_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  -- The prospect. `canonical_leads` is the canonical Prospect (C-2), reached
  -- through the composite tenant-safe key below.
  lead_id         uuid NOT NULL,
  -- Which score this row is about. `qualification` mirrors the
  -- `canonical_leads` scalar; the others are the component scores the read
  -- model already exposes in `CanonicalLeadScores`, so a history row can
  -- explain a composite without inventing a new vocabulary.
  score_kind      text NOT NULL,
  score           numeric(5,2) NOT NULL,
  -- What the score was immediately before. NULL means this is the first score
  -- of its kind for this prospect — distinct from a previous score of 0, which
  -- is why this is nullable rather than defaulted.
  previous_score  numeric(5,2),
  -- Which scoring implementation produced it. Without this, a score computed
  -- before a weighting change is indistinguishable from one computed after, and
  -- the history cannot show a regression.
  model_version   text NOT NULL,
  -- Why, in words a human can read. NOT NULL on purpose: a score change with
  -- no stated reason is the thing this table exists to prevent.
  reason          text NOT NULL,
  -- The inputs the score was computed from, as a snapshot. A reason explains
  -- the decision; this makes it checkable.
  inputs          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The actor, when a human caused it. Plain uuid, no FK — see the header.
  computed_by     uuid,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lead_score_history_kind_valid
    CHECK (score_kind IN ('qualification', 'icp', 'intent', 'urgency', 'confidence', 'total')),
  -- Matches `canonical_leads_qualification_score_valid` exactly. A history row
  -- outside the range the scalar accepts could never have been that scalar.
  CONSTRAINT lead_score_history_score_range
    CHECK (score >= 0 AND score <= 100),
  CONSTRAINT lead_score_history_previous_score_range
    CHECK (previous_score IS NULL OR (previous_score >= 0 AND previous_score <= 100)),
  CONSTRAINT lead_score_history_model_version_not_blank
    CHECK (length(btrim(model_version)) > 0),
  CONSTRAINT lead_score_history_reason_not_blank
    CHECK (length(btrim(reason)) > 0),
  CONSTRAINT lead_score_history_inputs_is_object
    CHECK (jsonb_typeof(inputs) = 'object'),
  -- Tenant-safe: the prospect is reached through (id, company_id), so one
  -- tenant's history row cannot reference another tenant's prospect. The parent
  -- key is the existing `idx_canonical_leads_id_company` unique index.
  CONSTRAINT lead_score_history_lead_tenant_fk
    FOREIGN KEY (lead_id, organization_id)
    REFERENCES public.canonical_leads (id, company_id)
    ON DELETE CASCADE
);

-- The history read: newest first, for one prospect, one score kind.
CREATE INDEX IF NOT EXISTS idx_lead_score_history_lead
  ON public.lead_score_history (organization_id, lead_id, score_kind, computed_at DESC);

-- "What moved this week, and why" — the tenant-wide regression query.
CREATE INDEX IF NOT EXISTS idx_lead_score_history_org_time
  ON public.lead_score_history (organization_id, computed_at DESC);

-- "Which scores came from the implementation we just replaced?"
CREATE INDEX IF NOT EXISTS idx_lead_score_history_model_version
  ON public.lead_score_history (organization_id, model_version, computed_at DESC);

COMMENT ON TABLE public.lead_score_history IS
  'Append-only per-prospect score history. Complements canonical_leads.qualification_score, which remains the current-value read. UPDATE is refused; DELETE is refused only when issued directly, so parent cascades still work.';

-- ---------------------------------------------------------------------------
-- The append-only guard. See the header for why DELETE is treated differently
-- from UPDATE, and for the limit of pg_trigger_depth().
-- ---------------------------------------------------------------------------
-- `SET search_path` is pinned, matching what 20270111000003 pins on all 76
-- pre-existing trigger functions. This function is created AFTER that migration,
-- which enumerates its targets and therefore cannot reach it — so the hardening
-- has to be written here or it does not happen.
CREATE OR REPLACE FUNCTION public.trg_lead_score_history_append_only()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'lead_score_history is append-only: a score history whose rows can be edited is not a history. Insert a new row instead.';
  END IF;

  -- DELETE. Allow the referential cascade, refuse the direct statement.
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'lead_score_history is append-only: direct deletes are refused. Rows are removed only by cascade when their tenant or prospect is deleted.';
  END IF;

  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS lead_score_history_no_update ON public.lead_score_history;
CREATE TRIGGER lead_score_history_no_update
  BEFORE UPDATE ON public.lead_score_history
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_score_history_append_only();

DROP TRIGGER IF EXISTS lead_score_history_no_direct_delete ON public.lead_score_history;
CREATE TRIGGER lead_score_history_no_direct_delete
  BEFORE DELETE ON public.lead_score_history
  FOR EACH ROW EXECUTE FUNCTION public.trg_lead_score_history_append_only();

-- ---------------------------------------------------------------------------
-- RLS — parity with the surrounding provenance tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_score_history ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'lead_score_history'
                  AND policyname = 'lead_score_history_service_role') THEN
    CREATE POLICY lead_score_history_service_role ON public.lead_score_history
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  v_fk   INT;
  v_trg  INT;
  v_setnull INT;
BEGIN
  IF to_regclass('public.lead_score_history') IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-3 postcondition: lead_score_history is missing';
  END IF;

  SELECT count(*) INTO v_fk FROM pg_constraint
   WHERE conname = 'lead_score_history_lead_tenant_fk'
     AND contype = 'f' AND array_length(conkey, 1) = 2;
  IF v_fk <> 1 THEN
    RAISE EXCEPTION 'PI-LDB-3 postcondition: tenant-safe prospect FK is missing or not composite';
  END IF;

  SELECT count(*) INTO v_trg FROM pg_trigger
   WHERE tgrelid = 'public.lead_score_history'::regclass
     AND tgname IN ('lead_score_history_no_update', 'lead_score_history_no_direct_delete');
  IF v_trg <> 2 THEN
    RAISE EXCEPTION 'PI-LDB-3 postcondition: expected 2 append-only triggers, found %', v_trg;
  END IF;

  -- The anti-arming assertion. An append-only UPDATE guard plus any ON DELETE
  -- SET NULL foreign key on this table would make the referenced parent row
  -- permanently undeletable. There must be none, and this is the check that
  -- stops a later edit from quietly introducing one.
  SELECT count(*) INTO v_setnull FROM pg_constraint
   WHERE conrelid = 'public.lead_score_history'::regclass
     AND contype = 'f' AND confdeltype = 'n';
  IF v_setnull <> 0 THEN
    RAISE EXCEPTION
      'PI-LDB-3 postcondition: % ON DELETE SET NULL foreign key(s) on an append-only table. The SET NULL is an UPDATE, which the guard refuses, so the parent row becomes undeletable.', v_setnull;
  END IF;

  IF (SELECT count(*) FROM public.lead_score_history) <> 0 THEN
    RAISE EXCEPTION 'PI-LDB-3 postcondition: lead_score_history must be empty on arrival';
  END IF;

  RAISE NOTICE 'PI-LDB-3: lead_score_history created, composite tenant FK, 2 append-only triggers, 0 SET NULL FKs, 0 rows.';
END
$verify$;

-- ---------------------------------------------------------------------------
-- PRIVILEGES. Same reasoning as PI-LDB-1: RLS filters rows for a role that has
-- table privileges, it does not grant them, and the class-wide hardening
-- migrations enumerate their targets so they cannot reach a table created after
-- them. Without this the table is client-writable in production (Supabase's
-- default grant to `authenticated`) and unwritable in CI (baseline carries no
-- ACLs at all).
--
-- No UPDATE and no DELETE, deliberately: the table is append-only and its own
-- triggers refuse both. Granting them would state a permission the schema then
-- contradicts.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.lead_score_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.lead_score_history TO service_role;

-- The guard runs as the invoking role; nothing outside the trigger should call it.
REVOKE ALL ON FUNCTION public.trg_lead_score_history_append_only() FROM PUBLIC, anon, authenticated;

-- Asserted AFTER the grants, for the reason given in 20270201000000.
DO $privs$
BEGIN
  IF has_table_privilege('service_role', 'public.lead_score_history', 'INSERT') IS NOT TRUE THEN
    RAISE EXCEPTION 'PI-LDB-3 postcondition: service_role cannot write lead_score_history';
  END IF;
  IF has_table_privilege('authenticated', 'public.lead_score_history', 'SELECT') IS NOT FALSE THEN
    RAISE EXCEPTION 'PI-LDB-3 postcondition: authenticated still holds SELECT on lead_score_history';
  END IF;
  RAISE NOTICE 'PI-LDB-3 privileges: service_role write granted, client roles revoked.';
END
$privs$;

COMMIT;
