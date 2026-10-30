-- PI / Prospect provenance (closure C) — `canonical_leads.qualification_score`
-- distinguishes "unscored" (NULL) from "scored zero" (0).
--
-- Design record: docs/architecture/PROSPECT-PROVENANCE-CONTRACT.md
-- (§ "Enrichment contributions and score availability (closure C)").
-- Reader rule: lib/prospectProvenance/scoreSemantics.ts.
--
-- ─── PROBLEM ──────────────────────────────────────────────────────────────
-- The column is `numeric(5,2) NOT NULL DEFAULT 0`. Every prospect the WS-1
-- resolver creates omits the column and therefore stores 0, so "no scoring
-- authority has scored this prospect" and "scored, and the score is 0" are the
-- same value. Readers then average, band and export that 0 as a real verdict
-- (low intent, "0%").
--
-- ─── CHANGE ───────────────────────────────────────────────────────────────
--   * DROP DEFAULT   — an INSERT that omits the column now stores NULL.
--   * DROP NOT NULL  — NULL = unscored / unavailable. 0 = genuinely scored zero.
-- Both are catalogue-only (no table rewrite, no row is read or written). The
-- range CHECK `canonical_leads_qualification_score_valid` (0..100) is kept; a
-- CHECK passes on NULL, so it needs no change.
--
-- ─── EXISTING ROWS: NOT BACKFILLED ────────────────────────────────────────
-- Production (read-only check 2026-10-30): 19 rows, values 0..40. This
-- migration changes NO row. A pre-existing 0 cannot be told apart from a
-- genuine zero at the column level, so the READER rule decides (documented in
-- the contract and implemented once in lib/prospectProvenance/scoreSemantics):
-- a stored 0 counts as a genuine score ONLY when the row's `lead_metadata`
-- carries the scoring marker `qualificationScoring` (stamped by any scorer that
-- can emit 0). A bare 0 is the legacy column default ⇒ reported as unscored.
-- Evidence that no genuine 0 exists today: the only writer of the column,
-- crmIngestionService, floors every score it writes at 40, and the WS-1
-- resolver never writes it. Converting those zeros to NULL in production is an
-- owner-gated data change, deliberately NOT part of this migration.
--
-- ─── DEPLOY ORDER ─────────────────────────────────────────────────────────
-- Apply BEFORE the code that writes NULL. The code is also tolerant of an
-- unapplied migration: the CRM writer omits the column on INSERT when unscored
-- (old default 0 ⇒ legacy-default rule ⇒ unscored) and, on a 23502 from an
-- UPDATE, retries without the score instead of failing the import.
--
-- Idempotent: re-applying is a no-op. Depends on: canonical_leads (baseline).
-- Rollback: supabase/migrations/rollbacks/pi_qualification_score_nullable_rollback.sql (refuses while any row is NULL)

BEGIN;

-- ─── PREFLIGHT ────────────────────────────────────────────────────────────
DO $preflight$
DECLARE
  v_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.canonical_leads'::regclass
     AND a.attname = 'qualification_score' AND NOT a.attisdropped;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'QSCORE preflight: public.canonical_leads.qualification_score does not exist';
  END IF;
  IF v_type <> 'numeric(5,2)' THEN
    RAISE EXCEPTION 'QSCORE preflight: canonical_leads.qualification_score is %, expected numeric(5,2)', v_type;
  END IF;
END
$preflight$;

ALTER TABLE public.canonical_leads ALTER COLUMN qualification_score DROP DEFAULT;
ALTER TABLE public.canonical_leads ALTER COLUMN qualification_score DROP NOT NULL;

COMMENT ON COLUMN public.canonical_leads.qualification_score IS
  'Qualification score, scale percent (0..100). NULL = unscored/unavailable; 0 = genuinely scored zero. '
  'No default: an INSERT that omits it is unscored. Rows that pre-date 20270109000002 may hold the old '
  'default 0; a 0 counts as a score only when lead_metadata.qualificationScoring is present '
  '(lib/prospectProvenance/scoreSemantics.ts).';

-- ─── POSTCONDITIONS ───────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_nullable text;
  v_default  text;
  v_check    text;
BEGIN
  SELECT is_nullable, column_default INTO v_nullable, v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'canonical_leads' AND column_name = 'qualification_score';
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'QSCORE postcondition: canonical_leads.qualification_score must be nullable, is_nullable=%', v_nullable;
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'QSCORE postcondition: canonical_leads.qualification_score must have no default, found %', v_default;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
   WHERE conname = 'canonical_leads_qualification_score_valid'
     AND conrelid = 'public.canonical_leads'::regclass AND contype = 'c';
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'QSCORE postcondition: CHECK canonical_leads_qualification_score_valid (0..100) is missing';
  END IF;

  RAISE NOTICE 'QSCORE: canonical_leads.qualification_score nullable, no default, 0..100 CHECK kept; no row changed — verified.';
END
$verify$;

COMMIT;
