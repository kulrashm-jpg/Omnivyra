-- Campaign AI Budget (soft warning). Optional; no default; no migration of existing rows.
-- No blocking, no billing. Read-only comparisons only.

alter table campaigns
  add column if not exists ai_budget_monthly numeric null;
