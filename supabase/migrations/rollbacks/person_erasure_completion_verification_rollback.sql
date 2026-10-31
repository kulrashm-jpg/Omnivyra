-- ROLLBACK for 20270115000000_person_erasure_completion_verification.sql
--
-- Removes the erasure completion-verification layer only. The erasure ledger
-- (20270112000003) and every erasure already performed are untouched.
--
-- CONSEQUENCES, stated rather than discovered:
--   * the erasure API (pages/api/prospect-identity/erasure-requests/*) then
--     fails CLOSED: the inventory capture before finalize answers "function
--     missing", the attempt is marked failed and NOTHING is erased; status
--     reads report verification as unavailable and never COMPLETED. Roll the
--     application back first (or together) if erasure must keep working.
--   * verification history (outcomes and counts, no personal data) is dropped.
--   * any inventory still held for a residual request (it holds the erased
--     person's uuid and ids of rows that kept personal data) is dropped too, so
--     re-verification of that request is no longer possible.
BEGIN;
DROP FUNCTION IF EXISTS public.pi_person_erasure_verify(uuid, uuid);
DROP FUNCTION IF EXISTS public.pi_person_erasure_capture_inventory(uuid, uuid, uuid);
DROP TABLE IF EXISTS public.person_erasure_verifications;
DROP TABLE IF EXISTS public.person_erasure_inventories;
COMMIT;
