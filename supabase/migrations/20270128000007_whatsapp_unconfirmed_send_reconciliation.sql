-- Outreach (Follow-up A to Work Item 2 / L-4, owner direction 2026-11-09): reconcile stale
-- unconfirmed WhatsApp sends from provider evidence, never by resending.
--
-- WHY. A send whose outcome is unknown stays `send_uncertain` (or `sending`, if the process
-- died after the claim) with no message id. Work Item 2 reconciles it when a status webhook
-- carries the recipient's marker (biz_opaque_callback_data = recipient id) for the same
-- number. If that webhook job ran out of attempts after the event was recorded, the event
-- stayed in whatsapp_provider_events, but nothing there linked it to the recipient: the
-- ledger is keyed by Meta's message id, which the row never received. Rows with no
-- evidence at all were invisible.
--
-- WHAT THIS ADDS:
--   * whatsapp_provider_events.verified_recipient_id: the recipient the event's marker
--     named, written ONLY when the event's number equals that recipient's number (checked
--     by the webhook job before the event is recorded). Our own id; never a phone number.
--     No foreign key: the ledger is append-only, so ON DELETE SET NULL could never run.
--   * whatsapp_broadcast_recipients.send_started_at: when the send was claimed, so age is
--     measured from the claim, not from the recipient's creation.
--   * whatsapp_send_reconciliations: an append-only audit of what the sweep did, one row per
--     (recipient, outcome). Ids and statuses only.
--   * Three functions, the sweep's only way to read candidates and write state. Each is
--     tenant-scoped (the tenant is derived from the broadcast) and idempotent.
--
-- RULES:
--   * Nothing here sends. Nothing here writes `failed` without a provider event saying so.
--   * Attaching needs ledger evidence that names this recipient AND this message id.
--   * A stale `sending` row without evidence becomes `send_uncertain` (unknown), never
--     `failed`, and is flagged for an operator.
--
-- Forward only; rollback in rollbacks/whatsapp_unconfirmed_send_reconciliation_rollback.sql.
-- Local only: tested on a disposable database. Not applied to any real environment.

ALTER TABLE public.whatsapp_broadcast_recipients
  ADD COLUMN IF NOT EXISTS send_started_at timestamptz;

ALTER TABLE public.whatsapp_provider_events
  ADD COLUMN IF NOT EXISTS verified_recipient_id uuid;

CREATE INDEX IF NOT EXISTS idx_whatsapp_provider_events_verified_recipient
  ON public.whatsapp_provider_events (verified_recipient_id, event_at)
  WHERE verified_recipient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_broadcast_recipients_unconfirmed
  ON public.whatsapp_broadcast_recipients (broadcast_id)
  WHERE status IN ('sending', 'send_uncertain') AND wa_message_id IS NULL;

COMMENT ON COLUMN public.whatsapp_provider_events.verified_recipient_id IS
  'The broadcast recipient named by the event''s biz_opaque_callback_data, recorded only when the '
  'event''s number matched that recipient''s number. Our id, never a phone number.';

CREATE TABLE IF NOT EXISTS public.whatsapp_send_reconciliations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  broadcast_id        uuid NOT NULL,
  recipient_id        uuid NOT NULL,
  outcome             text NOT NULL,
  from_status         text NOT NULL,
  to_status           text NOT NULL,
  wa_message_id       text NULL,
  evidence_event_ids  uuid[] NOT NULL DEFAULT '{}',
  sweep_run_id        uuid NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_send_reconciliations_outcome_valid CHECK (outcome IN (
    'provider_evidence_attached',
    'stale_sending_marked_uncertain',
    'awaiting_operator_review',
    'conflicting_provider_evidence'
  )),
  CONSTRAINT whatsapp_send_reconciliations_attached_has_evidence CHECK (
    outcome <> 'provider_evidence_attached'
    OR (wa_message_id IS NOT NULL AND cardinality(evidence_event_ids) > 0)
  ),
  CONSTRAINT whatsapp_send_reconciliations_once UNIQUE (recipient_id, outcome)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_send_reconciliations_company
  ON public.whatsapp_send_reconciliations (company_id, recorded_at);

CREATE OR REPLACE FUNCTION public.whatsapp_send_reconciliations_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'whatsapp_send_reconciliations is append-only (% refused)', TG_OP
    USING ERRCODE = '42501';
END $$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_send_reconciliations_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS whatsapp_send_reconciliations_append_only ON public.whatsapp_send_reconciliations;
CREATE TRIGGER whatsapp_send_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON public.whatsapp_send_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_send_reconciliations_append_only();

ALTER TABLE public.whatsapp_send_reconciliations ENABLE ROW LEVEL SECURITY;

DO $wsr_rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'whatsapp_send_reconciliations'
       AND policyname = 'whatsapp_send_reconciliations_service_role'
  ) THEN
    CREATE POLICY whatsapp_send_reconciliations_service_role
      ON public.whatsapp_send_reconciliations
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$wsr_rls$;

-- Own grants, not the platform defaults (hosted Supabase would otherwise give service_role
-- ALL, including UPDATE and DELETE, and a later class-wide REVOKE would not list this table).
REVOKE ALL ON TABLE public.whatsapp_send_reconciliations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.whatsapp_send_reconciliations TO service_role;

COMMENT ON TABLE public.whatsapp_send_reconciliations IS
  'Append-only audit of the unconfirmed-send sweep: one row per (recipient, outcome). Ids and statuses only.';

-- ── Candidates: stale unconfirmed sends of ONE tenant, bounded ─────────────────────────
-- Rows that already have provider evidence come first (they can be resolved), then rows
-- not yet flagged for an operator, then the rest, oldest first. Without that order a full
-- page of unresolvable rows would starve every newer one.
CREATE OR REPLACE FUNCTION public.whatsapp_unconfirmed_sends(
  p_company_id uuid,
  p_cutoff     timestamptz,
  p_limit      integer
)
RETURNS TABLE (recipient_id uuid, broadcast_id uuid, status text, stale_since timestamptz, has_evidence boolean, flagged boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r.id,
         r.broadcast_id,
         r.status,
         COALESCE(r.send_started_at, r.created_at),
         EXISTS (SELECT 1 FROM public.whatsapp_provider_events e WHERE e.verified_recipient_id = r.id),
         EXISTS (SELECT 1 FROM public.whatsapp_send_reconciliations s
                  WHERE s.recipient_id = r.id AND s.outcome = 'awaiting_operator_review')
    FROM public.whatsapp_broadcast_recipients r
    JOIN public.whatsapp_broadcasts b ON b.id = r.broadcast_id
   WHERE b.company_id = p_company_id
     AND r.status IN ('sending', 'send_uncertain')
     AND r.wa_message_id IS NULL
     AND COALESCE(r.send_started_at, r.created_at) < p_cutoff
   ORDER BY 5 DESC, 6 ASC, 4 ASC, r.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 1), 1), 500)
$$;

-- ── Attach provider evidence (atomic: state + audit, or nothing) ───────────────────────
CREATE OR REPLACE FUNCTION public.whatsapp_attach_unconfirmed_send(
  p_company_id         uuid,
  p_recipient_id       uuid,
  p_wa_message_id      text,
  p_status             text,
  p_sent_at            timestamptz,
  p_delivered_at       timestamptz,
  p_read_at            timestamptz,
  p_error_code         integer,
  p_error_message      text,
  p_evidence_event_ids uuid[],
  p_sweep_run_id       uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broadcast uuid;
  v_from      text;
  v_matched   integer;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('sent', 'delivered', 'read', 'failed') THEN
    RAISE EXCEPTION 'whatsapp_attach_unconfirmed_send: status % is not a provider outcome', p_status
      USING ERRCODE = '22023';
  END IF;
  IF p_evidence_event_ids IS NULL OR cardinality(p_evidence_event_ids) = 0 THEN
    RAISE EXCEPTION 'whatsapp_attach_unconfirmed_send: no evidence named' USING ERRCODE = '22023';
  END IF;

  -- The evidence is read here, not trusted from the caller: every named event must be a
  -- verified event of THIS recipient for THIS message.
  SELECT count(*) INTO v_matched
    FROM public.whatsapp_provider_events e
   WHERE e.id = ANY (p_evidence_event_ids)
     AND e.verified_recipient_id = p_recipient_id
     AND e.wa_message_id = p_wa_message_id;
  IF v_matched <> cardinality(p_evidence_event_ids) THEN
    RAISE EXCEPTION 'whatsapp_attach_unconfirmed_send: evidence does not name recipient % and message', p_recipient_id
      USING ERRCODE = '22023';
  END IF;

  SELECT r.broadcast_id, r.status INTO v_broadcast, v_from
    FROM public.whatsapp_broadcast_recipients r
    JOIN public.whatsapp_broadcasts b ON b.id = r.broadcast_id
   WHERE r.id = p_recipient_id
     AND b.company_id = p_company_id
     AND r.status IN ('sending', 'send_uncertain')
     AND r.wa_message_id IS NULL
     FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.whatsapp_broadcast_recipients
     SET status        = p_status,
         wa_message_id = p_wa_message_id,
         sent_at       = COALESCE(sent_at, p_sent_at),
         delivered_at  = COALESCE(p_delivered_at, delivered_at),
         read_at       = COALESCE(p_read_at, read_at),
         error_code    = COALESCE(p_error_code, error_code),
         error_message = COALESCE(p_error_message, error_message)
   WHERE id = p_recipient_id;

  INSERT INTO public.whatsapp_send_reconciliations
    (company_id, broadcast_id, recipient_id, outcome, from_status, to_status, wa_message_id, evidence_event_ids, sweep_run_id)
  VALUES
    (p_company_id, v_broadcast, p_recipient_id, 'provider_evidence_attached', v_from, p_status, p_wa_message_id, p_evidence_event_ids, p_sweep_run_id)
  ON CONFLICT (recipient_id, outcome) DO NOTHING;

  RETURN true;
END $$;

-- ── A stale `sending` row with no evidence is UNKNOWN, not failed ──────────────────────
CREATE OR REPLACE FUNCTION public.whatsapp_mark_stale_send_uncertain(
  p_company_id   uuid,
  p_recipient_id uuid,
  p_cutoff       timestamptz,
  p_sweep_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broadcast uuid;
BEGIN
  SELECT r.broadcast_id INTO v_broadcast
    FROM public.whatsapp_broadcast_recipients r
    JOIN public.whatsapp_broadcasts b ON b.id = r.broadcast_id
   WHERE r.id = p_recipient_id
     AND b.company_id = p_company_id
     AND r.status = 'sending'
     AND r.wa_message_id IS NULL
     AND COALESCE(r.send_started_at, r.created_at) < p_cutoff
     FOR UPDATE OF r;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  -- Evidence outranks staleness: such a row is attached, never marked.
  IF EXISTS (SELECT 1 FROM public.whatsapp_provider_events e WHERE e.verified_recipient_id = p_recipient_id) THEN
    RETURN false;
  END IF;

  UPDATE public.whatsapp_broadcast_recipients
     SET status        = 'send_uncertain',
         error_message = 'stale_sending: the process stopped after the claim; outcome unknown, never resent'
   WHERE id = p_recipient_id;

  INSERT INTO public.whatsapp_send_reconciliations
    (company_id, broadcast_id, recipient_id, outcome, from_status, to_status, sweep_run_id)
  VALUES
    (p_company_id, v_broadcast, p_recipient_id, 'stale_sending_marked_uncertain', 'sending', 'send_uncertain', p_sweep_run_id)
  ON CONFLICT (recipient_id, outcome) DO NOTHING;

  RETURN true;
END $$;

-- ── Flag for an operator (no state change) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.whatsapp_flag_unconfirmed_send(
  p_company_id   uuid,
  p_recipient_id uuid,
  p_outcome      text,
  p_sweep_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_broadcast uuid;
  v_status    text;
  v_inserted  uuid;
BEGIN
  IF p_outcome NOT IN ('awaiting_operator_review', 'conflicting_provider_evidence') THEN
    RAISE EXCEPTION 'whatsapp_flag_unconfirmed_send: % is not a flag', p_outcome USING ERRCODE = '22023';
  END IF;

  SELECT r.broadcast_id, r.status INTO v_broadcast, v_status
    FROM public.whatsapp_broadcast_recipients r
    JOIN public.whatsapp_broadcasts b ON b.id = r.broadcast_id
   WHERE r.id = p_recipient_id
     AND b.company_id = p_company_id
     AND r.status IN ('sending', 'send_uncertain')
     AND r.wa_message_id IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.whatsapp_send_reconciliations
    (company_id, broadcast_id, recipient_id, outcome, from_status, to_status, sweep_run_id)
  VALUES
    (p_company_id, v_broadcast, p_recipient_id, p_outcome, v_status, v_status, p_sweep_run_id)
  ON CONFLICT (recipient_id, outcome) DO NOTHING
  RETURNING id INTO v_inserted;

  RETURN v_inserted IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_unconfirmed_sends(uuid, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_flag_unconfirmed_send(uuid, uuid, text, uuid) TO service_role;

-- ── Postconditions ─────────────────────────────────────────────────────────────────────
DO $wsr_post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.whatsapp_provider_events'::regclass
                  AND attname = 'verified_recipient_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'postcondition: whatsapp_provider_events.verified_recipient_id missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.whatsapp_broadcast_recipients'::regclass
                  AND attname = 'send_started_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'postcondition: whatsapp_broadcast_recipients.send_started_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_send_reconciliations'::regclass
                  AND tgname = 'whatsapp_send_reconciliations_append_only' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'postcondition: whatsapp_send_reconciliations append-only trigger missing or disabled';
  END IF;
  IF has_table_privilege('service_role', 'public.whatsapp_send_reconciliations', 'UPDATE')
     OR has_table_privilege('service_role', 'public.whatsapp_send_reconciliations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.whatsapp_send_reconciliations', 'SELECT')
     OR has_table_privilege('anon', 'public.whatsapp_send_reconciliations', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition: whatsapp_send_reconciliations grants are wider than SELECT, INSERT for service_role';
  END IF;
  IF has_function_privilege('authenticated', 'public.whatsapp_attach_unconfirmed_send(uuid, uuid, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid[], uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.whatsapp_mark_stale_send_uncertain(uuid, uuid, timestamptz, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: a client role can execute a reconciliation function';
  END IF;
END
$wsr_post$;
