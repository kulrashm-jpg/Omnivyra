-- ROLLBACK for 20270217000002_feedback_submissions_open_unique.
-- Drops the index; the route's reads remain as the (racy) early answer and its
-- 23505 -> 409 mapping becomes unreachable (harmless).
DROP INDEX IF EXISTS public.feedback_submissions_one_open_per_user;
