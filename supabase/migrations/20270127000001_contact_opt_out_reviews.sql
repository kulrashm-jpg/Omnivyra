-- Orchestration (G-11) — the opt-out hold's company-admin review.
--
-- WHY. Owner rules (2026-11-07): EVERY opt-out (a WhatsApp STOP, an email unsubscribe link, an
-- operator-recorded free-text `opt_out`) puts an immediate hold on ALL channels for that contact
-- in that tenant, and the tenant's OWN admin (COMPANY_ADMIN in that company; the platform
-- super-admin bypass is not accepted) decides whether contact is allowed again, and on which
-- channels, within 3 working days. With no decision every medium stays closed; closed is the
-- default, so no job runs here.
--
-- The HOLD itself is not stored here: it is an all-channel (`*`) `unsubscribe` in
-- contact_governance_records, written by the caller through the canonical governance writer.
-- This table is the REVIEW: which holds it adopted (and may therefore revoke on a reopen),
-- which it found already present (never revoked), which channels the trigger locked (a STOP or
-- an unsubscribe keeps THAT channel closed for good), and the admin's decision.
--
-- WHAT A ROW MEANS. One review per contact anchor at a time: a person when one resolves,
-- otherwise the canonical target (normalizePhone / normalizeEmail). A trigger while a review is
-- pending JOINS it; the unique partial index below makes "one pending review per anchor" a
-- database fact, so two concurrent opens converge (the loser re-reads and joins). A decided
-- review stays decided; a new trigger after it opens a NEW review.
--
-- `revision` is the compare-and-set token: a join and a decision each move it by one, so a
-- concurrent join and decision never silently overwrite each other's arrays or fields.
--
-- PERSONAL DATA. A target-anchored review holds the canonical address or number in
-- `anchor_value`, as contact_governance_records holds it in `target_normalized`: the review
-- governs that address and must outlive the person (see the OPEN item on erasure).
--
-- Tenant table: RLS on, EXPLICIT REVOKE from anon/authenticated and an explicit grant to
-- service_role, because class-wide hardening migrations only list the tables they knew of.
-- No DELETE is granted: a review is a historical record. Forward only; rollback in
-- rollbacks/contact_opt_out_reviews_rollback.sql.

CREATE TABLE IF NOT EXISTS public.contact_opt_out_reviews (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,
  -- 'person': anchor_value is the person id. 'target': the canonical address or number.
  anchor_kind            text        NOT NULL,
  anchor_channel         text,
  anchor_value           text        NOT NULL,
  person_id              uuid,
  triggers               text[]      NOT NULL,
  locked_channels        text[]      NOT NULL DEFAULT '{}'::text[],
  -- Holds this review may revoke: (source, source ref) matched the trigger that opened or joined it.
  adopted_hold_ids       uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  -- Holds the caller named that belong to something else: recorded, NEVER revoked.
  pre_existing_hold_ids  uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  -- The channel-scoped STOP / unsubscribe rows: recorded, NEVER revoked.
  trigger_record_ids     uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  -- Channel-scoped closes this review CREATED at a decision (revocable only by a later reopen).
  closing_record_ids     uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  source_refs            text[]      NOT NULL,
  opened_at              timestamptz NOT NULL DEFAULT now(),
  due_at                 timestamptz NOT NULL,
  due_timezone           text        NOT NULL,
  -- True when the company has no usable timezone and the due date was counted in UTC.
  due_timezone_fallback  boolean     NOT NULL DEFAULT false,
  state                  text        NOT NULL DEFAULT 'pending',
  decision               text,
  reopened_channels      text[]      NOT NULL DEFAULT '{}'::text[],
  closed_channels        text[]      NOT NULL DEFAULT '{}'::text[],
  decided_by             uuid,
  decided_at             timestamptz,
  reason                 text,
  revision               integer     NOT NULL DEFAULT 0,

  CONSTRAINT contact_opt_out_reviews_anchor_kind_valid
    CHECK (anchor_kind IN ('person', 'target')),
  CONSTRAINT contact_opt_out_reviews_anchor_channel_valid
    CHECK ((anchor_kind = 'person' AND anchor_channel IS NULL)
        OR (anchor_kind = 'target' AND anchor_channel IN ('whatsapp', 'phone', 'email'))),
  -- A target anchor deliberately holds no person (else a person delete would abort in the guard).
  CONSTRAINT contact_opt_out_reviews_target_has_no_person
    CHECK (anchor_kind <> 'target' OR person_id IS NULL),
  CONSTRAINT contact_opt_out_reviews_anchor_value_not_blank
    CHECK (length(btrim(anchor_value)) > 0),
  -- A person anchor names its person. Erasure clears person_id (the FK's SET NULL) and the
  -- guard below rewrites anchor_value to the review's own tombstone, so no person key remains:
  -- a person anchor without a person is valid ONLY as 'erased:' || id.
  -- set-null-ok: the FK's SET NULL fires the BEFORE UPDATE guard, which rewrites anchor_value to 'erased:' || id in the same row, so this CHECK holds after the delete (proven: g11_optout_review erasure tests, mutants M17/M18).
  CONSTRAINT contact_opt_out_reviews_person_anchor_consistent
    CHECK (anchor_kind <> 'person'
        OR (person_id IS NOT NULL AND person_id::text = anchor_value)
        OR (person_id IS NULL AND anchor_value = 'erased:' || id::text)),
  CONSTRAINT contact_opt_out_reviews_triggers_valid
    CHECK (cardinality(triggers) > 0
       AND triggers <@ ARRAY['whatsapp_stop', 'email_unsubscribe', 'reply_opt_out']::text[]),
  CONSTRAINT contact_opt_out_reviews_channels_known
    CHECK (locked_channels <@ ARRAY['email', 'phone', 'whatsapp']::text[]
       AND reopened_channels <@ ARRAY['email', 'phone', 'whatsapp']::text[]
       AND closed_channels <@ ARRAY['email', 'phone', 'whatsapp']::text[]),
  -- A locked channel is never reopened by a review.
  CONSTRAINT contact_opt_out_reviews_locked_stays_closed
    CHECK (NOT (reopened_channels && locked_channels)),
  CONSTRAINT contact_opt_out_reviews_source_refs_present
    CHECK (cardinality(source_refs) > 0),
  CONSTRAINT contact_opt_out_reviews_due_after_open
    CHECK (due_at > opened_at),
  CONSTRAINT contact_opt_out_reviews_state_valid
    CHECK (state IN ('pending', 'decided')),
  CONSTRAINT contact_opt_out_reviews_decision_valid
    CHECK (decision IS NULL OR decision IN ('reopen', 'keep_closed')),
  -- Pending carries no decision; decided carries all of it, with a reason.
  CONSTRAINT contact_opt_out_reviews_decision_complete
    CHECK ((state = 'pending' AND decision IS NULL AND decided_by IS NULL AND decided_at IS NULL AND reason IS NULL
            AND cardinality(reopened_channels) = 0 AND cardinality(closed_channels) = 0)
        OR (state = 'decided' AND decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
            AND reason IS NOT NULL AND length(btrim(reason)) > 0)),
  CONSTRAINT contact_opt_out_reviews_decision_matches_channels
    CHECK (decision IS NULL OR (decision = 'reopen') = (cardinality(reopened_channels) > 0)),
  CONSTRAINT contact_opt_out_reviews_revision_nonnegative
    CHECK (revision >= 0),

  CONSTRAINT contact_opt_out_reviews_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  -- Tenant-safe person reference (the contact_governance_records pattern): another tenant's
  -- person is refused by the database; erasure clears the column and keeps the review.
  CONSTRAINT contact_opt_out_reviews_person_tenant_fk
    FOREIGN KEY (person_id, organization_id)
    REFERENCES public.unified_persons (id, company_id) ON DELETE SET NULL (person_id)
);

-- ONE pending review per anchor: concurrent opens converge, the loser (23505) joins.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_opt_out_reviews_pending_anchor
  ON public.contact_opt_out_reviews (organization_id, anchor_kind, anchor_value)
  WHERE state = 'pending';

-- The admin listing: pending first, by due date.
CREATE INDEX IF NOT EXISTS ix_contact_opt_out_reviews_org_state_due
  ON public.contact_opt_out_reviews (organization_id, state, due_at);

-- Identity and history are immutable: the anchor, the tenant and the opening never change, and a
-- decided review never returns to pending (a new trigger opens a NEW review instead).
-- ONE permitted anchor change: person erasure. When the FK's ON DELETE SET NULL clears person_id
-- on a person anchor, the guard itself rewrites anchor_value to 'erased:' || id, so the erased
-- person's uuid is left in no column. The review keeps its state: a pending one stays closed.
-- The tombstone is the REVIEW's own id, never the person's, and only a PERSON anchor is
-- rewritten: a target anchor's canonical value is kept (PI ruling, erasure policy KEEP list).
--   * The 'erased:' prefix can never equal a canonical target: normalizePhone and
--     normalizeEmail never produce it, so a tombstone cannot collide with, or be matched as, an
--     address or number.
--   * Deriving it from the row id keeps uq_contact_opt_out_reviews_pending_anchor collision-free
--     across erasures; a constant tombstone would make the second erasure in a tenant fail 23505.
CREATE OR REPLACE FUNCTION public.contact_opt_out_reviews_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.anchor_kind = 'person' AND OLD.person_id IS NOT NULL AND NEW.person_id IS NULL
     AND NEW.anchor_value IS NOT DISTINCT FROM OLD.anchor_value THEN
    NEW.anchor_value := 'erased:' || NEW.id::text;
  ELSIF NEW.person_id IS DISTINCT FROM OLD.person_id THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its person; only erasure clears it', OLD.id
      USING ERRCODE = '23514';
  ELSIF NEW.anchor_value IS DISTINCT FROM OLD.anchor_value THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its tenant, anchor and opening', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.anchor_kind IS DISTINCT FROM OLD.anchor_kind
     OR NEW.anchor_channel IS DISTINCT FROM OLD.anchor_channel
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % keeps its tenant, anchor and opening', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'decided' AND NEW.state <> 'decided' THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % is decided; a new trigger opens a new review', OLD.id
      USING ERRCODE = '23514';
  END IF;
  -- An adopted, pre-existing, trigger or locked entry is never dropped.
  IF NOT (OLD.adopted_hold_ids <@ NEW.adopted_hold_ids
      AND OLD.pre_existing_hold_ids <@ NEW.pre_existing_hold_ids
      AND OLD.trigger_record_ids <@ NEW.trigger_record_ids
      AND OLD.locked_channels <@ NEW.locked_channels
      AND OLD.triggers <@ NEW.triggers
      AND OLD.source_refs <@ NEW.source_refs) THEN
    RAISE EXCEPTION 'contact_opt_out_reviews: review % only ever gains holds, triggers and locks', OLD.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.contact_opt_out_reviews_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.contact_opt_out_reviews_guard() FROM anon;
REVOKE ALL ON FUNCTION public.contact_opt_out_reviews_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_contact_opt_out_reviews_guard ON public.contact_opt_out_reviews;
CREATE TRIGGER trg_contact_opt_out_reviews_guard
  BEFORE UPDATE ON public.contact_opt_out_reviews
  FOR EACH ROW EXECUTE FUNCTION public.contact_opt_out_reviews_guard();

ALTER TABLE public.contact_opt_out_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_opt_out_reviews_service_role ON public.contact_opt_out_reviews;
CREATE POLICY contact_opt_out_reviews_service_role ON public.contact_opt_out_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.contact_opt_out_reviews FROM PUBLIC;
REVOKE ALL ON public.contact_opt_out_reviews FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contact_opt_out_reviews TO service_role;

COMMENT ON TABLE public.contact_opt_out_reviews IS
  'Orchestration G-11: the company-admin review of an opt-out hold (an all-channel unsubscribe in contact_governance_records). One pending review per anchor; adopted holds may be revoked by a reopen, pre-existing ones and trigger records never are.';

-- Postconditions.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.contact_opt_out_reviews'::regclass AND contype = 'f';
  IF n <> 2 THEN
    RAISE EXCEPTION 'G-11 postcondition: % foreign keys on contact_opt_out_reviews, expected 2', n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                  AND indexname = 'uq_contact_opt_out_reviews_pending_anchor') THEN
    RAISE EXCEPTION 'G-11 postcondition: one pending review per anchor is unenforced';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.contact_opt_out_reviews'::regclass) THEN
    RAISE EXCEPTION 'G-11 postcondition: RLS is off on contact_opt_out_reviews';
  END IF;
  IF has_table_privilege('authenticated', 'public.contact_opt_out_reviews', 'SELECT')
     OR has_table_privilege('anon', 'public.contact_opt_out_reviews', 'SELECT') THEN
    RAISE EXCEPTION 'G-11 postcondition: a client role can read contact_opt_out_reviews';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contact_opt_out_reviews'::regclass
                  AND conname = 'contact_opt_out_reviews_target_has_no_person' AND contype = 'c') THEN
    RAISE EXCEPTION 'G-11 postcondition: a target anchor could carry a person';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.contact_opt_out_reviews'::regclass
                  AND tgname = 'trg_contact_opt_out_reviews_guard') THEN
    RAISE EXCEPTION 'G-11 postcondition: the review guard is missing';
  END IF;
END
$$;
