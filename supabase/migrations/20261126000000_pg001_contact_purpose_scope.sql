-- PG-001 — PURPOSE-AWARE CONTACT GOVERNANCE: the RESTRICTION SCOPE column.
--
-- Implements the owner-ratified PG-001 baseline (DR-A, DR-2, DR-5, DR-6, DR-10,
-- DR-11). It adds ONE nullable column, TWO CHECKs, and rebuilds ONE unique
-- index. It backfills nothing and it changes no verdict.
--
-- ─── DR-A: FORWARD-ONLY ───────────────────────────────────────────────────
-- Every existing row keeps `purpose_scope IS NULL`, which means "applies to
-- every purpose". No historical record is reinterpreted and no backfill runs.
-- `mayContact` is purpose-unaware until PG-001 Batch B wires the filter, and
-- even then an unlabelled restriction keeps covering everything.
--
-- ─── DR-10: NULL IS THE ONLY SPELLING OF "ALL" ────────────────────────────
-- The literal 'all' is deliberately NOT storable. Two spellings of one state is
-- exactly what the canonical model exists to prevent — the same argument this
-- table already makes for `dnc_permanent` and channel '*'. NULL also keeps an
-- unclassified record visibly unclassified rather than looking like a decision
-- somebody took.
--
-- ─── WHICH TYPES MAY CARRY A SCOPE AT ALL ─────────────────────────────────
-- Only three: `unsubscribe`, `consent_withdrawn`, `complaint`. Those are the
-- objection family, where purpose is a meaningful axis and where a future legal
-- answer (LQ-1/LQ-2/LQ-3) could narrow applicability.
--
-- The other six are refused by CHECK, each for a recorded reason:
--   bounce_hard, invalid_contact  endpoint-intrinsic. A dead or wrong address
--                                 cannot receive account mail either, so there
--                                 is no purpose axis to express.
--   deferred                      DR-5. A temporal operational state, kept
--                                 outside purpose scoping; scoping an undated
--                                 deferment could defer account mail forever.
--   campaign_exclusion            DR-6. Inert (gate band 9) and NARROWER than
--                                 any purpose value; it must never be mapped
--                                 into this vocabulary.
--   dnc_permanent                 "never contact me again is not an enumeration
--                                 of transports" (LI-3B). All-purpose by its
--                                 own semantics; scoping it would contradict
--                                 the instruction.
--   dnc_channel                   DR-2. Purpose-blind — channel and purpose are
--                                 independent dimensions, so constraining the
--                                 channel axis says nothing about purpose.
--
-- This is the STRICTEST reading of the ratified decisions. The CHECK can be
-- relaxed later by a migration; a row written under a loose CHECK cannot be
-- un-written.
--
-- ─── DR-11: UNIQUENESS, AND THE NULL TRAP IT AVOIDS ───────────────────────
-- `uq_contact_governance_identity` must learn about purpose, or an
-- account-scoped and an outreach-scoped unsubscribe would collide on one key
-- and the second would be swallowed as `already_present` — a silent loss of the
-- narrower instruction.
--
-- It is added as `coalesce(purpose_scope, 'all')`, NOT as the bare column.
-- In a UNIQUE index PostgreSQL treats NULLs as DISTINCT, so a bare column would
-- make two unlabelled rows non-colliding and DESTROY the replay idempotency
-- ADR §13 depends on. The coalesce form keeps every unlabelled row on one key,
-- exactly as today, and is version-independent (unlike NULLS NOT DISTINCT,
-- which needs PG15+). It also matches this index's existing style, which
-- already coalesces the anchor.
--
-- DATA-SAFE BY CONSTRUCTION: adding a column to a unique key can only make it
-- MORE permissive, so no existing row can violate the new index and the rebuild
-- cannot fail on existing data. Every current row maps to 'all', so the new key
-- is equivalent to the old one for all of them.
--
-- LOCKING: the DROP/CREATE pair takes an ACCESS EXCLUSIVE lock on the table for
-- the duration of the index build. Not CONCURRENTLY, because this must be
-- atomic with the CHECKs in one transaction.
--
-- Rollback: supabase/migrations/rollbacks/pg001_contact_purpose_scope_rollback.sql
--
-- NOT APPLIED. Created under AUTH-4, which authorizes the file only.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Fail closed rather than half-migrate.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.contact_governance_records') IS NULL THEN
    RAISE EXCEPTION 'PG-001 preflight: contact_governance_records is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname = 'uq_contact_governance_identity') THEN
    RAISE EXCEPTION 'PG-001 preflight: uq_contact_governance_identity is absent — refusing to rebuild an index that is not there';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- The column. Nullable, no default: NULL means every purpose (DR-10).
-- ---------------------------------------------------------------------------
ALTER TABLE public.contact_governance_records
  ADD COLUMN IF NOT EXISTS purpose_scope text;

COMMENT ON COLUMN public.contact_governance_records.purpose_scope IS
  'PG-001 restriction scope. NULL = applies to every purpose (the conservative default and the only spelling of "all"). Narrow values are ''outreach'' and ''account'', permitted only on unsubscribe / consent_withdrawn / complaint.';

-- ---------------------------------------------------------------------------
-- The two CHECKs, added idempotently.
-- ---------------------------------------------------------------------------
DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'contact_governance_purpose_scope_valid') THEN
    ALTER TABLE public.contact_governance_records
      ADD CONSTRAINT contact_governance_purpose_scope_valid
      CHECK (purpose_scope IS NULL OR purpose_scope IN ('outreach', 'account'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'contact_governance_purpose_scope_scopeable_type') THEN
    ALTER TABLE public.contact_governance_records
      ADD CONSTRAINT contact_governance_purpose_scope_scopeable_type
      CHECK (purpose_scope IS NULL
             OR governance_type IN ('unsubscribe', 'consent_withdrawn', 'complaint'));
  END IF;
END
$checks$;

-- ---------------------------------------------------------------------------
-- DR-11. Rebuild the identity key so purpose participates.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_contact_governance_identity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_governance_identity
  ON public.contact_governance_records (
    organization_id,
    channel,
    governance_type,
    coalesce(person_id::text, target_normalized),
    coalesce(purpose_scope, 'all'))
  WHERE revoked_at IS NULL;

COMMIT;
