-- Rollback of 20270129000002_uncertain_communication_acknowledgements.sql (Orchestration, Follow-up E).
--
-- Removes the acknowledgement record, its append-only guard and its index. Roll the CODE back
-- first: the routes refuse an acknowledged operation they cannot record (503
-- acknowledgement_unrecorded), which is safe but stops acknowledged run endings and
-- re-enrolments. Dropping the table discards the acknowledgement history.

DROP TRIGGER IF EXISTS trg_execution_uncertain_acknowledgements_guard ON public.execution_uncertain_acknowledgements;
DROP FUNCTION IF EXISTS public.execution_uncertain_acknowledgements_guard();
DROP TABLE IF EXISTS public.execution_uncertain_acknowledgements;
