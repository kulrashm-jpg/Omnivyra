-- ROLLBACK — D-02: outreach approval binding.
-- Reverses supabase/migrations/20270120000011_outreach_approval_binding.sql
--
-- NOT APPLIED ANYWHERE; test database only, like the forward migration.
--
-- REFUSES rather than loses history. `outreach_approvals` is append-only (its trigger
-- rejects UPDATE and DELETE), so a 'revoked' row cannot be rewritten to fit the narrower
-- CHECK, and dropping the CHECK's widening under such a row would fail anyway. If any
-- revoked decision exists the rollback stops with a count and changes nothing.
--
-- WHAT IT GIVES UP. Dropping `approved_content_hash` makes every approval unbound again.
-- The application code that ships with the forward migration refuses an approval with no
-- hash, so roll the code back first, or nothing approved will dispatch. Dropping
-- `self_approval_allowed` loses any tenant's explicit opt-in. Dropping `tier` loses the
-- platform-override label on rows recorded since the forward migration. Dropping the
-- passkey columns loses which credential verified each approval; `approved_recipient` the
-- address a non-journey approval named. Dropping the two guard
-- triggers removes the database's claim-time check and the server-stamped `decided_at`
-- (roll the application back first: outside tests it omits `decided_at` and relies on the stamp).
--
-- One transaction: a failure at any step leaves the forward state intact.

BEGIN;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.outreach_approvals WHERE decision = 'revoked';
  IF n > 0 THEN
    RAISE EXCEPTION 'outreach approval binding rollback: % revoked decision row(s) exist and the approval log is append-only; not rolled back', n;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS outreach_tasks_claim_requires_approval ON public.outreach_tasks;
DROP FUNCTION IF EXISTS public.outreach_tasks_claim_requires_approval();
DROP TRIGGER IF EXISTS outreach_approvals_server_decided_at ON public.outreach_approvals;
DROP FUNCTION IF EXISTS public.outreach_approvals_server_decided_at();

ALTER TABLE public.outreach_approvals DROP CONSTRAINT IF EXISTS outreach_approvals_decision_valid;
ALTER TABLE public.outreach_approvals
  ADD CONSTRAINT outreach_approvals_decision_valid CHECK (decision IN ('approved', 'rejected'));

ALTER TABLE public.outreach_approvals DROP CONSTRAINT IF EXISTS outreach_approvals_content_hash_format;
ALTER TABLE public.outreach_approvals DROP CONSTRAINT IF EXISTS outreach_approvals_tier_valid;
ALTER TABLE public.outreach_approvals DROP COLUMN IF EXISTS approved_content_hash;
ALTER TABLE public.outreach_approvals DROP COLUMN IF EXISTS tier;
ALTER TABLE public.outreach_approvals DROP CONSTRAINT IF EXISTS outreach_approvals_passkey_evidence;
ALTER TABLE public.outreach_approvals DROP COLUMN IF EXISTS passkey_credential_id;
ALTER TABLE public.outreach_approvals DROP COLUMN IF EXISTS passkey_verified_at;
ALTER TABLE public.outreach_approvals DROP CONSTRAINT IF EXISTS outreach_approvals_recipient_on_approval;
ALTER TABLE public.outreach_approvals DROP COLUMN IF EXISTS approved_recipient;

ALTER TABLE public.outreach_governance_config DROP COLUMN IF EXISTS self_approval_allowed;

COMMIT;
