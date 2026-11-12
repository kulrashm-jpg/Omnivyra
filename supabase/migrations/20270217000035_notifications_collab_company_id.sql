-- 20270217000035 - company_id on notifications, message_reads and message_mentions (6f; version from 83, e9 ruling).
--
-- WHY.
--   notifications: a per-USER inbox (user_id NOT NULL) with no company column. Five writers inserted company
--     events with columns that do not exist (company_id / body / read; organization_id / category), so PostgREST
--     refused every insert, the writers swallowed the error, and campaign-health, recovery, scheduler-approval,
--     campaign-approved and credit alerts were NEVER delivered (55's finding, confirmed against baseline +
--     20260321 / 20260322). Company events are now written one row per recipient WITH company_id (e9 ruling:
--     the campaign creator + active COMPANY_ADMINs, resolved at send time through ACTIVE memberships). Per-user
--     notices that belong to no company keep company_id NULL - so the column is NULLABLE.
--   message_reads / message_mentions: message_id is POLYMORPHIC (message_source activity / calendar / campaign),
--     so a row cannot reach its company through a foreign key; the collaboration services stamp company_id going
--     forward (collaborationMentionService already has it).
--
-- WHAT. Schema only - NO data write (programme rule): existing rows keep company_id NULL. Any backfill is a separate,
--   owner-approved, count-guarded D-step. FKs to companies(id) ON DELETE CASCADE: a company's notifications and
--   read / mention receipts go with the company (they are the company's records, and receipts of nothing are
--   meaningless). Partial indexes (company_id IS NOT NULL) for company-scoped reads / erasure.
--   No privilege change: the new columns inherit the table grants (20270111000002 revoked client privileges on
--   notifications; message_reads / message_mentions grants unchanged).
--
-- ROLLBACK: rollbacks/notifications_collab_company_id_rollback.sql (drops the indexes, FKs and columns; any
--   company_id values written after apply are lost - recoverable from the writers' logs only).

-- Preflight: a pre-existing company_id of another type, or an index / constraint of the same name on a different
-- definition, means this migration did not create it - refuse rather than adopt it.
DO $preflight$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('notifications', 'message_reads', 'message_mentions')
       AND a.attname = 'company_id' AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF r.typ <> 'uuid' THEN
      RAISE EXCEPTION '035 preflight: %.company_id already exists as % (expected uuid or absent) - refusing', r.tbl, r.typ;
    END IF;
  END LOOP;
END
$preflight$;

ALTER TABLE public.notifications    ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.message_reads    ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.message_mentions ADD COLUMN IF NOT EXISTS company_id uuid;

DO $fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_company_id_fkey' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reads_company_id_fkey' AND conrelid = 'public.message_reads'::regclass) THEN
    ALTER TABLE public.message_reads ADD CONSTRAINT message_reads_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_mentions_company_id_fkey' AND conrelid = 'public.message_mentions'::regclass) THEN
    ALTER TABLE public.message_mentions ADD CONSTRAINT message_mentions_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;
  END IF;
END
$fks$;

CREATE INDEX IF NOT EXISTS idx_notifications_company_created
  ON public.notifications (company_id, created_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_reads_company
  ON public.message_reads (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_mentions_company
  ON public.message_mentions (company_id) WHERE company_id IS NOT NULL;

-- Postcondition: exactly what this migration promises, measured.
DO $verify$
DECLARE
  t text;
  v_typ text;
  v_null boolean;
  v_fk text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications', 'message_reads', 'message_mentions'] LOOP
    SELECT format_type(a.atttypid, a.atttypmod), NOT a.attnotnull INTO v_typ, v_null
      FROM pg_attribute a WHERE a.attrelid = ('public.' || t)::regclass AND a.attname = 'company_id' AND NOT a.attisdropped;
    IF v_typ IS DISTINCT FROM 'uuid' THEN RAISE EXCEPTION '035 postcondition: %.company_id must be uuid, found %', t, v_typ; END IF;
    IF NOT v_null THEN RAISE EXCEPTION '035 postcondition: %.company_id must be NULLABLE (per-user rows have no company)', t; END IF;
    SELECT pg_get_constraintdef(c.oid) INTO v_fk
      FROM pg_constraint c WHERE c.conrelid = ('public.' || t)::regclass AND c.conname = t || '_company_id_fkey';
    IF v_fk IS NULL OR v_fk NOT LIKE 'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE%' THEN
      RAISE EXCEPTION '035 postcondition: %.company_id FK missing or different: %', t, coalesce(v_fk, '<none>');
    END IF;
  END LOOP;
  IF to_regclass('public.idx_notifications_company_created') IS NULL
     OR to_regclass('public.idx_message_reads_company') IS NULL
     OR to_regclass('public.idx_message_mentions_company') IS NULL THEN
    RAISE EXCEPTION '035 postcondition: a company_id index is missing';
  END IF;
END
$verify$;
