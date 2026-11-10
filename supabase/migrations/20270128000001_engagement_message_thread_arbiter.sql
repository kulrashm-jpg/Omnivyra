-- Engagement inbox (N-5) — the upsert arbiter for engagement_messages, in the migration chain.
--
-- WHY. The WhatsApp webhook processor, engagement/reply.ts and bulkEngagementService.ts all
-- write engagement_messages with ON CONFLICT (thread_id, platform_message_id). The unique index
-- that arbiter needs, idx_engagement_messages_platform_thread, existed only in
-- supabase/_schema/baseline.sql:38951 and database/engagement_unified_model.sql:81. A database
-- built from supabase/migrations alone had no arbiter, so every such write failed with 42P10
-- (no unique or exclusion constraint matching the ON CONFLICT specification).
--
-- RULE. Create it only when no equivalent exists: any valid, non-partial UNIQUE index on
-- exactly (thread_id, platform_message_id), whatever its name. Where the baseline already
-- built it (production), this is a no-op. NULL platform_message_id rows stay unconstrained,
-- exactly as under the baseline index.
--
-- NO grant, policy or RLS change. No rollback companion: dropping the arbiter would break
-- every engagement message write, so it is never rolled back.

DO $emta$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'engagement_messages'
       AND i.indisunique
       AND i.indisvalid
       AND i.indpred IS NULL
       AND i.indnkeyatts = 2
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum)
           = ARRAY['thread_id', 'platform_message_id']
  ) THEN
    RETURN;
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_messages_platform_thread
    ON public.engagement_messages (thread_id, platform_message_id);
END
$emta$;
