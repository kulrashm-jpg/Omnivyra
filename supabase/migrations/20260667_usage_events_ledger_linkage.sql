-- =============================================================================
-- Phase 2 Task 6 — Explicit usage_events → ledger lineage linkage (COLUMN ONLY)
--
-- WHY: usage_events→ledger linkage was implicit (nullable reference_id, no FK,
-- retries write N rows, dedup by final_attempt) → reconciliation depended on
-- timestamp/fuzzy joins (Audit Gap #2). This adds a first-class, deterministic
-- anchor: the originating HOLD transaction id. From that id,
-- credit_transactions.parent_transaction_id deterministically yields the
-- CONFIRM/RELEASE/partial-confirm settlement lineage (no heuristics).
--
-- SAFETY: purely additive, nullable, no default, no backfill, no historical
-- mutation, no FK (usage_events is high-volume append; a value-only uuid
-- avoids insert-order coupling). `ADD COLUMN … uuid` nullable/no-default is a
-- catalog-only metadata change on PG ≥ 11 (no table rewrite, no write-blocking
-- scan). Existing readers/exporters/analytics unaffected. NOT applied by this
-- change — controlled migration process only.
--
-- ⚠️ Phase 3.1 INDEX SPLIT: the supporting partial indexes were MOVED to
-- 20260668_usage_events_ledger_linkage_indexes.sql, which uses
-- CREATE INDEX CONCURRENTLY (non-transactional) so the build never takes a
-- write-blocking lock on these high-volume tables. Apply 20260667 FIRST
-- (this file), then 20260668.
--
-- DEPLOY ORDERING (operational contract — same as prior usage_events column
-- additions like action_key): apply this migration before the code that
-- writes the column is activated (PHASE2_LEDGER_LINK_COLUMN=true). Until
-- applied, the deterministic anchor still travels in usage_events.metadata
-- under the reserved key `ledger_hold_transaction_id`, so reconciliation is
-- deterministic even pre-migration; this column is the indexed upgrade.
-- =============================================================================

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS ledger_hold_transaction_id uuid;

-- Mirror on the analytics dual-write table so margin/reconciliation queries
-- can join on the same deterministic anchor without metadata extraction.
ALTER TABLE public.unified_transactions
  ADD COLUMN IF NOT EXISTS ledger_hold_transaction_id uuid;
