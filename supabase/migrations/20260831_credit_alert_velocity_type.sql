-- 2026-07-10 — add 'velocity_200' to credit_alert_log.alert_type CHECK.
--
-- Owner policy (same day as 20260830): email the company admin when balance
-- drops below 200 credits while >= 100 credits were consumed in the past
-- 7 days (burn-velocity top-up nudge; deduped weekly via this log).
--
-- NOTE: applied to production via scripts/ops/widen-credit-alert-types-20260710.js
-- (pooler DDL — the migration ledger is desynced; do NOT db:push).

ALTER TABLE public.credit_alert_log
  DROP CONSTRAINT IF EXISTS credit_alert_log_alert_type_check;

ALTER TABLE public.credit_alert_log
  ADD CONSTRAINT credit_alert_log_alert_type_check CHECK (alert_type IN (
    'low_20pct', 'low_10pct', 'depleted', 'auto_topup',
    'low_100', 'low_50', 'low_20', 'velocity_200',
    'consumed_80', 'consumed_90', 'consumed_95', 'forecast_insufficient_85'
  ));
