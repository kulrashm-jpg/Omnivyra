-- 20270217000040 - one provider COST invoice per (provider, period), ATOMICALLY (6f; version from 83; e1 rulings as
-- ledger owner; e9 ruling 2026-11-13: btree_gist + an EXCLUSION constraint while 040 is unreleased).
--
-- WHY.
--   The provider COST reconcilers (openai / anthropic / gemini / audio / image) compare ONE invoice against the WHOLE
--   period's estimated spend. Two invoices for overlapping periods (a split invoice, a credit note, a re-cut window)
--   were each matched against the full estimate - the variance was counted twice - and, since cost_reconciliation_runs
--   is unique per (provider, period), the second run overwrote the first one's totals. The intended semantics are ONE
--   invoice per provider per point in time; a split invoice is merged into one manifest by the operator.
--
-- WHAT CHANGED FROM THE EARLIER DRAFT (never applied anywhere - 83 C90: 0 ledger rows, 0 objects).
--   The draft was a partial UNIQUE INDEX on identical bounds, with OVERLAP refused only by reconciliationPersist -
--   app-level and NOT ATOMIC (two concurrent runs with overlapping-but-not-identical periods could both pass it). That
--   was safe only under the one-writer assumption (localhost CLIs). The EXCLUSION constraint below makes the overlap
--   rule hold ATOMICALLY for ANY caller, and is the structural remedy for the reconciliation single-writer assumption
--   (e1's RECONCILE_SINGLE_WRITER_ASSUMPTION record). 05's question, answered for the record: the absence of an
--   exclusion constraint in the draft was NOT deliberate design - btree_gist was simply not installed.
--
-- SCOPE: STRIPE IS EXCLUDED (e1 ruling (A), unchanged). stripeReconciler reconciles customer PAYMENTS and writes
--   provider = 'stripe' exactly; a balance export and a webhook log for one window legitimately coexist. The NEGATIVE
--   predicate is deliberate: a NEW provider gets the period rule by default and fails LOUDLY (23P01, classified by
--   constraint name in reconciliationPersist) if that is wrong.
--
-- WHAT. Schema only - NO data write.
--   1. CREATE EXTENSION btree_gist WITH SCHEMA extensions (Supabase convention; the governed schema keeps extensions
--      there). A preflight refuses with a clear message if the server cannot provide it, so nothing is half-applied.
--      First install in production (83 C90: available = 1, installed = 0) - its own line in the owner approval.
--   2. CHECK provider_invoice_imports_period_nonempty: (provider = 'stripe' OR period_end > period_start). Required by
--      the exclusion rule, not cosmetic: a '[)' range with start = end is EMPTY and overlaps nothing, so a zero-length
--      invoice would slip past the constraint; start > end would make tstzrange() itself raise mid-insert.
--      Sufficient ONLY because provider / period_start / period_end are NOT NULL (20260711:30-33, 05): the CHECK would
--      PASS on NULL, tstzrange(NULL, NULL) is unbounded (it would overlap every row and block the provider), and a NULL
--      provider would let the partial predicate escape the constraint. Keep those columns NOT NULL.
--   3. EXCLUDE provider_invoice_imports_no_overlap USING gist (provider WITH =, tstzrange(period_start, period_end,
--      '[)') WITH &&) WHERE (provider <> 'stripe'). Half-open: ADJACENT periods (one ends where the next starts) do not
--      overlap and are accepted; identical and overlapping periods are refused with 23P01.
--   4. idx_pii_period is KEPT (the draft dropped it): the GiST constraint index is on an EXPRESSION and does not serve
--      reconciliationPersist's column reads (period_start < :end AND period_end > :start).
--   5. Privilege posture RESTATED (enumerative-hardening lesson, e1): anon / authenticated hold nothing; service_role
--      SELECT, INSERT (append-only table: raise_ledger_immutable blocks UPDATE / DELETE).
--   Production holds 0 rows in provider_invoice_imports (83, C58 / C90), so the data preflights cannot fire there.
--
-- ROLLBACK: rollbacks/provider_invoice_imports_one_per_period_rollback.sql (drops the constraint and the CHECK; the
--   extension is dropped only if nothing else depends on it).

-- Preflight 1: the server must be able to provide btree_gist - refuse BEFORE touching anything.
DO $preflight_ext$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
    RAISE EXCEPTION '040 preflight: the btree_gist extension is not available on this server (pg_available_extensions) - the one-invoice-per-period exclusion constraint cannot be created; nothing was changed';
  END IF;
END
$preflight_ext$;

-- Preflight 2: existing cost-provider rows with an empty / inverted period would violate the CHECK - refuse with keys.
DO $preflight_periods$
DECLARE
  v_n int;
  v_sample text;
BEGIN
  SELECT count(*), string_agg(provider || ' ' || provider_invoice_id || ' ' || period_start::text || '..' || period_end::text, '; ')
    INTO v_n, v_sample
    FROM (SELECT provider, provider_invoice_id, period_start, period_end FROM public.provider_invoice_imports
           WHERE provider <> 'stripe' AND period_end <= period_start LIMIT 20) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION '040 preflight: % cost invoice row(s) have an empty or inverted period - correct them first (owner-approved D-step): %', v_n, v_sample;
  END IF;
END
$preflight_periods$;

-- Preflight 3: existing OVERLAPPING cost-provider rows would make the exclusion constraint fail half-way - refuse with keys.
DO $preflight_overlap$
DECLARE
  v_n int;
  v_sample text;
BEGIN
  SELECT count(*), string_agg(k, '; ')
    INTO v_n, v_sample
    FROM (
      SELECT a.provider || ' ' || a.provider_invoice_id || ' x ' || b.provider_invoice_id AS k
        FROM public.provider_invoice_imports a
        JOIN public.provider_invoice_imports b
          ON b.provider = a.provider AND b.id > a.id
         AND b.period_start < a.period_end AND b.period_end > a.period_start
       WHERE a.provider <> 'stripe'
       LIMIT 20
    ) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION '040 preflight: % overlapping cost invoice pair(s) for one provider - merge or archive them first (owner-approved D-step): %', v_n, v_sample;
  END IF;
END
$preflight_overlap$;

-- Preflight 4: a constraint of either name with another definition was not created by this migration - refuse to adopt it.
DO $preflight_names$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.provider_invoice_imports'::regclass AND c.conname = 'provider_invoice_imports_no_overlap';
  IF v_def IS NOT NULL AND v_def <> 'EXCLUDE USING gist (provider WITH =, tstzrange(period_start, period_end, ''[)''::text) WITH &&) WHERE ((provider <> ''stripe''::text))' THEN
    RAISE EXCEPTION '040 preflight: provider_invoice_imports_no_overlap exists with another definition: %', v_def;
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.provider_invoice_imports'::regclass AND c.conname = 'provider_invoice_imports_period_nonempty';
  IF v_def IS NOT NULL AND v_def <> 'CHECK (((provider = ''stripe''::text) OR (period_end > period_start)))' THEN
    RAISE EXCEPTION '040 preflight: provider_invoice_imports_period_nonempty exists with another definition: %', v_def;
  END IF;
END
$preflight_names$;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- An earlier DRAFT of 040 (never applied in any shared environment - 83 C90) created this index; a sandbox that ran
-- the draft must not keep it alongside the constraint.
DROP INDEX IF EXISTS public.provider_invoice_imports_one_per_period_uidx;

DO $add_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.provider_invoice_imports'::regclass
                  AND conname = 'provider_invoice_imports_period_nonempty') THEN
    ALTER TABLE public.provider_invoice_imports
      ADD CONSTRAINT provider_invoice_imports_period_nonempty CHECK (provider = 'stripe' OR period_end > period_start);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.provider_invoice_imports'::regclass
                  AND conname = 'provider_invoice_imports_no_overlap') THEN
    ALTER TABLE public.provider_invoice_imports
      ADD CONSTRAINT provider_invoice_imports_no_overlap
      EXCLUDE USING gist (provider WITH =, tstzrange(period_start, period_end, '[)') WITH &&)
      WHERE (provider <> 'stripe');
  END IF;
END
$add_constraints$;

-- Privilege posture, restated.
REVOKE ALL ON TABLE public.provider_invoice_imports FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.provider_invoice_imports TO service_role;

-- Postcondition: exactly what this migration promises, measured from the catalog.
DO $verify$
DECLARE
  v_ext_schema text;
  v_def text;
  v_contype "char";
  v_valid boolean;
  r text;
  p text;
BEGIN
  SELECT n.nspname INTO v_ext_schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'btree_gist';
  IF v_ext_schema IS NULL THEN
    RAISE EXCEPTION '040 postcondition: btree_gist is not installed';
  END IF;
  IF v_ext_schema <> 'extensions' THEN
    RAISE EXCEPTION '040 postcondition: btree_gist is installed in schema % (expected extensions)', v_ext_schema;
  END IF;

  SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) INTO v_contype, v_valid, v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.provider_invoice_imports'::regclass AND c.conname = 'provider_invoice_imports_no_overlap';
  IF v_contype IS DISTINCT FROM 'x' OR NOT coalesce(v_valid, false)
     OR v_def IS DISTINCT FROM 'EXCLUDE USING gist (provider WITH =, tstzrange(period_start, period_end, ''[)''::text) WITH &&) WHERE ((provider <> ''stripe''::text))' THEN
    RAISE EXCEPTION '040 postcondition: exclusion constraint provider_invoice_imports_no_overlap missing, invalid or of another definition (contype %, valid %): %',
      v_contype, v_valid, coalesce(v_def, '<none>');
  END IF;

  SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid) INTO v_contype, v_valid, v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.provider_invoice_imports'::regclass AND c.conname = 'provider_invoice_imports_period_nonempty';
  IF v_contype IS DISTINCT FROM 'c' OR NOT coalesce(v_valid, false)
     OR v_def IS DISTINCT FROM 'CHECK (((provider = ''stripe''::text) OR (period_end > period_start)))' THEN
    RAISE EXCEPTION '040 postcondition: CHECK provider_invoice_imports_period_nonempty missing, invalid or of another definition: %', coalesce(v_def, '<none>');
  END IF;

  IF to_regclass('public.provider_invoice_imports_one_per_period_uidx') IS NOT NULL THEN
    RAISE EXCEPTION '040 postcondition: the draft unique index provider_invoice_imports_one_per_period_uidx still exists';
  END IF;
  IF to_regclass('public.idx_pii_period') IS NULL THEN
    RAISE EXCEPTION '040 postcondition: idx_pii_period (the column-read index) is missing';
  END IF;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(r, 'public.provider_invoice_imports', p) THEN
        RAISE EXCEPTION '040 postcondition: % still holds % on provider_invoice_imports', r, p;
      END IF;
    END LOOP;
    -- has_table_privilege does NOT see column-level grants (e1): check those separately.
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(r, 'public.provider_invoice_imports', p) THEN
        RAISE EXCEPTION '040 postcondition: % holds a column-level % on provider_invoice_imports', r, p;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
    IF NOT has_table_privilege('service_role', 'public.provider_invoice_imports', p) THEN
      RAISE EXCEPTION '040 postcondition: service_role lacks % on provider_invoice_imports', p;
    END IF;
  END LOOP;
END
$verify$;
