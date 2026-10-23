-- ENG-004-CLOSE / G-23 — make platform message identity TENANT-SCOPED.
--
-- THE DEFECT. `idx_engagement_messages_platform_message_global` is
--   UNIQUE (platform, platform_message_id) WHERE platform_message_id IS NOT NULL
-- created by 20260604_engagement_sync_integrity.sql with no stated rationale,
-- alongside a batch of scraped-sync columns. Read as a single-tenant statement it
-- is sensible: "a platform message appears once". Read multi-tenant it is wrong,
-- and not merely in theory:
--
--   Two Omnivyra tenants can legitimately monitor the SAME public LinkedIn post.
--   Both scrape the same comment. The first ingests it; the second's insert fails
--   with 23505 on an index it cannot see and does not own.
--
-- So the current index is a cross-tenant coupling with three consequences: one
-- tenant's data silently denies another's ingestion, the error discloses that a
-- row exists somewhere, and global uniqueness gets mistaken for a tenant-isolation
-- mechanism. ENG-002 §10 states the rule this breaks — never treat a provider or
-- platform message id as globally unique across tenants.
--
-- WHY THIS IS SAFE ON EXISTING DATA, BY CONSTRUCTION. The replacement key is a
-- SUPERSET of the old one: any pair that was unique across all tenants is
-- necessarily unique within one. Widening a unique key cannot fail on data that
-- satisfied the narrower one, so there is no possible duplicate to discover, no
-- backfill, and no abort path needed. (The converse — narrowing — is what requires
-- a data audit, and is not what this does.)
--
-- WHY NO WRITE PATH CHANGES. Every upsert in the codebase conflicts on the
-- THREAD-scoped index, not this one:
--   whatsappWebhookProcessor.ts:148   onConflict: 'thread_id,platform_message_id'
--   bulkEngagementService.ts:306      onConflict: 'thread_id,platform_message_id'
--   engagementNormalizationService.ts:423  onConflict: 'thread_id,platform_message_id'
--   engagementOutboundMirrorService.ts:174 onConflict: 'thread_id,platform_message_id'
--   engagement/reply.ts:913           onConflict: 'thread_id,platform_message_id'
-- Nothing names the global index, so dropping it changes no deduplication
-- behaviour. `idx_engagement_messages_platform_thread`
-- (UNIQUE (thread_id, platform_message_id)) is untouched and remains the key those
-- upserts rely on.
--
-- WHY THE LOOKUP STAYS FAST. The old index also served `(platform,
-- platform_message_id)` reads. After ENG-004/ENG-004-CLOSE every such read carries
-- `organization_id` first, so the new index is a BETTER match for the queries that
-- actually run, and the pre-existing single-column
-- `idx_engagement_messages_platform_message_id` still covers anything else.
--
-- ORDER MATTERS. The new constraint is created BEFORE the old index is dropped, so
-- there is no window in which neither protects the table.
--
-- Depends on `organization_id` existing, which 20261221000000 adds. Re-runnable.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'engagement_messages'
      AND column_name = 'organization_id'
  ) THEN
    RAISE EXCEPTION
      'ENG-004-CLOSE requires engagement_messages.organization_id; apply 20261221000000 first';
  END IF;
END
$$;

-- New, tenant-scoped identity. Created first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_messages_org_platform_message_unique
  ON public.engagement_messages (organization_id, platform, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

COMMENT ON INDEX public.idx_engagement_messages_org_platform_message_unique IS
  'ENG-004-CLOSE/G-23: platform message identity is TENANT-SCOPED. Replaces the '
  'cross-tenant UNIQUE (platform, platform_message_id), under which two tenants '
  'monitoring the same public post could not both ingest the same comment. Global '
  'uniqueness is not a tenant-isolation mechanism.';

-- Only now remove the cross-tenant one.
DROP INDEX IF EXISTS public.idx_engagement_messages_platform_message_global;

-- ENG-004-CLOSE adds one more non-unique index: the partial
-- (organization_id, platform, platform_message_id) index created by
-- 20261221000000 is now redundant with the UNIQUE one above, which can serve the
-- same lookups. Dropped to avoid carrying two indexes over identical columns.
DROP INDEX IF EXISTS public.idx_engagement_messages_org_platform_message;

COMMIT;
