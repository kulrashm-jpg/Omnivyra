-- Rollback of 20270217000035_notifications_collab_company_id.sql (6f).
-- Drops what 035 created: the three company_id indexes, FKs and columns. Any company_id values written after the
-- apply are LOST (recoverable from the writers' logs only). Writers that stamp company_id must be rolled back first,
-- or their inserts fail on the missing column (exactly the defect 035 repairs).

DROP INDEX IF EXISTS public.idx_notifications_company_created;
DROP INDEX IF EXISTS public.idx_message_reads_company;
DROP INDEX IF EXISTS public.idx_message_mentions_company;

ALTER TABLE public.notifications    DROP CONSTRAINT IF EXISTS notifications_company_id_fkey;
ALTER TABLE public.message_reads    DROP CONSTRAINT IF EXISTS message_reads_company_id_fkey;
ALTER TABLE public.message_mentions DROP CONSTRAINT IF EXISTS message_mentions_company_id_fkey;

ALTER TABLE public.notifications    DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.message_reads    DROP COLUMN IF EXISTS company_id;
ALTER TABLE public.message_mentions DROP COLUMN IF EXISTS company_id;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.notifications'::regclass, 'public.message_reads'::regclass, 'public.message_mentions'::regclass)
               AND a.attname = 'company_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '035 rollback postcondition: a company_id column remains';
  END IF;
END
$verify$;
