-- 2026-07-10 — widen credit_alert_log.alert_type CHECK.
--
-- The original CHECK (20260320) allowed only ('low_20pct','low_10pct',
-- 'depleted','auto_topup'). Two problems:
--   1. The consumption-warning path (creditConsumptionWarningService /
--      emitConsumptionAlert) already writes 'consumed_80/90/95' and
--      'forecast_insufficient_85' — every such insert violated the CHECK and
--      failed silently (the live table was EMPTY as of 2026-07-10).
--   2. Owner-approved low-credit ladder (2026-07-10): absolute warnings at
--      <100 ('low_100'), <50 ('low_50'), <20 ('low_20'); no alert at 200.
--
-- Legacy values are retained for dedup-history continuity.
-- NOTE: applied to production via scripts/ops/widen-credit-alert-types-20260710.js
-- (pooler DDL — the migration ledger is desynced; do NOT db:push).

ALTER TABLE public.credit_alert_log
  DROP CONSTRAINT IF EXISTS credit_alert_log_alert_type_check;

ALTER TABLE public.credit_alert_log
  ADD CONSTRAINT credit_alert_log_alert_type_check CHECK (alert_type IN (
    'low_20pct', 'low_10pct', 'depleted', 'auto_topup',
    'low_100', 'low_50', 'low_20',
    'consumed_80', 'consumed_90', 'consumed_95', 'forecast_insufficient_85'
  ));
