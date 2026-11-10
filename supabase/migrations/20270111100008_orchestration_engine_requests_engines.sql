-- Orchestration — the engine request ledger accepts every adapter-fronted engine.
--
-- 20261230000000 created `execution_engine_requests` for WhatsApp only. The
-- social-publishing, community-action and browser-automation adapters use the
-- same ledger for the same reason: one durable request per execution task,
-- claimed before the engine is called, so a crash or timeout can never cause a
-- second external action. This widens ONLY the engine vocabulary; states, the
-- per-task uniqueness, the set-once external reference and the guard trigger are
-- unchanged.
--
-- The list mirrors ENGINE_NAMES in backend/services/orchestration/engineAdapters.ts
-- minus `ws3`, which keeps its own per-task bridge (outreach_tasks) and never
-- writes here. orchestrationEngineContract.test.ts keeps the two in step.
--
-- Additive; NOT applied anywhere yet. ROLLBACK:
-- supabase/migrations/rollbacks/orchestration_engine_requests_engines_rollback.sql

DO $$
BEGIN
  IF to_regclass('public.execution_engine_requests') IS NULL THEN
    RAISE EXCEPTION 'orchestration engines: execution_engine_requests (20261230000000) is absent';
  END IF;
END
$$;

ALTER TABLE public.execution_engine_requests
  DROP CONSTRAINT IF EXISTS execution_engine_requests_engine_valid;
ALTER TABLE public.execution_engine_requests
  ADD CONSTRAINT execution_engine_requests_engine_valid
  CHECK (engine IN ('whatsapp', 'social_publish', 'community', 'browser'));

-- Postcondition: exactly the agreed vocabulary.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint
   WHERE conname = 'execution_engine_requests_engine_valid'
     AND conrelid = 'public.execution_engine_requests'::regclass;
  IF d IS NULL
     OR d NOT LIKE '%whatsapp%' OR d NOT LIKE '%social_publish%'
     OR d NOT LIKE '%community%' OR d NOT LIKE '%browser%' OR d LIKE '%ws3%' THEN
    RAISE EXCEPTION 'orchestration engines postcondition: engine vocabulary is %', d;
  END IF;
END
$$;
