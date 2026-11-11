-- Rollback of 20270129000004_guard_functions_search_path.sql (Orchestration, owner #12 step 7(a)).
--
-- Returns the three guard functions to resolving names through the caller's search_path, exactly as
-- before. No body changes in either direction; no code depends on the setting.

ALTER FUNCTION public.execution_engine_requests_guard()    RESET search_path;
ALTER FUNCTION public.prospect_campaigns_targeting_guard() RESET search_path;
ALTER FUNCTION public.prospect_campaign_targets_guard()    RESET search_path;
