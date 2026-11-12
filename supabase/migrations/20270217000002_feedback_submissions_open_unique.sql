-- 20270217000002_feedback_submissions_open_unique
--
-- CLASS 2 (e9 ruling 2026-11-12). pages/api/credits/earn/feedback.ts decides
-- "may this user submit feedback?" with two READS (an approved row? a pending
-- row?) and then INSERTs. Two concurrent submits both pass the reads and both
-- insert: duplicate pending rows (and, after review, a second credited
-- feedback). The reads stay as an early, friendly answer; THIS index is the
-- authority: at most ONE pending-or-approved submission per user. A rejected
-- submission is outside the predicate, so the user may resubmit; an approved
-- one stays inside it, so approval is permanent.
-- In code, a 23505 on the insert answers 409 (the concurrent loser).
--
-- PRECONDITION: RAISES (nothing changed) if any user already holds more than
-- one pending/approved row (83/C18, prod 2026-11-12: 0 such users).
-- POSTCONDITION: the index exists, is UNIQUE, VALID, and has the predicate.
-- Rollback: rollbacks/feedback_submissions_open_unique_rollback.sql
-- GOV-SECURITY: virality-83; review: virality-05.

DO $pre$
DECLARE v_dups int;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT user_id FROM public.feedback_submissions
     WHERE status IN ('pending', 'approved')
     GROUP BY user_id HAVING count(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'feedback_open_unique: % user(s) hold more than one pending/approved submission - resolve them first; nothing changed', v_dups;
  END IF;
END
$pre$;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_submissions_one_open_per_user
  ON public.feedback_submissions (user_id)
  WHERE status IN ('pending', 'approved');

DO $post$
DECLARE v_ok boolean;
BEGIN
  SELECT i.indisunique AND i.indisvalid
         AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%status%pending%approved%'
    INTO v_ok
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'feedback_submissions_one_open_per_user'
     AND i.indrelid = 'public.feedback_submissions'::regclass;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'feedback_open_unique: postcondition failed - index missing, not unique, invalid, or wrong predicate';
  END IF;
END
$post$;
