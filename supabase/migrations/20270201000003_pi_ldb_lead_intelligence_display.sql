-- PI-LDB-4 — a human-readable label on the durable lead store.
--
-- ─── THE GAP THIS CLOSES ────────────────────────────────────────────────────
-- `CanonicalLeadInput.display` has always existed, and `assemble()` in
-- adapters.ts has always populated it from each source row's name and title
-- columns. Two layers then dropped it:
--
--   * `viewFromInput` did not copy it into `CanonicalLeadView` (fixed in code),
--   * `toRow` did not persist it (this migration gives it somewhere to go).
--
-- The visible consequence: a prospect rendered as an email address with no name
-- beside it, on every surface, because the read model carried no name field at
-- all. For an imported prospect it was worse than that — `canonical_leads`
-- deliberately stores no person attributes, so there was no name anywhere on
-- the read path.
--
-- ─── WHY A COLUMN AND NOT THE EXISTING `metadata` CATCH-ALL ─────────────────
-- `lead_intelligence.metadata` holds `attribution.sourceMetadata`, which the
-- contract defines as "every raw field not mapped above — preserved verbatim".
-- Writing our own derived labels in beside the provider's raw fields would
-- destroy that property: a later reader could no longer tell which keys the
-- provider actually sent from which ones we synthesised. Provenance that cannot
-- distinguish its own inventions from the source is not provenance.
--
-- A dedicated nullable column keeps the two separable, and costs one jsonb.
--
-- ─── SHAPE ──────────────────────────────────────────────────────────────────
-- `{ "name": string|null, "title": string|null, "contentText": string|null }`,
-- mirroring `CanonicalLeadInput['display']` exactly. Nullable, no default: a
-- lead projected from a source table with no name column genuinely has no name,
-- and NULL says so rather than implying an empty one.
--
-- Additive. No existing column, constraint, index, policy or row is modified.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.lead_intelligence') IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-4 precondition: lead_intelligence is missing. This migration only widens the durable lead store.';
  END IF;
END
$pre$;

ALTER TABLE public.lead_intelligence
  ADD COLUMN IF NOT EXISTS display jsonb;

DO $checks$
BEGIN
  -- An object or nothing. A bare string or array here would make every reader
  -- that does `display->>'name'` return NULL silently rather than fail, which
  -- is the quiet kind of wrong this constraint exists to prevent.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'lead_intelligence_display_is_object') THEN
    ALTER TABLE public.lead_intelligence
      ADD CONSTRAINT lead_intelligence_display_is_object
      CHECK (display IS NULL OR jsonb_typeof(display) = 'object');
  END IF;
END
$checks$;

-- Name search without a full scan of the jsonb. A trigram index would serve
-- substring search better, but pg_trgm is not guaranteed present in every
-- environment this schema is built in, and a btree on the extracted name
-- already serves the exact-match and prefix cases the list view issues.
CREATE INDEX IF NOT EXISTS idx_lead_intelligence_display_name
  ON public.lead_intelligence ((display ->> 'name'))
  WHERE display ? 'name';

COMMENT ON COLUMN public.lead_intelligence.display IS
  'How a human recognises this lead: { name, title, contentText }. Mirrors CanonicalLeadInput.display. Kept OUT of metadata so synthesised labels stay separable from the provider''s verbatim raw fields.';

DO $verify$
DECLARE
  v_type text;
  v_null text;
BEGIN
  SELECT data_type, is_nullable INTO v_type, v_null
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'lead_intelligence' AND column_name = 'display';

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'PI-LDB-4 postcondition: the display column is missing';
  END IF;
  IF v_type <> 'jsonb' THEN
    RAISE EXCEPTION 'PI-LDB-4 postcondition: display is %, expected jsonb', v_type;
  END IF;
  -- Asserted, not assumed: a NOT NULL here would break every existing writer,
  -- and there are rows in this table in environments that have been running.
  IF v_null <> 'YES' THEN
    RAISE EXCEPTION 'PI-LDB-4 postcondition: display must be nullable to stay additive';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_intelligence_display_is_object') THEN
    RAISE EXCEPTION 'PI-LDB-4 postcondition: the display shape check is missing';
  END IF;

  -- The store's own identity key must be untouched: this migration must not
  -- have changed how a lead dedupes.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'lead_intelligence'
                    AND column_name = 'dedupe_key') THEN
    RAISE EXCEPTION 'PI-LDB-4 postcondition: dedupe_key is missing from lead_intelligence';
  END IF;

  RAISE NOTICE 'PI-LDB-4: lead_intelligence.display added (jsonb, nullable), shape check and name index in place, dedupe_key intact.';
END
$verify$;

COMMIT;
