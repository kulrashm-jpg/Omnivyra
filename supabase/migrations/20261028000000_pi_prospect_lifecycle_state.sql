-- PI contract #10 (PI-ADR-004) — the PROSPECT LIFECYCLE TRANSITION LEDGER.
--
-- AUTHORED, NOT APPLIED. No database was touched to produce this file.
--
-- ─── WHAT THIS IS ──────────────────────────────────────────────────────────
-- An append-only ledger of prospect lifecycle transitions, keyed to the PI
-- prospect (`canonical_leads`). The CURRENT state of a prospect is the latest
-- row; history is free. There is no "current state" column anywhere, so no
-- second authority can drift from it.
--
-- The shape is copied from `opportunity_lifecycle_states`
-- (20260520_phase6_realtime_lifecycle_workflow.sql) — the best shape in the
-- repository for this job — with the two gaps PI-ADR-004 §3 named FIXED rather
-- than inherited:
--   1. it rejected `from = to`, so a reassessment that concluded "still
--      nurture" was an error. Here a reassessment row is LEGAL: nothing forbids
--      `state = previous_state`. Debounce is the writer's job, not a CHECK's.
--   2. it had no typed evidence reference and no origin flag. Here every
--      transition cites its evidence with a real foreign key where the evidence
--      lives in a table (PI-ADR-002 §4), and declares `human` or `derived`
--      (`operational_tasks` already has that discipline; a model has no user id).
--
-- ─── WHY NOT `operational_states` ──────────────────────────────────────────
-- Settled by PI-ADR-004 §2 and not re-argued here. The decisive fact is the
-- anchor: its `entity_id` for a canonical lead is `leadKeyFor(view)`, a
-- `::`-delimited composite whose fallback form embeds `occurredAt`
-- (lib/leadIntelligence/leadKey.ts:17-23). A prospect lifecycle must survive
-- months of re-ingestion; that key does not. This table's anchor is
-- `canonical_leads.id`, a uuid, behind a composite tenant foreign key — so the
-- rejected identifier is not merely discouraged, it is UNREPRESENTABLE (a
-- `::`-delimited string cannot be cast to uuid). See also the
-- `..._event_key_no_leadkey` CHECK below, which refuses it on the event axis
-- too.
--
-- ─── SIX STATES, NOT SEVEN ─────────────────────────────────────────────────
-- PI-ADR-004 §5 left "is `outreach-active` a state or a projection over
-- `outreach_tasks`" open. WS-C decides: A PROJECTION. It is not in this
-- vocabulary and it is not stored. Reasons, in order of weight:
--   • PI DECIDES, OUTREACH EXECUTES. `outreach_tasks.status` is the canonical
--     17-state per-task lifecycle and PI is forbidden to write it (PI-ADR-002
--     §3.2.3 — the intelligence layer may READ the outreach ledger and may
--     never write it). Persisting `outreach-active` would make PI's ledger a
--     MIRROR of execution state that PI cannot keep current.
--   • It would go stale in the same way the stored `suppressed` verdict goes
--     stale, for the same structural reason: the fact lives in another table
--     that changes without telling us. A prospect showing `outreach-active`
--     after every task was cancelled is a lie of exactly the class §4.1 bans.
--   • The join is not even provable. `outreach_tasks.lead_id` is `text` and was
--     DELIBERATELY not retyped (20261011000000_a3_outreach_person_anchor.sql);
--     that migration records that it is not proven to be a lead id at all. The
--     one edge that IS foreign-keyed on both sides is the person:
--     `outreach_tasks.(person_id, company_id) -> unified_persons(id, company_id)`
--     and `canonical_leads.unified_person_id`. The projection is computed over
--     that edge at read time, beside `mayContact` and `assessOutreachReadiness`.
-- The prospect's resting position while outreach executes is `qualified` — PI
-- said pursue, and nothing about the PROSPECT has changed until the recipient
-- does something. The first prospect-caused change is `engaged`.
--
-- ─── AND THEREFORE `reactivation` IS `nurture -> qualified` ────────────────
-- PI-ADR-004 §4.1 describes reactivation parenthetically as
-- `nurture -> outreach-active`. With `outreach-active` dropped it becomes
-- `nurture -> qualified`, which is the honest spelling: reactivation means
-- "this prospect is once again worth pursuing", and `qualified` is the one
-- state that means exactly that. Recorded here because it is a deviation from
-- the ADR's wording, not from its intent.
--
-- ─── WHAT THIS DOES NOT CARRY (PI-ADR-004 §4) ──────────────────────────────
--   ownership/handoff -> `operational_assignments`     notes/tasks -> `operational_notes`/`operational_tasks`
--   outcome events    -> `outreach_outcomes`           suppression/readiness -> computed, NEVER stored
--   identity          -> `unified_persons`/`canonical_leads`
-- `suppressed`, `outreach-ready` and `no-response` are computed verdicts. A
-- stale stored `suppressed` is a compliance incident, not a data-quality issue.
--
-- ─── CONSEQUENCE: A TENANT HARD-DELETE IS BLOCKED ──────────────────────────
-- `organization_id` cascades from `companies`, and the append-only trigger
-- refuses DELETE, so a cascading company delete aborts. This is IDENTICAL to
-- the behaviour `opportunity_lifecycle_states` has had since 20260520 — the
-- precedent, not a new hazard. Purge is PI-CONTRACT-002's concern (data
-- lifecycle); inventing a purge path here would be a second authority over
-- deletion. Stated so it is a known property rather than a surprise.

-- ---------------------------------------------------------------------------
-- 0. Parent key for the tenant-safe composite foreign key to the evidence.
-- ---------------------------------------------------------------------------
-- `source_records` already has `uq_source_records_id_org` (LI-2).
-- `outreach_outcomes` has no `(id, company_id)` unique index, so a composite
-- tenant-safe FK to it cannot exist yet. Adding one is additive, idempotent and
-- costs nothing (the outreach family was verified empty in 20261011000000).
-- Its `company_id` is already `uuid` — that same migration retyped all nine
-- outreach tables — so the composite FK below type-checks.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outreach_outcomes_id_company
  ON public.outreach_outcomes (id, company_id);

-- ---------------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prospect_lifecycle_transitions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A total, monotonic order per table. `transitioned_at` is BUSINESS time and
  -- two transitions can legitimately share it; state reconstruction must not
  -- depend on a clock or on uuid ordering. Combined with the per-prospect
  -- advisory lock the trigger takes, sequence order equals commit order, so
  -- "the latest row" is a fact and not a tie-break heuristic.
  seq                       bigint GENERATED ALWAYS AS IDENTITY,

  -- TENANT. uuid, never text — every prospect table uses uuid and
  -- `operational_states.company_id` being FK-less text is half of why it was
  -- rejected as the home.
  organization_id           uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,

  -- THE SUBJECT: the PI prospect. Composite FK below.
  prospect_id               uuid NOT NULL,

  state                     text NOT NULL,
  -- NULL only on the initial row. A reassessment row deliberately carries
  -- `previous_state = state`; see the header.
  previous_state            text,
  is_initial                boolean NOT NULL DEFAULT false,

  -- `human` or `derived`. A model has no user id, and without this column a
  -- machine transition is indistinguishable from an operator's.
  origin                    text NOT NULL,

  -- TYPED EVIDENCE CITATION (PI-ADR-002 §4). The kind is closed and CHECKed;
  -- where the evidence lives in a table, the citation is a real tenant-safe
  -- foreign key rather than a bare id. Two nullable typed columns with a CHECK
  -- admitting one, following `prospect_enrichment_attempts` — the alternative
  -- (one polymorphic `evidence_id` with no FK) is exactly the FK-less anchor
  -- PI-ADR-004 §2 refused.
  evidence_kind             text NOT NULL,
  evidence_outcome_id       uuid,
  evidence_source_record_id uuid,
  -- SUMMARY ONLY — never a message body, transcript or provider payload.
  -- Content lives in `source_records`. (LI-3D's rule, same reason.)
  evidence_detail           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- IDEMPOTENCY / DEBOUNCE ANCHOR — see the CHECKs and the partial index. A
  -- stable identifier for the CAUSE of this transition. Nullable, because a
  -- human action need not have one; partial-unique where present.
  source_event_key          text,

  reasoning                 text,
  -- Only a `human` transition names an actor; a `derived` one never does.
  actor_user_id             uuid REFERENCES public.users (id) ON DELETE SET NULL,
  -- Which derivation produced this, so a rule change stays auditable.
  model_version             text,

  transitioned_at           timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),

  -- COMPOSITE TENANT FK to the prospect spine. `canonical_leads` already
  -- carries `idx_canonical_leads_id_company` as the parent key. This is what
  -- makes attaching Tenant A's prospect to a Tenant B row a 23503 rather than a
  -- silent cross-tenant write.
  CONSTRAINT prospect_lifecycle_prospect_fk
    FOREIGN KEY (prospect_id, organization_id)
    REFERENCES public.canonical_leads (id, company_id) ON DELETE CASCADE,

  -- RESTRICT, not SET NULL: a citation that can quietly become NULL is a
  -- citation that can quietly become a lie, and both tables are append-only.
  CONSTRAINT prospect_lifecycle_outcome_fk
    FOREIGN KEY (evidence_outcome_id, organization_id)
    REFERENCES public.outreach_outcomes (id, company_id) ON DELETE RESTRICT,

  CONSTRAINT prospect_lifecycle_source_record_fk
    FOREIGN KEY (evidence_source_record_id, organization_id)
    REFERENCES public.source_records (id, organization_id) ON DELETE RESTRICT,

  -- VOCABULARY IN THE DATABASE, not only in TypeScript. Six states plus the
  -- initial one. `outreach-active` is absent by decision (header); `suppressed`,
  -- `outreach-ready` and `no-response` are absent because they are verdicts and
  -- outcomes, not resting positions; `candidate` is absent because it is a
  -- different ENTITY (PI-ADR-003).
  CONSTRAINT prospect_lifecycle_state_valid CHECK (state IN (
    'identified', 'qualified', 'engaged', 'nurture',
    'meeting_scheduled', 'not_interested', 'closed_disqualified'
  )),
  CONSTRAINT prospect_lifecycle_previous_state_valid CHECK (
    previous_state IS NULL OR previous_state IN (
      'identified', 'qualified', 'engaged', 'nurture',
      'meeting_scheduled', 'not_interested', 'closed_disqualified'
    )
  ),

  CONSTRAINT prospect_lifecycle_origin_valid CHECK (origin IN ('human', 'derived')),

  CONSTRAINT prospect_lifecycle_evidence_kind_valid CHECK (evidence_kind IN (
    'outreach_outcome', 'source_record', 'contact_governance',
    'icp_evaluation', 'engagement_thread', 'human_action'
  )),

  -- The kind and the foreign key must agree, and at most one may be set. A row
  -- claiming `outreach_outcome` without naming the outcome is not a citation.
  CONSTRAINT prospect_lifecycle_evidence_typed CHECK (
       (evidence_kind = 'outreach_outcome'
          AND evidence_outcome_id IS NOT NULL AND evidence_source_record_id IS NULL)
    OR (evidence_kind = 'source_record'
          AND evidence_source_record_id IS NOT NULL AND evidence_outcome_id IS NULL)
    OR (evidence_kind NOT IN ('outreach_outcome', 'source_record')
          AND evidence_outcome_id IS NULL AND evidence_source_record_id IS NULL)
  ),

  CONSTRAINT prospect_lifecycle_origin_actor CHECK (
       (origin = 'human'   AND actor_user_id IS NOT NULL)
    OR (origin = 'derived' AND actor_user_id IS NULL)
  ),

  -- The initial row has no predecessor; every later row has one. The chain
  -- itself is enforced by the trigger, which is the only thing that can compare
  -- a row against the rows already there.
  CONSTRAINT prospect_lifecycle_initial_shape CHECK (
       (is_initial     AND previous_state IS NULL)
    OR (NOT is_initial AND previous_state IS NOT NULL)
  ),

  -- RE-INGESTION STABILITY, enforced rather than asserted. The event key names
  -- its cause with a closed prefix vocabulary and an opaque suffix that may not
  -- contain a colon — which makes a `::`-delimited leadKey, and in particular
  -- its `up::<source>::<email>::<occurredAt>` form, structurally inexpressible.
  CONSTRAINT prospect_lifecycle_event_key_shape CHECK (
    source_event_key IS NULL
    OR source_event_key ~ '^(outcome|evidence|governance|derivation|human):[A-Za-z0-9._-]{1,200}$'
  ),
  -- Stated separately so the refusal is visible in the constraint name. The
  -- shape CHECK already implies it; this is the one a reviewer will read.
  CONSTRAINT prospect_lifecycle_event_key_no_leadkey CHECK (
    source_event_key IS NULL OR position('::' IN source_event_key) = 0
  ),

  CONSTRAINT prospect_lifecycle_reasoning_length CHECK (
    reasoning IS NULL OR length(reasoning) BETWEEN 1 AND 2000
  )
);

-- ---------------------------------------------------------------------------
-- 2. Indexes.
-- ---------------------------------------------------------------------------

-- One initial transition per prospect, tenant-scoped. PARTIAL, so PostgREST
-- cannot infer it for `ON CONFLICT` (42P10) — the writer INSERTs and catches
-- 23505, the LI-2/LI-3 discipline.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_lifecycle_initial
  ON public.prospect_lifecycle_transitions (organization_id, prospect_id)
  WHERE is_initial = TRUE;

-- THE IDEMPOTENCY KEY. One transition per (tenant, prospect, source event).
-- A replayed outcome webhook, a re-run derivation and a re-ingested source
-- record all resolve to the same key and therefore to the same single row.
-- PARTIAL for the same reason: `ON CONFLICT` cannot infer it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospect_lifecycle_source_event
  ON public.prospect_lifecycle_transitions (organization_id, prospect_id, source_event_key)
  WHERE source_event_key IS NOT NULL;

-- "What is this prospect's state now" and "replay its history in order".
CREATE INDEX IF NOT EXISTS idx_prospect_lifecycle_current
  ON public.prospect_lifecycle_transitions (organization_id, prospect_id, seq DESC);

-- "Which prospects are in state X" — the board read.
CREATE INDEX IF NOT EXISTS idx_prospect_lifecycle_org_state
  ON public.prospect_lifecycle_transitions (organization_id, state, transitioned_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Append-only, and the chain invariant.
-- ---------------------------------------------------------------------------
-- The trigger enforces the two things no CHECK can see, because a CHECK sees
-- one row: that nothing is ever updated or deleted, and that `previous_state`
-- names the state the prospect was ACTUALLY in.
--
-- Not SECURITY DEFINER: it must run with the caller's privileges so it cannot
-- become a cross-tenant read primitive.
CREATE OR REPLACE FUNCTION public.trg_prospect_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_current text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'prospect_lifecycle_transitions is append-only (UPDATE refused)'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prospect_lifecycle_transitions is append-only (DELETE refused)'
      USING ERRCODE = '42501';
  END IF;

  -- Serialise every writer for THIS prospect. Without it two concurrent
  -- workers both read the same latest row, both find their `previous_state`
  -- agrees, and both append — producing a fork the "latest row" rule then
  -- silently resolves. The lock is transaction-scoped and per-prospect, so it
  -- costs nothing across tenants.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.prospect_id::text, 0));

  IF NEW.is_initial THEN
    -- Double-initialisation has exactly one enforcer: the partial unique index
    -- `uq_prospect_lifecycle_initial`. Two enforcers would mean two error
    -- codes for one fact.
    RETURN NEW;
  END IF;

  SELECT t.state INTO v_current
    FROM public.prospect_lifecycle_transitions t
   WHERE t.organization_id = NEW.organization_id
     AND t.prospect_id     = NEW.prospect_id
   ORDER BY t.seq DESC
   LIMIT 1;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'the first transition for a prospect must be the initial row'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.previous_state IS DISTINCT FROM v_current THEN
    RAISE EXCEPTION 'previous_state % does not match the current state % — the ledger is a chain, not a set',
      NEW.previous_state, v_current
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS prospect_lifecycle_block_update ON public.prospect_lifecycle_transitions;
CREATE TRIGGER prospect_lifecycle_block_update
  BEFORE UPDATE ON public.prospect_lifecycle_transitions
  FOR EACH ROW EXECUTE FUNCTION public.trg_prospect_lifecycle_guard();

DROP TRIGGER IF EXISTS prospect_lifecycle_block_delete ON public.prospect_lifecycle_transitions;
CREATE TRIGGER prospect_lifecycle_block_delete
  BEFORE DELETE ON public.prospect_lifecycle_transitions
  FOR EACH ROW EXECUTE FUNCTION public.trg_prospect_lifecycle_guard();

DROP TRIGGER IF EXISTS prospect_lifecycle_chain ON public.prospect_lifecycle_transitions;
CREATE TRIGGER prospect_lifecycle_chain
  BEFORE INSERT ON public.prospect_lifecycle_transitions
  FOR EACH ROW EXECUTE FUNCTION public.trg_prospect_lifecycle_guard();

-- ---------------------------------------------------------------------------
-- 4. RLS — in the same migration, service-role only.
-- ---------------------------------------------------------------------------
-- Supabase grants ALL on every new public table to `authenticated`, so an
-- un-RLS'd table is served cross-tenant to any signed-up user. Every PI table
-- is service-role only: this surface is reachable solely through server routes
-- that prove tenancy themselves.
ALTER TABLE public.prospect_lifecycle_transitions ENABLE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'prospect_lifecycle_transitions'
       AND policyname = 'service_role_full_access'
  ) THEN
    CREATE POLICY service_role_full_access
      ON public.prospect_lifecycle_transitions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$rls$;

COMMENT ON TABLE public.prospect_lifecycle_transitions IS
  'PI contract #10 (PI-ADR-004). Append-only prospect lifecycle transition ledger. '
  'Current state = the row with the greatest seq for (organization_id, prospect_id). '
  'Six states plus an initial one; outreach-active is a read-time projection over '
  'outreach_tasks, not a stored state. suppressed / outreach-ready / no-response are '
  'computed verdicts and are NEVER stored here.';

COMMENT ON COLUMN public.prospect_lifecycle_transitions.source_event_key IS
  'Stable identifier for the CAUSE of this transition — outcome:/evidence:/governance:/'
  'derivation:/human: plus an opaque colon-free suffix. Re-ingestion of the same cause '
  'yields the same key and therefore the same single row. A leadKey composite is refused '
  'by CHECK: its fallback form embeds occurredAt and is not stable across re-ingestion.';
