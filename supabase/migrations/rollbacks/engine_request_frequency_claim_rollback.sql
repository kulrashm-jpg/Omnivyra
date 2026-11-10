-- Rollback of 20270129000001_engine_request_frequency_claim.sql (Orchestration, Follow-up D-2).
--
-- Removes the atomic claim function, the queued_at trigger and its index, and the column.
-- The adapters' default claim calls public.orch_claim_engine_request: roll the CODE back first
-- (or a WhatsApp/community claim fails closed and waits, which is safe but stops those engines).
-- Dropping queued_at discards the recorded queue times; nothing else depends on them.

DROP FUNCTION IF EXISTS public.orch_claim_engine_request(uuid, uuid, text, numeric, timestamptz, text[], integer);
DROP TRIGGER IF EXISTS trg_execution_engine_requests_queued_at ON public.execution_engine_requests;
DROP FUNCTION IF EXISTS public.execution_engine_requests_queued_at();
DROP INDEX IF EXISTS public.ix_execution_engine_requests_possible_contact;
ALTER TABLE public.execution_engine_requests DROP COLUMN IF EXISTS queued_at;
