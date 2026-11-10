-- PI-LDB 2F / D2+D3 — the durable, authoritative origin classification.
--
-- ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
-- `origin.category` decides `lead_captured` (+15, "Submitted a lead form") and
-- the "Converted / Lead captured" wording in the decision journey. It was never
-- persisted: `toRow` dropped it, so `rowToView` could not restore it, and the
-- ONLY surviving copy for a canonical prospect was
-- `prospect_source_contributions.source_category`, reachable only by an external
-- provenance read. Three consequences, all measured in the 2F audit:
--
--   * a provenance read failure silently removed the 15-point contribution from
--     a contact and could move an account-level recommendation, even though the
--     prospect had not changed;
--   * `getCompanyIntelligence` and the default `listAllLeads` never attach
--     provenance at all, so the same prospect scored one way on the lead screen
--     and another in the account rollup;
--   * a durable row projected from `leads` can never recover it: its
--     `source_table` is not `canonical_leads`, so `canonicalProspectIdOf`
--     returns NULL and no provenance read is even attempted.
--
-- D2 (owner ruling, 2026-11-07): this column is the AUTHORITATIVE durable
-- semantic classification used by score calculation and journey presentation.
-- It is NOT a cache. The source assertions and source records remain the
-- detailed provenance and audit evidence; this is the decided classification.
--
-- ─── WHAT MAY WRITE IT ──────────────────────────────────────────────────────
-- Only an EXPLICITLY ASSERTED category, from the ingestion contract's profile
-- table (prospectProvenance/ingestion/sourceProfiles.ts). Never inferred from a
-- display source, a provider name or a source label. That is not a style
-- preference: adapters.ts contains two such inferences today — `crmAdapter`
-- derives `pi_discovery` from provider-name set membership, and
-- `websiteAdapter` derives `inbound_form` from the free-text `leads.source`
-- string matching 'form' after whitespace/hyphen normalisation. Persisting
-- either would turn "Submitted a lead form" into a DURABLE claim about
-- something a human did, manufactured from a label an operator typed. The write
-- boundary therefore requires `origin.provenance === 'asserted'`; an adapter
-- hint reaches the column as NULL, and the trigger below leaves any stored
-- value alone.
--
-- ─── NULL ───────────────────────────────────────────────────────────────────
-- NULL means NOBODY RECORDED EVIDENCE, and it stays fail-closed:
-- `hasLeadFormEvidence` tests `=== 'inbound_form'`, so NULL earns nothing. No
-- default, and NO BACKFILL — the only values a backfill could use are the two
-- inferences above. `source_records.source_category` set the same precedent
-- (20270107000000): nullable, no default, existing rows untouched.
--
-- ─── D3: WHAT origin_observed_at MEANS ──────────────────────────────────────
-- The time OMNIVYRA FIRST ACCEPTED the evidence establishing the CURRENT
-- classification. Deliberately NOT the source event's `occurred_at`, not
-- `created_at`, not `updated_at`, and not a repeated synchronisation stamp —
-- those answer different questions and the ruling names each of them.
--
-- Repeated ingestion of the same evidence must PRESERVE the first acceptance
-- time, and a supersession must move the category and the timestamp TOGETHER
-- and atomically. That is enforced by a trigger rather than by the writer,
-- because the canonical write is a full-row `resolution=merge-duplicates`
-- upsert that assigns every key in its body: any JS-side rule would be one
-- writer's discipline, and this store already has four write paths (the
-- ingestion orchestrator, the website runtime, projection reconciliation and
-- the operator CLI). In the trigger it is a property of the table. It also
-- costs no extra round trip, which matters on a synchronous import path.
--
-- Additive. No existing column, constraint, index, policy or row is modified,
-- and `dedupe_key` is untouched — this migration does not change how a lead
-- dedupes. A new column inherits the table's ACL, so there is nothing to
-- revoke here.
-- Rollback: rollbacks/pi_ldb_lead_intelligence_origin_category_rollback.sql

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.lead_intelligence') IS NULL THEN
    RAISE EXCEPTION 'PI-LDB 2F precondition: lead_intelligence is missing. This migration only widens the durable lead store.';
  END IF;
END
$pre$;

ALTER TABLE public.lead_intelligence
  ADD COLUMN IF NOT EXISTS origin_category text;

ALTER TABLE public.lead_intelligence
  ADD COLUMN IF NOT EXISTS origin_observed_at timestamptz;

DO $checks$
BEGIN
  -- The CONTROLLED VOCABULARY, character-identical to the two existing mirrors
  -- (`source_records_source_category_valid` and `psc_source_category_valid` in
  -- 20270107000000) and to SOURCE_CATEGORIES in lib/prospectProvenance/
  -- contract.ts. Nullable form, like source_records: a durable row may
  -- legitimately carry no recorded category. 'unknown' is deliberately NOT a
  -- member — absence is expressed by NULL, and admitting a literal would let
  -- stats.ts's display-only `?? 'unknown'` leak into stored data.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lead_intelligence_origin_category_valid') THEN
    ALTER TABLE public.lead_intelligence
      ADD CONSTRAINT lead_intelligence_origin_category_valid
      CHECK (origin_category IS NULL OR origin_category IN (
        'marketpulse', 'social_listening', 'community', 'engagement',
        'inbound_form', 'inbound_webhook', 'manual', 'crm', 'csv',
        'pi_discovery', 'pi_enrichment', 'website'));
  END IF;

  -- An observation with nothing observed is not a fact about anything. The
  -- converse IS allowed: D3 says keep NULL where no trustworthy acceptance
  -- time exists rather than fabricating one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lead_intelligence_origin_observed_needs_category') THEN
    ALTER TABLE public.lead_intelligence
      ADD CONSTRAINT lead_intelligence_origin_observed_needs_category
      CHECK (origin_category IS NOT NULL OR origin_observed_at IS NULL);
  END IF;
END
$checks$;

-- ─── THE D3 INVARIANT, AS A PROPERTY OF THE TABLE ───────────────────────────
CREATE OR REPLACE FUNCTION public.lead_intelligence_origin_evidence()
RETURNS trigger
LANGUAGE plpgsql
-- Pinned even though this is not SECURITY DEFINER: it resolves only built-in
-- operators, and a search_path it does not control is a hazard for free.
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Nothing is stored yet, so the write's own evidence stands as given,
    -- including the absence of it. The CHECK above also forbids an observation
    -- without a category; normalising here keeps the writer from having to.
    IF NEW.origin_category IS NULL THEN
      NEW.origin_observed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.origin_category IS NULL THEN
    -- THE WRITE CARRIES NO ORIGIN EVIDENCE, which is not the same thing as
    -- evidence that there is none. D2 permits a change of category only when
    -- superseding evidence is accepted and recorded, so a write that asserts
    -- nothing may not erase what is stored. This is the same rule as the
    -- protective score read: never overwrite what the write cannot see.
    NEW.origin_category    := OLD.origin_category;
    NEW.origin_observed_at := OLD.origin_observed_at;
    RETURN NEW;
  END IF;

  IF OLD.origin_category IS NOT NULL AND NEW.origin_category = OLD.origin_category THEN
    -- REPEATED INGESTION OF THE SAME EVIDENCE (D3). The classification did not
    -- change, so this is not a new acceptance and the FIRST one stands. Without
    -- this the full-row upsert would advance the timestamp on every re-sync and
    -- the column would quietly become "last seen" — one of the four meanings
    -- the ruling explicitly forbids it from having.
    NEW.origin_observed_at := OLD.origin_observed_at;
    RETURN NEW;
  END IF;

  -- Either the first classification this row has carried, or an explicit
  -- supersession. Both fields move together, in this one statement, which is
  -- what makes the pair atomic (D3).
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.lead_intelligence_origin_evidence() IS
  'D3: preserves the first acceptance time while the origin classification is unchanged, refuses to erase a stored classification from a write that asserts none, and moves category and observation together on an explicit supersession.';

DROP TRIGGER IF EXISTS trg_lead_intelligence_origin_evidence ON public.lead_intelligence;
CREATE TRIGGER trg_lead_intelligence_origin_evidence
  BEFORE INSERT OR UPDATE ON public.lead_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.lead_intelligence_origin_evidence();

-- Tenant-leading, like every other index on this table (20260629000000:32-34),
-- because computeLeadStats aggregates per tenant. Partial: a NULL category is
-- the normal state for a pre-2F row and indexing it buys nothing.
CREATE INDEX IF NOT EXISTS idx_lead_intelligence_company_origin_category
  ON public.lead_intelligence (company_id, origin_category)
  WHERE origin_category IS NOT NULL;

COMMENT ON COLUMN public.lead_intelligence.origin_category IS
  'D2: the AUTHORITATIVE durable origin classification used by scoring and journey presentation (not a cache). One of lib/prospectProvenance/contract.ts SOURCE_CATEGORIES. Written only from an explicitly asserted ingestion-contract category, never inferred from a display source, provider name or source label. NULL = nobody recorded evidence, and stays fail-closed.';

COMMENT ON COLUMN public.lead_intelligence.origin_observed_at IS
  'D3: when Omnivyra FIRST accepted the evidence establishing the current origin_category. Not the source event time, not created_at, not updated_at, not a re-sync stamp. Preserved across repeated ingestion of the same evidence; moves with origin_category on an explicit supersession. NULL when no trustworthy acceptance time exists.';

DO $verify$
DECLARE
  v_cat_type text;
  v_cat_null text;
  v_obs_type text;
  v_obs_null text;
BEGIN
  SELECT data_type, is_nullable INTO v_cat_type, v_cat_null
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'lead_intelligence' AND column_name = 'origin_category';
  SELECT data_type, is_nullable INTO v_obs_type, v_obs_null
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'lead_intelligence' AND column_name = 'origin_observed_at';

  IF v_cat_type IS NULL OR v_obs_type IS NULL THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: an origin column is missing (category=%, observed=%)', v_cat_type, v_obs_type;
  END IF;
  IF v_cat_type <> 'text' THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: origin_category is %, expected text', v_cat_type;
  END IF;
  IF v_obs_type <> 'timestamp with time zone' THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: origin_observed_at is %, expected timestamptz', v_obs_type;
  END IF;
  -- Both nullable, asserted rather than assumed: NOT NULL on either would
  -- refuse every pre-2F row and every write that records no origin evidence.
  IF v_cat_null <> 'YES' OR v_obs_null <> 'YES' THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: both origin columns must stay nullable (category=%, observed=%)', v_cat_null, v_obs_null;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_intelligence_origin_category_valid') THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: the origin_category vocabulary check is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_intelligence_origin_observed_needs_category') THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: the observation-needs-category check is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lead_intelligence_origin_evidence'
                   AND tgrelid = 'public.lead_intelligence'::regclass) THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: the D3 origin-evidence trigger is missing';
  END IF;

  -- NO BACKFILL. Asserted, because a later edit that added one would otherwise
  -- pass every other check in this file.
  IF EXISTS (SELECT 1 FROM public.lead_intelligence WHERE origin_category IS NOT NULL) THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: a row already carries an origin_category — this migration must not backfill';
  END IF;

  -- The store's own identity key must be untouched.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                    AND column_name = 'dedupe_key') THEN
    RAISE EXCEPTION 'PI-LDB 2F postcondition: dedupe_key is missing from lead_intelligence';
  END IF;

  RAISE NOTICE 'PI-LDB 2F: origin_category (text, nullable) and origin_observed_at (timestamptz, nullable) added, vocabulary and pairing checks in place, D3 trigger installed, no rows backfilled, dedupe_key intact.';
END
$verify$;

COMMIT;
