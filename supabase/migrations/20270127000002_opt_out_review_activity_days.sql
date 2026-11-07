-- Orchestration (G-11) — the days a company's admin opened the opt-out reviews.
--
-- WHY. Owner ruling (2026-11-07), replacing a holiday list: "5 days a week and in that can't we
-- check through session login if they logged in during those 5 days to meet our condition";
-- the variant chosen: "Admin opened reviews"; and, asked whether more than activity is needed:
-- "No, activity is enough". So a weekday (Mon–Fri, the company's timezone, UTC when unset)
-- counts toward the 3-day review window ONLY when a COMPANY_ADMIN of that company opened the
-- opt-out reviews (the list or one review) that day. A day with no admin activity does not count.
-- Login itself is not used: there is no per-day login history to read, and login code belongs to
-- another track. This table is that per-day record, written by the two admin GET routes.
--
-- WHAT A ROW MEANS. "An admin of this company opened the reviews on this LOCAL date" (the date in
-- the company's timezone at the time of viewing), with the first and last moment seen. One row
-- per company and date (UNIQUE): a second view only moves last_seen_at.
--
-- NO PERSONAL DATA. No user id, no address, nothing about who: there is nothing to erase.
--
-- A due date is informational: with no decision every channel stays closed, so nothing here
-- gates a hold, a send or a decision. A failure to record never fails the request.
--
-- Tenant table: RLS on, EXPLICIT REVOKE from PUBLIC/anon/authenticated and an explicit grant to
-- service_role. No DELETE is granted: the days are the evidence behind "overdue". Forward only;
-- rollback in rollbacks/opt_out_review_activity_days_rollback.sql.

CREATE TABLE IF NOT EXISTS public.contact_opt_out_review_activity_days (
  organization_id  uuid        NOT NULL,
  local_date       date        NOT NULL,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contact_opt_out_review_activity_days_pkey
    PRIMARY KEY (organization_id, local_date),
  CONSTRAINT contact_opt_out_review_activity_days_seen_ordered
    CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT contact_opt_out_review_activity_days_date_sane
    CHECK (local_date BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
  CONSTRAINT contact_opt_out_review_activity_days_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE
);

ALTER TABLE public.contact_opt_out_review_activity_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_opt_out_review_activity_days_service_role ON public.contact_opt_out_review_activity_days;
CREATE POLICY contact_opt_out_review_activity_days_service_role ON public.contact_opt_out_review_activity_days
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.contact_opt_out_review_activity_days FROM PUBLIC;
REVOKE ALL ON public.contact_opt_out_review_activity_days FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contact_opt_out_review_activity_days TO service_role;

COMMENT ON TABLE public.contact_opt_out_review_activity_days IS
  'Orchestration G-11: the local days (company timezone) on which a company admin opened the opt-out reviews. A weekday counts toward the 3-day review window only with a row here. No personal data.';

-- Postconditions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contact_opt_out_review_activity_days'::regclass
                  AND conname = 'contact_opt_out_review_activity_days_pkey' AND contype = 'p') THEN
    RAISE EXCEPTION 'G-11 postcondition: one activity row per company and day is unenforced';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contact_opt_out_review_activity_days'::regclass
                  AND conname = 'contact_opt_out_review_activity_days_organization_id_fkey' AND contype = 'f') THEN
    RAISE EXCEPTION 'G-11 postcondition: activity days are not tied to their company';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contact_opt_out_review_activity_days'::regclass) THEN
    RAISE EXCEPTION 'G-11 postcondition: RLS is off on contact_opt_out_review_activity_days';
  END IF;
  IF has_table_privilege('authenticated', 'public.contact_opt_out_review_activity_days', 'SELECT')
     OR has_table_privilege('anon', 'public.contact_opt_out_review_activity_days', 'SELECT') THEN
    RAISE EXCEPTION 'G-11 postcondition: a client role can read contact_opt_out_review_activity_days';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND table_name = 'contact_opt_out_review_activity_days' AND column_name NOT IN ('organization_id', 'local_date', 'first_seen_at', 'last_seen_at')) THEN
    RAISE EXCEPTION 'G-11 postcondition: contact_opt_out_review_activity_days holds a column beyond the four (no personal data)';
  END IF;
END
$$;
