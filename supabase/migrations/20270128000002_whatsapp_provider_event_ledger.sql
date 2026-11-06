-- Outreach (G-9b / N-2) — an append-only ledger of WhatsApp provider status events.
--
-- WHY. Meta's status webhooks (sent, delivered, read, failed) only moved
-- whatsapp_broadcast_recipients.status forward. The event itself was not kept: a `failed`
-- that arrived after `delivered` left no trace, and nothing could show when or why a
-- message failed. SES has outreach_delivery_evidence; WhatsApp had nothing.
--
-- WHAT IS STORED. Identity and status only: the Meta message id, the status, Meta's event
-- time, Meta's error code and title. NEVER a phone number or message text (N-4: nothing
-- here needs a retention decision).
--
-- RULES, enforced here:
--   * one row per (wa_message_id, status, event_at): a replayed webhook collapses;
--   * append-only: UPDATE and DELETE are refused for every role (the trigger), and
--     service_role is granted SELECT and INSERT only;
--   * anon and authenticated have no access.
--
-- Forward only; rollback in rollbacks/whatsapp_provider_event_ledger_rollback.sql.

CREATE TABLE IF NOT EXISTS public.whatsapp_provider_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id  text NOT NULL,
  event_status   text NOT NULL,
  event_at       timestamptz NOT NULL,
  error_code     integer,
  error_title    text,
  received_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_provider_events_status_valid CHECK (event_status IN ('sent', 'delivered', 'read', 'failed')),
  CONSTRAINT whatsapp_provider_events_message_id_present CHECK (length(btrim(wa_message_id)) > 0),
  CONSTRAINT whatsapp_provider_events_once UNIQUE (wa_message_id, event_status, event_at)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_provider_events_message
  ON public.whatsapp_provider_events (wa_message_id, event_at);

CREATE OR REPLACE FUNCTION public.whatsapp_provider_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'whatsapp_provider_events is append-only (% refused)', TG_OP
    USING ERRCODE = '42501';
END $$;

REVOKE EXECUTE ON FUNCTION public.whatsapp_provider_events_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS whatsapp_provider_events_append_only ON public.whatsapp_provider_events;
CREATE TRIGGER whatsapp_provider_events_append_only
  BEFORE UPDATE OR DELETE ON public.whatsapp_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_provider_events_append_only();

ALTER TABLE public.whatsapp_provider_events ENABLE ROW LEVEL SECURITY;

DO $wpe_rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'whatsapp_provider_events'
       AND policyname = 'whatsapp_provider_events_service_role'
  ) THEN
    CREATE POLICY whatsapp_provider_events_service_role
      ON public.whatsapp_provider_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$wpe_rls$;

-- Own grants, not the platform defaults: the governed build does not
-- reproduce them, and a later class-wide REVOKE would not list this table.
REVOKE ALL ON TABLE public.whatsapp_provider_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.whatsapp_provider_events TO service_role;

COMMENT ON TABLE public.whatsapp_provider_events IS
  'Meta WhatsApp status events (sent/delivered/read/failed), one row per (message, status, event time). '
  'Append-only; identity and status only, never a phone number or text.';
