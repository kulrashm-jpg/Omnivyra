-- PORTED from refs/preserve/wt/pi-consol 20261115000000_pi_email_content_evidence.sql,
-- renumbered after main's 20270111 security baseline. One addition: the explicit REVOKE
-- below. This sorts after 20270111000002, so that class-wide revoke cannot cover it, and
-- rows here hold the personalized text sent to a person.
--
-- ===========================================================================
-- PI-041-A — EMAIL CONTENT EVIDENCE
--
-- What was actually sent, recorded immutably against the attempt that sent it.
--
--   outreach_attempts  (legacy, untouched)
--        ↓ 1:1
--   email_outreach_content_evidence     ← this migration
--
-- ─── THIS IS EVIDENCE, NOT MESSAGE VERSIONING ─────────────────────────────
-- J-5 remains deferred. There is no message library, no template entity, no
-- version chain and no reuse: one row records the exact bytes one attempt handed
-- the provider. `gtm_messages` is untouched and unreferenced. A row here can
-- answer "what did we send on this attempt" and nothing else — deliberately, so
-- it cannot grow into the content model 041-D declined to build.
--
-- ─── WHY A NEW TABLE AT ALL ───────────────────────────────────────────────
-- 041-A characterization found nowhere safe for it. `outreach_attempts` has no
-- content column. `outreach_delivery_evidence.transport_response` is the only
-- jsonb and is contractually content-FREE — `TransportResult.response` is
-- "redacted of message content" and `EmailProviderResponse.raw` is "already free
-- of message content" — so writing bodies there would invert the purpose of the
-- one column whose job is to keep content out. `outreach_internal_work_items`
-- belongs to the `internal` channel. Hence an additive, Email-owned table.
--
-- ─── WHY A SINGLE-COLUMN FK PLUS A GUARD ──────────────────────────────────
-- A tenant-safe composite FK would need `UNIQUE (id, company_id)` on
-- `outreach_attempts`, and altering the legacy substrate is forbidden. So this
-- follows the pattern 040 proved for its own legacy reference: a single-column
-- FK for referential integrity, and a trigger that refuses a row whose tenant
-- disagrees with the attempt's. Note `outreach_attempts.company_id` is `uuid`
-- (A3's `20261011000000` retyped the nine-table family after the committed
-- baseline was captured), so the comparison is uuid to uuid.
--
-- ─── IMMUTABLE, UNCONDITIONALLY ───────────────────────────────────────────
-- Unlike every lifecycle-bearing table in this chain, there is no state to move
-- here: evidence is history. So the guard refuses EVERY update outright rather
-- than freezing a column list, and the store exposes no update and no delete.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Preconditions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.outreach_attempts') IS NULL THEN
    RAISE EXCEPTION 'PI-041-A: outreach_attempts is missing';
  END IF;
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PI-041-A: companies is missing';
  END IF;
  -- The comparison below is uuid-to-uuid only if A3 has run. Fail loudly rather
  -- than silently comparing across types.
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'outreach_attempts'
         AND column_name = 'company_id') <> 'uuid' THEN
    RAISE EXCEPTION 'PI-041-A: outreach_attempts.company_id is not uuid — apply 20261011000000 first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. email_outreach_content_evidence — exactly the ratified minimum.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outreach_content_evidence (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid        NOT NULL,

  -- The attempt whose send this records. One attempt, one body.
  outreach_attempt_id    uuid        NOT NULL,

  -- The EXACT strings handed to the provider. Not a draft, not a template.
  rendered_subject       text        NOT NULL,
  rendered_body          text        NOT NULL,

  -- The personalization values actually used, so the render can be explained
  -- without re-reading a person record that has since changed.
  personalization_inputs jsonb       NOT NULL,

  -- How the content came to be, e.g. a deterministic generator and its version.
  content_source         text        NOT NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_outreach_content_evidence_subject_not_blank
    CHECK (length(btrim(rendered_subject)) > 0),
  CONSTRAINT email_outreach_content_evidence_body_not_blank
    CHECK (length(btrim(rendered_body)) > 0),
  CONSTRAINT email_outreach_content_evidence_source_not_blank
    CHECK (length(btrim(content_source)) > 0),
  CONSTRAINT email_outreach_content_evidence_inputs_is_object
    CHECK (jsonb_typeof(personalization_inputs) = 'object'),

  -- IDENTITY. One evidence row per attempt, per tenant. The database refuses a
  -- second; nothing checks-then-inserts.
  CONSTRAINT email_outreach_content_evidence_attempt_unique
    UNIQUE (organization_id, outreach_attempt_id),

  CONSTRAINT email_outreach_content_evidence_org_fk
    FOREIGN KEY (organization_id) REFERENCES public.companies (id) ON DELETE CASCADE,
  -- Single-column by necessity — see the header. Tenant agreement is the guard's.
  CONSTRAINT email_outreach_content_evidence_attempt_fk
    FOREIGN KEY (outreach_attempt_id)
    REFERENCES public.outreach_attempts (id) ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS ix_email_outreach_content_evidence_org
  ON public.email_outreach_content_evidence (organization_id, created_at);

ALTER TABLE public.email_outreach_content_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outreach_content_evidence FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guard — tenant agreement on insert, and no update ever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_outreach_content_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt_company uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'email_outreach_content_evidence: evidence row % is immutable — what was sent cannot be rewritten',
      OLD.id;
  END IF;

  SELECT company_id INTO v_attempt_company
    FROM public.outreach_attempts WHERE id = NEW.outreach_attempt_id;
  IF v_attempt_company IS NULL THEN
    RAISE EXCEPTION
      'email_outreach_content_evidence: attempt % does not exist', NEW.outreach_attempt_id;
  END IF;
  IF v_attempt_company IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'email_outreach_content_evidence: attempt % belongs to another tenant — evidence may never cross organizations',
      NEW.outreach_attempt_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_email_outreach_content_evidence_guard
  ON public.email_outreach_content_evidence;
CREATE TRIGGER trg_email_outreach_content_evidence_guard
  BEFORE INSERT OR UPDATE ON public.email_outreach_content_evidence
  FOR EACH ROW EXECUTE FUNCTION public.email_outreach_content_evidence_guard();

-- ---------------------------------------------------------------------------
-- 3. Postconditions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n integer;
  v text;
  v_code text;
  v_uniq text;
BEGIN
  -- Exactly the ratified column set and nothing more, so the table cannot drift
  -- into a content model: the SEVEN ratified columns — tenant, attempt, subject,
  -- body, personalization, source, created_at — plus the surrogate primary key,
  -- which is EIGHT in all.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'email_outreach_content_evidence';
  IF n <> 8 THEN
    RAISE EXCEPTION
      'PI-041-A postcondition: % columns, expected exactly 8 (the 7 ratified, plus id)', n;
  END IF;

  -- Named positively AND exhaustively: each ratified column is NOT NULL, and no
  -- column anywhere in the table is nullable. Evidence with a missing field would
  -- be a row that cannot explain the send it exists to explain.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'email_outreach_content_evidence'
     AND is_nullable = 'NO'
     AND column_name IN ('organization_id', 'outreach_attempt_id', 'rendered_subject',
                         'rendered_body', 'personalization_inputs', 'content_source',
                         'created_at');
  IF n <> 7 THEN
    RAISE EXCEPTION 'PI-041-A postcondition: % of 7 ratified columns are NOT NULL', n;
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'email_outreach_content_evidence'
     AND is_nullable = 'YES';
  IF n <> 0 THEN
    RAISE EXCEPTION 'PI-041-A postcondition: % nullable column(s) on the evidence table', n;
  END IF;

  -- The ratified exclusions. Denormalising the execution task would duplicate
  -- attribution 040 owns; a provider message id is only known AFTER the send, so
  -- storing it here would make evidence impossible to write at send time.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'email_outreach_content_evidence'
     AND column_name IN ('execution_task_id', 'provider_message_id', 'provider',
                         'state', 'status', 'updated_at', 'message_id',
                         'message_version_id', 'template_id');
  IF n > 0 THEN
    RAISE EXCEPTION 'PI-041-A postcondition: % excluded column(s) are present', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.email_outreach_content_evidence'::regclass
       AND conname = 'email_outreach_content_evidence_attempt_unique' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'PI-041-A postcondition: one-evidence-per-attempt is unenforced';
  END IF;

  -- Immutability must be database-enforced, not a convention.
  SELECT pg_get_functiondef(p.oid) INTO v
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'email_outreach_content_evidence_guard';
  IF v IS NULL THEN
    RAISE EXCEPTION 'PI-041-A postcondition: the evidence guard is missing';
  END IF;
  v_code := regexp_replace(v, '--.*', '', 'gn');
  IF v_code NOT LIKE '%TG_OP = ''UPDATE''%' THEN
    RAISE EXCEPTION 'PI-041-A postcondition: the guard does not refuse updates';
  END IF;
  IF v_code NOT LIKE '%belongs to another tenant%' THEN
    RAISE EXCEPTION 'PI-041-A postcondition: the guard does not check tenant agreement';
  END IF;
  IF length(v_code) < 300 THEN
    RAISE EXCEPTION 'PI-041-A postcondition: the guard body could not be read for inspection';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE NOT tgisinternal AND tgname = 'trg_email_outreach_content_evidence_guard'
  ) THEN
    RAISE EXCEPTION 'PI-041-A postcondition: the evidence trigger is missing';
  END IF;

  SELECT count(*) INTO n FROM pg_class
   WHERE relname = 'email_outreach_content_evidence' AND relrowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION 'PI-041-A postcondition: RLS is not enabled on the evidence table';
  END IF;

  -- The legacy substrate and every frozen invariant are untouched.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'outreach_attempts';
  IF n <> 15 THEN
    RAISE EXCEPTION 'PI-041-A postcondition: outreach_attempts has % columns, expected 15 — it was altered', n;
  END IF;
  -- Pinned to the EXACT pre-existing set, not asserted to be empty: WS-3 already
  -- gave this table `UNIQUE (company_id, task_id, attempt_number)`. Anything else
  -- appearing here would mean 041-A altered the legacy substrate.
  SELECT string_agg(conname, ',' ORDER BY conname) INTO v_uniq
    FROM pg_constraint
   WHERE conrelid = 'public.outreach_attempts'::regclass AND contype = 'u';
  IF v_uniq IS DISTINCT FROM 'outreach_attempts_unique' THEN
    RAISE EXCEPTION
      'PI-041-A postcondition: uniqueness on outreach_attempts changed (now: %)',
      coalesce(v_uniq, '<none>');
  END IF;
  -- And specifically NOT the companion key a tenant-safe composite FK would have
  -- required. Its absence is the entire reason this table uses a single-column FK
  -- plus a guard, so if it ever appears, that rationale must be revisited rather
  -- than silently outlived.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_attempts'::regclass AND contype = 'u'
       AND pg_get_constraintdef(oid) IN ('UNIQUE (id, company_id)',
                                         'UNIQUE (company_id, id)')
  ) THEN
    RAISE EXCEPTION
      'PI-041-A postcondition: a companion key was added to outreach_attempts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.outreach_tasks'::regclass
       AND conname = 'outreach_tasks_identity_unique'
  ) THEN
    RAISE EXCEPTION 'PI-041-A postcondition: the legacy outreach_tasks identity was altered';
  END IF;
  -- BOTH 040 identities, because 041-A depends on each for a different reason:
  -- `_task_unique` keeps one execution task to one handoff, and `_legacy_unique`
  -- is what makes resolving a context by (organization_id, outreach_task_id)
  -- return at most one row — the premise of the Email Engine's single-row read.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.outreach_bridge_handoffs'::regclass
     AND conname IN ('outreach_bridge_handoffs_task_unique',
                     'outreach_bridge_handoffs_legacy_unique');
  IF n <> 2 THEN
    RAISE EXCEPTION
      'PI-041-A postcondition: % of the 2 040 bridge identities are present', n;
  END IF;
  -- J-5 stays deferred.
  IF to_regclass('public.message_versions') IS NOT NULL
  OR to_regclass('public.gtm_message_versions') IS NOT NULL THEN
    RAISE EXCEPTION 'PI-041-A postcondition: a message-versioning table exists — J-5 is deferred';
  END IF;
END $$;
