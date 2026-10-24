-- ROLLBACK for 20261210000003_rbac_config.sql
--
-- ############################################################################
-- #  WARNING — DESTRUCTIVE: DROPS EVERY SAVED RBAC CONFIGURATION              #
-- ############################################################################
-- If the deferred contract step (supabase/deferred/rbac_config_contract_legacy_insert.sql) has been
-- promoted and applied, roll it back FIRST. After this runs the application reads the
-- built-in defaults (missing table → defaults) and RBAC saves fail (500), as before the migration.
-- Export first if the history matters:
--   \copy (SELECT * FROM public.rbac_config ORDER BY version) TO 'rbac_config_backup.csv' CSV HEADER

BEGIN;
DROP FUNCTION IF EXISTS public.save_rbac_config(jsonb, jsonb, uuid, bigint);
DROP TABLE IF EXISTS public.rbac_config;
COMMIT;
