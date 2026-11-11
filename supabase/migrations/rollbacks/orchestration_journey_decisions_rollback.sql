-- Rollback of 20270120000000_orchestration_journey_decisions.sql.
-- Refuses while decisions exist: they are the only record of why a journey moved.
DO $$
BEGIN
  IF to_regclass('public.execution_journey_decisions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.execution_journey_decisions) THEN
    RAISE EXCEPTION 'rollback refused: execution_journey_decisions holds rows; export them first';
  END IF;
END
$$;

DROP TABLE IF EXISTS public.execution_journey_decisions;
DROP FUNCTION IF EXISTS public.execution_journey_decisions_guard();
