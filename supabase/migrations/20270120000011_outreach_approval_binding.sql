-- D-02 (orchestration Wave 1) — bind a WS-3 outreach approval to the exact content and
-- execution action it authorised, require passkey evidence for external execution, and
-- let it be revoked.
--
-- NOT APPLIED ANYWHERE. Written for, and tested only on, a disposable test database.
-- Applying it to production is NOT authorised by this migration or by the branch that
-- carries it; that needs a separate owner decision.
--
-- No table, enum or store is created. The approval store stays `outreach_approvals`
-- (append-only, unchanged trigger) and the tenant setting stays on
-- `outreach_governance_config`. Two guard triggers are added (below); the WS-3 claim is
-- still the application's one compare-and-set, the database only refuses it.
--
--   outreach_approvals.approved_content_hash  nullable sha-256 hex. The binding the
--       approval authorised, recomputed at dispatch; a mismatch refuses (approval_stale).
--       NULL on every row written before this migration. Those rows are KEPT as history
--       and are never backfilled: a legacy approval with no hash cannot authorise a
--       future send (the dispatch gate refuses it), it can only be replaced by a fresh one.
--   outreach_approvals.tier  nullable 'tenant' | 'platform'. Which surface recorded the
--       decision, so a platform override stays visible to the tenant in the append-only
--       record itself. NULL on legacy rows. Needed because the alternatives are not
--       durable: the approver's role can change after the fact, and `reason` is free text.
--   outreach_approvals.passkey_credential_id / passkey_verified_at  nullable. The WebAuthn
--       credential verified, and when, for an approval of external execution (S-02). Set
--       together or not at all. NULL on legacy rows and on internal-channel approvals; an
--       external approval without them never authorises a send.
--   outreach_approvals.approved_recipient  nullable. The normalised address a non-journey
--       external approval names (also inside its hash), so a send to another address is
--       refused as a recipient mismatch without invalidating the approval (L-3/L-4). Only
--       on approved rows. Service-role only, like the rest of the table.
--   outreach_approvals.decision CHECK widened to 'revoked'. Revocation appends a row; it
--       never edits or deletes the approval it withdraws.
--   outreach_governance_config.self_approval_allowed  NOT NULL DEFAULT false. Off for
--       every tenant, existing and new, until the tenant turns it on explicitly.
--
--   TRIGGER outreach_approvals_server_decided_at (BEFORE INSERT) — T1: `decided_at` is the
--       server's clock. Stamped when the writer omits it (the application always does
--       outside tests) and refused when later than the server's clock.
--   TRIGGER outreach_tasks_claim_requires_approval (BEFORE UPDATE OF status, channel) — the
--       claim boundary. A task on any channel but 'internal' cannot enter `dispatching` unless
--       its LATEST approval row is `approved`, carries a content hash and passkey evidence
--       verified in the five minutes before the decision (never after it, L-1), was decided
--       no later than now and less than 7 days ago, and no rejection or revocation was
--       recorded with or after it. So an application bug that skips the gate still cannot
--       claim, and an approval that lapses between the gate and the claim refuses. The
--       channel is also frozen once a task leaves `pending` / `awaiting_approval` (L-2), so
--       an approved email task cannot be relabelled `internal` to escape the check.
--       `clock_timestamp()`, not `now()`: the instant of the claim, not of its transaction.
--
-- Rollback: supabase/migrations/rollbacks/outreach_approval_binding_rollback.sql

ALTER TABLE public.outreach_approvals
  ADD COLUMN IF NOT EXISTS approved_content_hash text,
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS passkey_credential_id text,
  ADD COLUMN IF NOT EXISTS passkey_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_recipient text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.outreach_approvals'::regclass
                    AND conname = 'outreach_approvals_content_hash_format') THEN
    ALTER TABLE public.outreach_approvals
      ADD CONSTRAINT outreach_approvals_content_hash_format
      CHECK (approved_content_hash IS NULL OR approved_content_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.outreach_approvals'::regclass
                    AND conname = 'outreach_approvals_tier_valid') THEN
    ALTER TABLE public.outreach_approvals
      ADD CONSTRAINT outreach_approvals_tier_valid
      CHECK (tier IS NULL OR tier IN ('tenant', 'platform'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.outreach_approvals'::regclass
                    AND conname = 'outreach_approvals_passkey_evidence') THEN
    ALTER TABLE public.outreach_approvals
      ADD CONSTRAINT outreach_approvals_passkey_evidence
      CHECK ((passkey_credential_id IS NULL) = (passkey_verified_at IS NULL)
             AND (passkey_credential_id IS NULL OR (decision = 'approved' AND length(passkey_credential_id) > 0)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.outreach_approvals'::regclass
                    AND conname = 'outreach_approvals_recipient_on_approval') THEN
    ALTER TABLE public.outreach_approvals
      ADD CONSTRAINT outreach_approvals_recipient_on_approval
      CHECK (approved_recipient IS NULL OR (decision = 'approved' AND length(approved_recipient) > 0));
  END IF;
END
$$;

ALTER TABLE public.outreach_approvals DROP CONSTRAINT IF EXISTS outreach_approvals_decision_valid;
ALTER TABLE public.outreach_approvals
  ADD CONSTRAINT outreach_approvals_decision_valid CHECK (decision IN ('approved', 'rejected', 'revoked'));

ALTER TABLE public.outreach_governance_config
  ADD COLUMN IF NOT EXISTS self_approval_allowed boolean NOT NULL DEFAULT false;

-- T1 — server time for decided_at.
CREATE OR REPLACE FUNCTION public.outreach_approvals_server_decided_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.decided_at IS NULL THEN
    NEW.decided_at := clock_timestamp();
  ELSIF NEW.decided_at > clock_timestamp() THEN
    RAISE EXCEPTION 'outreach_approvals: decided_at % is later than the server clock', NEW.decided_at
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS outreach_approvals_server_decided_at ON public.outreach_approvals;
CREATE TRIGGER outreach_approvals_server_decided_at
  BEFORE INSERT ON public.outreach_approvals
  FOR EACH ROW EXECUTE FUNCTION public.outreach_approvals_server_decided_at();

-- The claim boundary — external execution needs a valid approval at the instant of the claim,
-- and the channel it was approved for cannot change underneath it (L-2).
CREATE OR REPLACE FUNCTION public.outreach_tasks_claim_requires_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  latest record;
  at_ts  timestamptz := clock_timestamp();
BEGIN
  IF NEW.channel IS DISTINCT FROM OLD.channel AND OLD.status NOT IN ('pending', 'awaiting_approval') THEN
    RAISE EXCEPTION 'outreach task %: the channel cannot change once the task has left review (% -> %)', NEW.id, OLD.channel, NEW.channel
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (NEW.status = 'dispatching' AND OLD.status IS DISTINCT FROM 'dispatching') THEN
    RETURN NEW;
  END IF;
  IF NEW.channel = 'internal' AND OLD.channel = 'internal' THEN
    RETURN NEW;
  END IF;
  SELECT a.decision, a.approved_content_hash, a.passkey_credential_id, a.passkey_verified_at, a.decided_at, a.created_at
    INTO latest
    FROM public.outreach_approvals a
   WHERE a.company_id = NEW.company_id AND a.task_id = NEW.id
   ORDER BY a.decided_at DESC, a.created_at DESC
   LIMIT 1;
  IF NOT FOUND
     OR latest.decision <> 'approved'
     OR latest.approved_content_hash IS NULL
     OR latest.passkey_credential_id IS NULL
     OR latest.passkey_verified_at > latest.decided_at + interval '1 minute'
     OR latest.passkey_verified_at < latest.decided_at - interval '5 minutes'
     OR latest.decided_at > at_ts
     OR latest.decided_at <= at_ts - interval '7 days'
     OR EXISTS (SELECT 1 FROM public.outreach_approvals r
                 WHERE r.company_id = NEW.company_id AND r.task_id = NEW.id
                   AND r.decision <> 'approved'
                   AND (r.decided_at >= latest.decided_at OR r.created_at >= latest.created_at)) THEN
    RAISE EXCEPTION 'outreach task % cannot be claimed for external dispatch: no current, content-bound, passkey-verified approval', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS outreach_tasks_claim_requires_approval ON public.outreach_tasks;
CREATE TRIGGER outreach_tasks_claim_requires_approval
  BEFORE UPDATE OF status, channel ON public.outreach_tasks
  FOR EACH ROW
  WHEN ((NEW.status = 'dispatching' AND OLD.status IS DISTINCT FROM 'dispatching') OR NEW.channel IS DISTINCT FROM OLD.channel)
  EXECUTE FUNCTION public.outreach_tasks_claim_requires_approval();

-- Trigger functions only: nobody calls them directly.
REVOKE ALL ON FUNCTION public.outreach_approvals_server_decided_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.outreach_tasks_claim_requires_approval() FROM PUBLIC, anon, authenticated;
