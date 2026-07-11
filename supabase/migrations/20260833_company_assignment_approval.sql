-- Strategic Mix R2-P1 — Assignment Approval Workflow (SPEC-001 §5.2).
-- Company-level enablement flag for assignment-level approvals.
--
-- ONE existing table extended (no new persistence model, I-7): companies
-- gains a boolean opt-in. Default FALSE ⇒ every existing company behaves
-- byte-identically (approvals are invisible until a company turns them on).
--
-- NOTE (repo law): the migration ledger is desynced — this file is the
-- RECORD; application happens via
-- scripts/ops/company-approval-flag-ddl-20260711.js (pooler). Never db:push.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS require_assignment_approval boolean NOT NULL DEFAULT false;
