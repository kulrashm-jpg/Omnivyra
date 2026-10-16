-- ROLLBACK for the DEFERRED contract step supabase/deferred/rbac_config_contract_legacy_insert.sql
-- (promoted in Closure-015O as 20261210000005; deferred in Closure-015P; rewritten in Closure-015Q;
-- renumber with it on promotion).
-- WARNING: rolling back 20261210000003 (rbac_config, DESTRUCTIVE) requires this step to be rolled back first.
--
-- Effect: re-opens ONLY the application's legacy (unversioned, no stale-edit detection) insert path for
-- service_role — the state 20261210000003 intended (SELECT, INSERT), i.e. exactly the interim contract of
-- 20261211000001_rbac_config_pre_c7_privilege_reduction.sql (Closure-015R). Use only if an application version
-- that still needs the direct insert must run again. Data-lossless; repeatable.
--
-- It deliberately does NOT restore what the hosted default privileges had granted before the contract step
-- (UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on the table; USAGE/SELECT/UPDATE on the identity
-- sequence). Restoring those broad privileges (e.g. GRANT ALL) is NOT a rollback of anything the
-- application needs, and re-opens, for anyone holding the service key:
--   • DELETE of the newest row(s)  → silently re-activates an OLDER RBAC configuration (permission downgrade
--                                    or re-grant without any save, version or audit);
--   • UPDATE in place              → changes permissions without a new version (stale-edit detection blind);
--   • TRUNCATE                     → wipes all history; the application falls back to built-in defaults;
--   • setval on the sequence       → a lower value makes every later governed save fail on the primary key
--                                    (RBAC saves denied) — a higher one only leaves a gap;
--   • TRIGGER / REFERENCES / MAINTAIN → attach existing functions as triggers, block via locks/maintenance.
-- Verified (Closure-015Q): the legacy insert needs only INSERT on the table — the identity column draws its
-- value without any privilege on the sequence.

BEGIN;
GRANT INSERT ON TABLE public.rbac_config TO service_role;
COMMIT;
