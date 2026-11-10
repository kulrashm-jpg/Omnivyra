-- Rollback of 20270120000001_pi_email_content_evidence.sql.
-- Refuses while evidence exists: it is the only record of what a person was sent.
DO $$
BEGIN
  IF to_regclass('public.email_outreach_content_evidence') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.email_outreach_content_evidence) THEN
    RAISE EXCEPTION 'rollback refused: email_outreach_content_evidence holds rows; export them first';
  END IF;
END
$$;

DROP TABLE IF EXISTS public.email_outreach_content_evidence;
DROP FUNCTION IF EXISTS public.email_outreach_content_evidence_guard();
