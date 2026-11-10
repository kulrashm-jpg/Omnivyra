-- ROLLBACK for 20261231000001_orchestration_engine_requests_engines.sql
--
-- Narrows the engine vocabulary back to WhatsApp. Refused while any request row
-- names another engine: those rows are the durable proof that an external action
-- was (or may have been) requested, and deleting them would allow a duplicate.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.execution_engine_requests WHERE engine <> 'whatsapp') THEN
    RAISE EXCEPTION 'rollback refused: engine requests exist for engines other than whatsapp';
  END IF;
END
$$;

ALTER TABLE public.execution_engine_requests
  DROP CONSTRAINT IF EXISTS execution_engine_requests_engine_valid;
ALTER TABLE public.execution_engine_requests
  ADD CONSTRAINT execution_engine_requests_engine_valid CHECK (engine IN ('whatsapp'));

COMMIT;
