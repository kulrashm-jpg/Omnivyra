-- BETA-PHASE5-EXEC-001 — allow 'reviews' as a canonical ingestion source.
--
-- Relaxes the two source CHECK constraints proven by BETA-PHASE5-AUDIT-001 to be the
-- ONLY schema objects that reject 'reviews' as an ingestion source. Additive value
-- change only: no table recreation, no index/trigger/RLS/column change. Both `source`
-- columns are plain TEXT (not enums), so this is a pure constraint relaxation.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT (re-runnable).
-- Drop-safe: additive — every previously-valid row remains valid; no data rewrite.
-- Rollback: re-DROP + re-ADD each CHECK with the original five-value list.
--
-- Scope: schema only. Does NOT wire the scheduler, IngestionSource, statusSourceForTable,
-- Trust logic, or any provider. Until the (separate) code wire lands, no row with
-- source='reviews' is ever written, so this migration is inert on its own.

BEGIN;

-- Migration A — ingestion_runs.source (20260429_data_ingestion_layer.sql:258-259)
ALTER TABLE public.ingestion_runs
  DROP CONSTRAINT IF EXISTS ingestion_runs_source_valid;
ALTER TABLE public.ingestion_runs
  ADD CONSTRAINT ingestion_runs_source_valid
    CHECK (source IN ('crawler', 'ga4', 'gsc', 'crm', 'ads', 'reviews'));

-- Migration B — data_source_status.source (20260411_decision_intelligence_stabilization.sql:142-143)
-- (note: this table uses 'ga' where ingestion_runs uses 'ga4' — statusSourceForTable maps ga4→ga)
ALTER TABLE public.data_source_status
  DROP CONSTRAINT IF EXISTS data_source_status_source_valid;
ALTER TABLE public.data_source_status
  ADD CONSTRAINT data_source_status_source_valid
    CHECK (source IN ('crawler', 'ga', 'gsc', 'crm', 'ads', 'reviews'));

COMMIT;
