-- Outreach (owner GO 2026-11-08) — the person behind a journey broadcast recipient, so the
-- send-time check can apply person-level restrictions as well as the number's.
--
-- WHY. processBatch asked mayContact about the NUMBER only. A restriction recorded against
-- the person (an operator opt-out, a G-11 person hold) did not stop a journey broadcast to a
-- number that carried no restriction of its own: a different number, or one added after the
-- opt-out. The recipient now names its person, and the check reads both.
--
-- WHAT IS STORED.
--   person_id          the canonical person (unified_persons.id). Journey recipients only:
--                      Orchestration writes it through expandPersonRecipients. Manual
--                      broadcasts never carry one and stay number-only.
--   person_company_id  the tenant of that person, DERIVED here from the recipient's
--                      broadcast. The writer never supplies it; a value that disagrees is
--                      refused. It exists so the composite FK can refuse another tenant's
--                      person, and it is kept after erasure (W5 composite pattern,
--                      20261002000000_li2_source_records.sql).
--
-- RULES, enforced here:
--   * FK (person_id, person_company_id) -> unified_persons (id, company_id)
--     ON DELETE SET NULL (person_id): erasing the person makes the recipient number-only,
--     and the number's own (target-keyed) holds still apply;
--   * a person of another tenant is refused by the FK (23503);
--   * person_id never changes after insert, except when its person is GONE: the FK's SET NULL
--     runs after the person row is deleted, so the guard allows non-null -> NULL only when
--     that person no longer exists (a data probe, measured in the real-schema suite). Any
--     other writer that clears or changes person_id while the person exists, an application
--     UPDATE or another trigger alike, is refused (23514), so a journey recipient cannot be
--     quietly downgraded to number-only;
--   * person_company_id never changes; a recipient with a person never changes broadcast.
-- No phone-to-person lookup exists anywhere: the identity comes only from the journey.
--
-- Forward only; rollback in rollbacks/whatsapp_broadcast_recipient_person_rollback.sql.

ALTER TABLE public.whatsapp_broadcast_recipients
  ADD COLUMN IF NOT EXISTS person_id uuid,
  ADD COLUMN IF NOT EXISTS person_company_id uuid;

DO $wbr_person_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_broadcast_recipients_person_tenant_fk') THEN
    ALTER TABLE public.whatsapp_broadcast_recipients
      ADD CONSTRAINT whatsapp_broadcast_recipients_person_tenant_fk
      FOREIGN KEY (person_id, person_company_id)
      REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id);
  END IF;
END
$wbr_person_fk$;

-- The FK's SET NULL looks recipients up by person.
CREATE INDEX IF NOT EXISTS idx_whatsapp_broadcast_recipients_person
  ON public.whatsapp_broadcast_recipients (person_id, person_company_id) WHERE person_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.whatsapp_broadcast_recipients_person_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.person_id IS NULL THEN
      IF NEW.person_company_id IS NOT NULL THEN
        RAISE EXCEPTION 'whatsapp_broadcast_recipients: a tenant without a person is not an identity'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    SELECT b.company_id INTO v_company FROM public.whatsapp_broadcasts b WHERE b.id = NEW.broadcast_id;
    IF v_company IS NULL THEN
      RAISE EXCEPTION 'whatsapp_broadcast_recipients: the broadcast of a person recipient must exist'
        USING ERRCODE = '23503';
    END IF;
    IF NEW.person_company_id IS NOT NULL AND NEW.person_company_id IS DISTINCT FROM v_company THEN
      RAISE EXCEPTION 'whatsapp_broadcast_recipients: the person''s tenant is the broadcast''s tenant'
        USING ERRCODE = '42501';
    END IF;
    NEW.person_company_id := v_company;
    RETURN NEW;
  END IF;

  -- UPDATE.
  IF NEW.person_company_id IS DISTINCT FROM OLD.person_company_id THEN
    RAISE EXCEPTION 'whatsapp_broadcast_recipients: recipient % keeps its person''s tenant', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    -- Only once the person is gone (the FK's ON DELETE SET NULL). A data probe, not a
    -- context guess: "inside some trigger" would also admit an unrelated trigger.
    IF NOT (OLD.person_id IS NOT NULL AND NEW.person_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM public.unified_persons p WHERE p.id = OLD.person_id)) THEN
      RAISE EXCEPTION 'whatsapp_broadcast_recipients: recipient % keeps its person; only erasure clears it', OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.person_company_id IS NOT NULL AND NEW.broadcast_id IS DISTINCT FROM OLD.broadcast_id THEN
    RAISE EXCEPTION 'whatsapp_broadcast_recipients: recipient % with a person keeps its broadcast', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.whatsapp_broadcast_recipients_person_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_broadcast_recipients_person_guard() FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_broadcast_recipients_person_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_broadcast_recipients_person_guard ON public.whatsapp_broadcast_recipients;
CREATE TRIGGER trg_whatsapp_broadcast_recipients_person_guard
  BEFORE INSERT OR UPDATE ON public.whatsapp_broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.whatsapp_broadcast_recipients_person_guard();

-- Postconditions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'whatsapp_broadcast_recipients_person_tenant_fk'
                    AND conrelid = 'public.whatsapp_broadcast_recipients'::regclass
                    AND confrelid = 'public.unified_persons'::regclass
                    AND confdeltype = 'n') THEN
    RAISE EXCEPTION 'postcondition: the recipient person FK (ON DELETE SET NULL) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_broadcast_recipients'::regclass
                  AND tgname = 'trg_whatsapp_broadcast_recipients_person_guard' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'postcondition: the recipient person guard is missing';
  END IF;
  IF has_column_privilege('anon', 'public.whatsapp_broadcast_recipients', 'person_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.whatsapp_broadcast_recipients', 'person_id', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition: a client role can read whatsapp_broadcast_recipients.person_id';
  END IF;
END
$$;
