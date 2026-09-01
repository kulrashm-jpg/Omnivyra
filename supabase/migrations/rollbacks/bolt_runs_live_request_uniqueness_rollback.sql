-- Rollback for 20261010000000_bolt_runs_live_request_uniqueness.sql
--
-- Dropping the index is lossless: it stores no data of its own, and the
-- application's pre-insert idempotency check keeps working without it (it
-- simply loses the ability to arbitrate a truly concurrent race). No row is
-- read, written, or deleted here.

DROP INDEX IF EXISTS public.uidx_bolt_runs_live_request_fingerprint;
