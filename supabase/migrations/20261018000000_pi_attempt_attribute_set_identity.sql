-- A4Y — the requested attribute set becomes part of enrichment work-item identity.
--
-- WHAT WAS WRONG. A4N made the database the concurrency arbiter for enrichment
-- work and keyed it on (tenant, entity, provider). `requested_attributes` was
-- not in that key, so asking Clearbit for `employee_count` about account X and
-- asking Clearbit for `founded_year` about the SAME account were one work item.
-- Three consequences, all live:
--
--   1. The A4N live index rejected the second set outright — a question that
--      SHOULD have been asked never was, while the first was still open.
--   2. The A4A attempt-number index has the same gap, so once the sets are
--      distinguishable both would still collide on (tenant, entity, provider,
--      attempt_number) at attempt 1.
--   3. Worst: A4N/A4U reclaim carries no attribute predicate, so a worker
--      executing `[founded_year]` could take over an abandoned attempt whose
--      `requested_attributes` said `[employee_count]`. The row then MISREPORTS
--      what was asked, and A4E closes it with an outcome attributed to the
--      wrong set. That is silent evidence corruption, not a refusal.
--
-- The seam produces exactly this shape today: `executePlannedField` requests
-- ONE attribute per attempt, so any driver iterating a plan's fields collides
-- on its second field.
--
-- WHY THE SET NEEDS A CANONICAL FORM. Putting the set in the key only works if
-- the set has one representation. PostgreSQL array equality is order-,
-- duplicate- and whitespace-sensitive — measured on this server, not assumed:
--
--   ['a','b'] = ['b','a']  false     ['a','a'] = ['a']  false
--   [' a ']   = ['a']      false
--
-- so without canonicalisation `[employee_count, founded_year]` and
-- `[founded_year, employee_count]` would be two work items for one question.
--
-- WHY A FUNCTION AND A CHECK, NOT TRUST IN THE WRITER. A4N's principle is that
-- the ARBITER IS THE DATABASE. If canonical form were guaranteed only by
-- TypeScript, one non-canonical insert would silently create a second identity
-- for the same work — precisely the bug class A4J, A4N and A4U each closed. The
-- CHECK makes a non-canonical row impossible to store at all.
--
-- WHAT THE FUNCTION MAY DO — AND MUST NOT. It enforces SHAPE only: reject a
-- null/empty/whitespace-padded element, dedupe exactly, sort deterministically,
-- preserve `{}`. It knows NO vocabulary. Attribute membership stays in the
-- provider capability layer where it already lives, so the 23-key vocabulary is
-- never duplicated into SQL and cannot drift from it.
--
-- Padding is REJECTED, not trimmed. The rest of the system matches attributes
-- by exact string (`adapter.supports.includes(a)`), so ' employee_count ' is
-- already `attributes_unsupported` there; repairing it here would accept
-- upstream what selection refuses downstream.
--
-- `COLLATE "C"` is UTF-8 byte order, which is deterministic and locale-
-- independent — required for IMMUTABLE, and the exact rule the TypeScript half
-- mirrors by sorting on encoded bytes.
--
-- NULL SEMANTICS. The function returns NULL for malformed input, and the CHECK
-- uses `IS NOT DISTINCT FROM` so that NULL makes the constraint FALSE. Written
-- as plain `=` the comparison would evaluate to NULL and a CHECK passes on
-- NULL — malformed input would have been admitted by the very constraint meant
-- to refuse it.
--
-- DELIBERATELY NOT HERE. No hash column, no second canonical column, no
-- generated column (`array_to_string` is STABLE, so it cannot appear in one),
-- no retry metadata, no execution status, no lineage, no rate-limit horizon,
-- no scheduler. Those remain later work.
--
-- SAFE TO APPLY. The table holds zero rows in production (verified immediately
-- before this migration was written), so the four index replacements are
-- instant, no backfill exists to perform, and no row can violate the new CHECK.
-- Rollback is the exact inverse: drop the CHECK, restore the four prior index
-- definitions, drop the function — lossless precisely because there is no data.
-- That window closes as soon as the first attempt is written.

-- ── the canonical form ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_canonical_attribute_set(attrs text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT CASE
    -- Malformed input canonicalises to NULL rather than to a repaired value:
    -- the caller must be refused, not quietly corrected.
    WHEN attrs IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM unnest(attrs) AS e
       WHERE e IS NULL OR e = '' OR btrim(e) <> e
    ) THEN NULL
    -- Dedupe exactly, then order by UTF-8 bytes. COALESCE because array_agg
    -- over an empty set returns NULL, and `{}` must stay `{}` — an empty set
    -- turned into NULL would make empty-set attempts mutually non-colliding.
    ELSE COALESCE(
      (SELECT array_agg(e ORDER BY e COLLATE "C")
         FROM (SELECT DISTINCT e FROM unnest(attrs) AS e) s(e)),
      '{}'::text[]
    )
  END
$fn$;

COMMENT ON FUNCTION public.pi_canonical_attribute_set(text[]) IS
  'A4Y: canonical form of an enrichment attribute set — reject null/empty/'
  'whitespace-padded elements, dedupe exactly, sort by COLLATE "C" (UTF-8 byte '
  'order), preserve {}. Shape only: this function knows no attribute vocabulary.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.prospect_enrichment_attempts'::regclass
       AND conname  = 'prospect_enrichment_attempts_attributes_canonical'
  ) THEN
    ALTER TABLE public.prospect_enrichment_attempts
      ADD CONSTRAINT prospect_enrichment_attempts_attributes_canonical
      CHECK (requested_attributes IS NOT DISTINCT FROM
             public.pi_canonical_attribute_set(requested_attributes));
  END IF;
END $$;

-- ── A4N live identity: one active execution per WORK ITEM ───────────────────
-- Still partial on `completed_at IS NULL`, so history is untouched and a
-- completed attempt never blocks its own retry. Still one index per entity leg,
-- because a UNIQUE index spanning both nullable columns would treat NULLs as
-- distinct and enforce nothing. `organization_id` still leads, so tenant
-- isolation stays structural rather than conventional.
DROP INDEX IF EXISTS public.prospect_enrichment_attempts_person_live;
DROP INDEX IF EXISTS public.prospect_enrichment_attempts_account_live;

CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_person_live
  ON public.prospect_enrichment_attempts
     (organization_id, person_id, provider_key, requested_attributes)
  WHERE person_id IS NOT NULL AND completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_account_live
  ON public.prospect_enrichment_attempts
     (organization_id, account_id, provider_key, requested_attributes)
  WHERE account_id IS NOT NULL AND completed_at IS NULL;

-- ── A4A attempt-number identity: the Nth try of THIS work item ──────────────
-- Without the attribute set here, set A's attempt 1 and set B's attempt 1 are
-- the same tuple and the second is rejected — so distinguishing the sets in the
-- live index alone would not actually let both run. With it, `attempt_number`
-- recovers its meaning: the Nth attempt at one work item, not the Nth thing
-- ever tried against this entity and provider.
DROP INDEX IF EXISTS public.prospect_enrichment_attempts_person_unique;
DROP INDEX IF EXISTS public.prospect_enrichment_attempts_account_unique;

CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_person_unique
  ON public.prospect_enrichment_attempts
     (organization_id, person_id, provider_key, requested_attributes, attempt_number)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prospect_enrichment_attempts_account_unique
  ON public.prospect_enrichment_attempts
     (organization_id, account_id, provider_key, requested_attributes, attempt_number)
  WHERE account_id IS NOT NULL;

COMMENT ON COLUMN public.prospect_enrichment_attempts.requested_attributes IS
  'A4Y: part of work-item identity. Stored in canonical form only (see '
  'pi_canonical_attribute_set) and IMMUTABLE for the lifetime of an attempt — '
  'reclaim moves ownership, never the question being asked.';
