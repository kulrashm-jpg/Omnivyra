-- ROLLBACK for 20261211000001_rbac_config_pre_c7_privilege_reduction.sql
--
-- Effect: re-asserts the documented INTERIM contract (service_role SELECT, INSERT on public.rbac_config).
-- It deliberately does NOT restore what the hosted default privileges had granted before the forward
-- migration — UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on the table for service_role, and
-- USAGE / SELECT / UPDATE (setval) on the identity sequence for service_role and authenticated. No
-- application path needs any of them (Closure-015Q/015R), so "rolling back" this migration never requires
-- them. Restoring them (e.g. GRANT ALL) re-opens, for anyone holding the service key:
--   • DELETE of the newest row(s) → silently re-activates an OLDER RBAC configuration;
--   • UPDATE in place             → changes permissions without a new version (stale-edit detection blind);
--   • TRUNCATE                    → wipes history; the application falls back to built-in defaults;
--   • setval lower                → every later governed save fails on the primary key (RBAC saves denied);
-- and for authenticated sessions, setval on the version sequence.
-- If the deferred C-7 contract step has been applied, roll THAT back first
-- (supabase/deferred/rollbacks/rbac_config_contract_legacy_insert_rollback.sql) — it returns to this same
-- interim contract. Data-lossless; repeatable.

BEGIN;
GRANT SELECT, INSERT ON TABLE public.rbac_config TO service_role;
COMMIT;
