-- WhatsApp broadcast recipients: the unique key expandRecipients has always relied on.
--
-- THE DEFECT. backend/services/whatsappBroadcastService.ts expandRecipients upserts with
-- onConflict 'broadcast_id,hashed_phone'. database/whatsapp_system.sql declares that key
-- as constraint `unique_broadcast_recipient`, but that file is outside the migration
-- chain, and neither the governed baseline nor any migration carries it. On such a schema
-- PostgreSQL refuses the upsert (42P10) and no recipient can be created. Found by running
-- the real service against the real schema; earlier tests used a fake database, which does
-- not enforce the arbiter.
--
-- THE SAME NAME AS THE ORIGINAL DDL, so a database that did run that file is a no-op here.
--
-- PRODUCTION STATE UNMEASURED: whether production has this constraint is not known from
-- the repository. The preflight refuses with a count rather than deleting anything. The
-- build takes a lock for its duration; on an unexpectedly large table, schedule it.
--
-- Rollback: supabase/migrations/rollbacks/whatsapp_broadcast_recipient_unique_rollback.sql

DO $$
DECLARE n bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.whatsapp_broadcast_recipients'::regclass
                AND conname = 'unique_broadcast_recipient') THEN
    RETURN;
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.whatsapp_broadcast_recipients
     GROUP BY broadcast_id, hashed_phone HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'whatsapp recipients preflight: % (broadcast, number) pairs hold duplicate rows; resolve them first', n;
  END IF;
  ALTER TABLE public.whatsapp_broadcast_recipients
    ADD CONSTRAINT unique_broadcast_recipient UNIQUE (broadcast_id, hashed_phone);
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'unique_broadcast_recipient' AND i.indisunique AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'whatsapp recipients postcondition: the unique key is missing or invalid';
  END IF;
END
$$;
