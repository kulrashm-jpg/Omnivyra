-- WS-3 Milestone-3 — approval notes (ADDITIVE ONLY).
--
-- Adds one nullable column to the existing append-only approvals table. The
-- approval contract requires persisting an optional free-text note alongside
-- the structured reason: `reason` answers "under which rule", `notes` carries
-- what the human actually wrote. Conflating them would lose one or the other.
--
-- Nothing else changes: the append-only trigger, RLS policy, foreign key and
-- every existing column are untouched. ADD COLUMN is DDL, not a row mutation,
-- so it does not conflict with the append-only guarantee — existing rows keep
-- their history and simply carry NULL for the new column.

ALTER TABLE outreach_approvals ADD COLUMN IF NOT EXISTS notes text;
