-- scheduled_posts.provider_asset_urns (version 20270217000020, reserved by virality-83 in 78ba018a4;
-- on fix/unread-error-send-main with the LinkedIn URN-cache move, e03e5b994).
--
-- WHY. The LinkedIn media uploader caches the asset URN it got for each source URL, so a retry reuses
-- it instead of uploading again. The cache lived INSIDE creator_attachment_metadata as an object
-- sub-key - but that column is canonically a JSONB ARRAY of creator attachments (owner ruling via
-- e9, 2026-11-12; attribution reads it as an array), and writing the cache spread the array into an
-- object, destroying the attachments. The cache gets its own column: { linkedin: { <url>: <urn> } }.
--
-- PRODUCTION FACT (C19, via 83, read-only, 2026-11-12): every creator_attachment_metadata is NULL
-- (32 rows), so nothing was destroyed and nothing is migrated: the cache simply starts empty here.
-- Nullable, no default, no backfill, no index (it is read and written by the row's id only).
-- GRANTS. A new COLUMN on an existing table inherits the table's privileges; nothing to grant.
-- Applying before or after the code is safe: the cache is best-effort (a missing column is a miss).

BEGIN;

-- ROLLBACK SOUNDNESS (05 / e1 rule, e9 2026-11-12): a lone column cannot be told from someone else's
-- by its shape, so this migration RECORDS that it created it - a column comment. An existing column
-- is accepted only with that mark (a re-apply); the rollback drops the column only while it stands.
DO $preflight$
BEGIN
  IF to_regclass('public.scheduled_posts') IS NULL THEN
    RAISE EXCEPTION 'SPAU preflight: public.scheduled_posts is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.scheduled_posts')
              AND attname = 'provider_asset_urns' AND NOT attisdropped)
     AND col_description(to_regclass('public.scheduled_posts'),
           (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.scheduled_posts') AND attname = 'provider_asset_urns' AND NOT attisdropped))
         IS DISTINCT FROM 'owned by migration 20270217000020 (LinkedIn URN cache); its rollback drops it only while this comment stands' THEN
    RAISE EXCEPTION 'SPAU preflight: scheduled_posts.provider_asset_urns already exists without this migration''s mark - it predates it; refusing (its rollback must never drop it)';
  END IF;
END
$preflight$;

ALTER TABLE public.scheduled_posts ADD COLUMN IF NOT EXISTS provider_asset_urns jsonb;
COMMENT ON COLUMN public.scheduled_posts.provider_asset_urns IS 'owned by migration 20270217000020 (LinkedIn URN cache); its rollback drops it only while this comment stands';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'provider_asset_urns'
       AND atttypid = 'jsonb'::regtype AND NOT attnotnull AND NOT attisdropped
       AND col_description(attrelid, attnum) = 'owned by migration 20270217000020 (LinkedIn URN cache); its rollback drops it only while this comment stands'
  ) THEN
    RAISE EXCEPTION 'SPAU postcondition: public.scheduled_posts.provider_asset_urns must exist as a nullable jsonb';
  END IF;
  RAISE NOTICE 'SPAU: scheduled_posts.provider_asset_urns is a nullable jsonb.';
END
$verify$;

COMMIT;
