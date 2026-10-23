-- ENG-004 / G-04 — make `engagement_messages` explicitly tenant-owned.
--
-- THE GAP. `engagement_messages` has no tenant column. Its only tenancy is
-- transitive: `thread_id -> engagement_threads.organization_id`. Source comments
-- already acknowledge this ("engagement_messages carries NO tenant column — its
-- only tenancy is its thread", prospectEngagementIntelligence.ts:33), and an
-- inventory of the table's access surface found 85 call sites, of which only two
-- filter a tenant in their own chain. A lookup by `id` alone, or by
-- `parent_message_id` alone, can therefore return a row the caller's tenant does
-- not own. That is tolerable while every message id originates inside the
-- platform. It stops being tolerable the moment inbound email lands, because
-- `In-Reply-To` and `References` arrive from an external sender and would feed a
-- `parent_message_id` lookup directly.
--
-- ─── WHY A TRIGGER AND NOT 8 EDITED CALL SITES ──────────────────────────────
-- Eight write paths insert or upsert messages today, and none of them supplies a
-- tenant. Each HAS one available — they all hold a thread — so the column could be
-- filled by editing all eight. That was rejected for two reasons: a future ninth
-- writer can forget, and the invariant would then live in application discipline
-- rather than in the database. The trigger below makes
-- `message.organization_id = thread.organization_id` true by construction for
-- every writer, present and future.
--
-- It VALIDATES rather than merely fills, which matters:
--   • organization_id IS NULL      -> derived from the thread (existing writers
--                                    keep working unchanged)
--   • organization_id is WRONG     -> RAISES. An explicit mismatched tenant is a
--                                    caller bug or an attack, and silently
--                                    correcting it would hide both.
--
-- A trigger that only ever overwrote the value would make the composite foreign
-- key below unfalsifiable, and any cross-tenant-insert test would pass vacuously
-- — the trap recorded in PI-040 as "BEFORE triggers mask CHECKs". Raising on an
-- explicit mismatch is what keeps that test meaningful.
--
-- ─── WHY A COMPOSITE FOREIGN KEY AS WELL ────────────────────────────────────
-- The trigger enforces agreement at write time. The FK enforces it structurally,
-- including against a future trigger change, and it is what makes
--   message.organization_id = A  with  thread.organization_id = B
-- impossible rather than merely unwritten. It needs a unique constraint on the
-- referenced pair, which `engagement_threads` does not have — its primary key is
-- `(id)` alone. `UNIQUE (id, organization_id)` is added for that purpose and is
-- the smallest supporting constraint possible: `id` is already unique, so the
-- pair is trivially unique and the constraint adds no new restriction on data.
-- This is the only change to `engagement_threads`; it is not redesigned.
--
-- ─── WHAT THIS MIGRATION REFUSES TO DO ──────────────────────────────────────
-- `engagement_threads.organization_id` is NULLABLE. A message on a thread with no
-- tenant cannot be given a non-null tenant that satisfies the foreign key, so the
-- target invariant is unreachable for such rows. This migration DETECTS that
-- condition and ABORTS with exact counts. It does not invent a tenant, does not
-- delete the rows, and does not quietly leave the column nullable. The same
-- applies to messages whose thread no longer exists. Repairing either is a data
-- decision with an owner, not something a migration should do on its way past.
--
-- Nothing else changes: no message content, no platform value, no lifecycle, no
-- conversation table, no deletion, and no touching of Common Outreach, Workflow,
-- the Email Engine, feedback or suppression.
--
-- Re-runnable throughout: every object is created `IF NOT EXISTS` or dropped by
-- name first, and the backfill only writes rows whose tenant is still NULL.

BEGIN;

-- ── 1. The column, nullable for now ─────────────────────────────────────────

ALTER TABLE public.engagement_messages
  ADD COLUMN IF NOT EXISTS organization_id uuid;

COMMENT ON COLUMN public.engagement_messages.organization_id IS
  'ENG-004/G-04: explicit tenant owner. Always equal to the parent thread''s '
  'organization_id, enforced by engagement_messages_tenant_matches_thread (write '
  'time) and engagement_messages_thread_org_fkey (structurally). Never accepted '
  'from a request body, a provider payload or AI output — it is derived from the '
  'thread, which is the authoritative tenant context.';

-- ── 2. Backfill from the authoritative thread ───────────────────────────────

UPDATE public.engagement_messages AS m
   SET organization_id = t.organization_id
  FROM public.engagement_threads AS t
 WHERE m.thread_id = t.id
   AND m.organization_id IS NULL
   AND t.organization_id IS NOT NULL;

-- ── 3. Validate. Abort with counts rather than repair. ──────────────────────

DO $$
DECLARE
  orphan_count   bigint;
  null_org_count bigint;
  mismatch_count bigint;
  sample         text;
BEGIN
  -- Messages whose thread does not exist. The existing thread_id FK is
  -- ON DELETE CASCADE so this should be zero; it is checked because "should be"
  -- is not evidence.
  SELECT count(*) INTO orphan_count
    FROM public.engagement_messages m
   WHERE m.thread_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.engagement_threads t WHERE t.id = m.thread_id);

  -- Messages still without a tenant: either the thread has none, or thread_id is
  -- itself NULL.
  SELECT count(*) INTO null_org_count
    FROM public.engagement_messages m
   WHERE m.organization_id IS NULL;

  -- Rows that already disagreed with their thread before this migration ran.
  SELECT count(*) INTO mismatch_count
    FROM public.engagement_messages m
    JOIN public.engagement_threads t ON t.id = m.thread_id
   WHERE m.organization_id IS NOT NULL
     AND t.organization_id IS NOT NULL
     AND m.organization_id <> t.organization_id;

  IF orphan_count > 0 OR null_org_count > 0 OR mismatch_count > 0 THEN
    SELECT coalesce(string_agg(id::text, ', '), '(none)') INTO sample
      FROM (
        SELECT m.id FROM public.engagement_messages m
         WHERE m.organization_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM public.engagement_threads t WHERE t.id = m.thread_id)
         ORDER BY m.id
         LIMIT 20
      ) AS s;

    RAISE EXCEPTION
      'ENG-004 ABORTED — engagement_messages cannot be made tenant-safe as-is. '
      'orphaned_messages=%, messages_without_tenant=%, tenant_mismatches=%. '
      'First offending ids: %. '
      'These rows need an owner decision (assign a tenant to the parent thread, '
      'or archive the rows). This migration deliberately does not repair them.',
      orphan_count, null_org_count, mismatch_count, sample;
  END IF;

  RAISE NOTICE 'ENG-004 backfill validated: 0 orphans, 0 untenanted, 0 mismatches.';
END
$$;

-- ── 4. NOT NULL, only now that validation passed ────────────────────────────

ALTER TABLE public.engagement_messages
  ALTER COLUMN organization_id SET NOT NULL;

-- ── 5. The supporting unique constraint on the parent ───────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_threads_id_org_unique'
  ) THEN
    ALTER TABLE public.engagement_threads
      ADD CONSTRAINT engagement_threads_id_org_unique UNIQUE (id, organization_id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT engagement_threads_id_org_unique ON public.engagement_threads IS
  'ENG-004: exists solely so engagement_messages can carry a composite tenant FK. '
  'Adds no restriction — id is already the primary key, so (id, organization_id) '
  'is trivially unique.';

-- ── 6. The composite tenant foreign key ─────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_messages_thread_org_fkey'
  ) THEN
    ALTER TABLE public.engagement_messages
      ADD CONSTRAINT engagement_messages_thread_org_fkey
      FOREIGN KEY (thread_id, organization_id)
      REFERENCES public.engagement_threads (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

COMMENT ON CONSTRAINT engagement_messages_thread_org_fkey ON public.engagement_messages IS
  'ENG-004/G-04: makes a message whose tenant differs from its thread''s tenant '
  'structurally impossible, not merely unwritten. ON DELETE CASCADE matches the '
  'pre-existing engagement_messages_thread_id_fkey so thread deletion behaviour is '
  'unchanged.';

-- ── 6b. The parent edge, made tenant-safe structurally ──────────────────────
--
-- `engagement_messages_parent_message_id_fkey` references
-- `engagement_messages (id)` GLOBALLY. Nothing stops tenant B creating a message
-- whose `parent_message_id` points at a message of tenant A's — ids are UUIDs and
-- the FK carries no tenant. The composite thread FK above does not help: both
-- rows are internally consistent with their own threads.
--
-- That is the shape the inbound-email work would walk into. `In-Reply-To` and
-- `References` come from an external sender, so the parent pointer becomes
-- attacker-influenced, and an aggregation or a prompt that follows it would read
-- across the boundary. A tenant predicate on every parent query is necessary but
-- not sufficient, because it leaves the bad row writable.
--
-- So the parent edge gets the same treatment as the thread edge. `MATCH SIMPLE`
-- (the default) means a NULL `parent_message_id` skips the check entirely, so
-- root messages are unaffected.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_messages_id_org_unique'
  ) THEN
    ALTER TABLE public.engagement_messages
      ADD CONSTRAINT engagement_messages_id_org_unique UNIQUE (id, organization_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engagement_messages_parent_org_fkey'
  ) THEN
    ALTER TABLE public.engagement_messages
      ADD CONSTRAINT engagement_messages_parent_org_fkey
      FOREIGN KEY (parent_message_id, organization_id)
      REFERENCES public.engagement_messages (id, organization_id)
      -- The column list is NOT optional here. A bare `ON DELETE SET NULL` on a
      -- composite FK nulls EVERY referencing column, which would mean nulling
      -- `organization_id` — declared NOT NULL above — and the parent delete would
      -- fail instead of cascading. Naming the column confines the action to the
      -- pointer. Requires PostgreSQL 15+; this platform runs 17.
      ON DELETE SET NULL (parent_message_id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT engagement_messages_parent_org_fkey ON public.engagement_messages IS
  'ENG-004/G-04: a message may only name a parent in its OWN tenant. Required '
  'before inbound email, where parent pointers derive from attacker-supplied '
  'In-Reply-To/References headers. ON DELETE SET NULL matches the pre-existing '
  'engagement_messages_parent_message_id_fkey.';

-- ── 7. The write-time guard ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.engagement_messages_tenant_from_thread()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  thread_org uuid;
BEGIN
  SELECT t.organization_id INTO thread_org
    FROM public.engagement_threads t
   WHERE t.id = NEW.thread_id;

  IF thread_org IS NULL THEN
    -- Either the thread is gone, or it has no tenant. Both mean this message
    -- cannot be attributed, and an unattributable message must not exist.
    RAISE EXCEPTION
      'engagement_messages.organization_id cannot be derived: thread % has no tenant',
      NEW.thread_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.organization_id IS NULL THEN
    -- Derived, not accepted. The thread is the authoritative tenant context.
    NEW.organization_id := thread_org;
  ELSIF NEW.organization_id <> thread_org THEN
    -- Raised rather than corrected, on purpose: a caller asserting the wrong
    -- tenant is a bug or an attack, and silently fixing it would conceal both —
    -- and would make the composite FK unfalsifiable.
    RAISE EXCEPTION
      'engagement_messages.organization_id % does not match thread % tenant %',
      NEW.organization_id, NEW.thread_id, thread_org
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.engagement_messages_tenant_from_thread() IS
  'ENG-004/G-04: derives engagement_messages.organization_id from the parent '
  'thread when absent, and RAISES when a caller supplies a different one. The '
  'raise is what keeps engagement_messages_thread_org_fkey falsifiable.';

DROP TRIGGER IF EXISTS engagement_messages_tenant_matches_thread ON public.engagement_messages;

CREATE TRIGGER engagement_messages_tenant_matches_thread
  BEFORE INSERT OR UPDATE OF thread_id, organization_id
  ON public.engagement_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.engagement_messages_tenant_from_thread();

-- ── 8. Index for the new tenant predicates ──────────────────────────────────
--
-- Every hardened lookup now carries `organization_id`, most of them alongside
-- `id`, `parent_message_id` or `(platform, platform_message_id)`. One composite
-- index on (organization_id, id) serves the direct-id path; the single-column
-- tenant index serves the scans.

CREATE INDEX IF NOT EXISTS idx_engagement_messages_org
  ON public.engagement_messages (organization_id);

CREATE INDEX IF NOT EXISTS idx_engagement_messages_org_parent
  ON public.engagement_messages (organization_id, parent_message_id)
  WHERE parent_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_messages_org_platform_message
  ON public.engagement_messages (organization_id, platform, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

COMMIT;
