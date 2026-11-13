-- Rollback of 20270217000017_admin_grant_velocity_cap.sql (e1, M5). Drops ONLY what 017 created. The route then fails
-- closed (503 GRANT_UNAVAILABLE): it never falls back to the former count-then-act path.
DROP FUNCTION IF EXISTS public.admin_grant_credits(uuid, uuid, int, text, text, timestamptz, text, int, boolean, jsonb);
