-- Rollback of 20270217000020_scheduled_posts_provider_asset_urns.sql.
-- Drops the LinkedIn URN cache column. Loses only cached URNs (a cache: the next publish uploads
-- the media again). The code treats a missing column as a cache miss, so it keeps working.
-- SOUND TO DROP: only while the column carries the mark the apply records ('owned by migration 20270217000020 (Linke...'); a
-- column of this name WITHOUT the mark predates the migration and is refused, never dropped.
BEGIN;
DO $owned$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'provider_asset_urns' AND NOT attisdropped)
     AND col_description('public.scheduled_posts'::regclass,
           (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'provider_asset_urns' AND NOT attisdropped))
         IS DISTINCT FROM 'owned by migration 20270217000020 (LinkedIn URN cache); its rollback drops it only while this comment stands' THEN
    RAISE EXCEPTION 'SPAU rollback: scheduled_posts.provider_asset_urns does not carry this migration''s mark - it is not ours to drop';
  END IF;
END
$owned$;
ALTER TABLE public.scheduled_posts DROP COLUMN IF EXISTS provider_asset_urns;
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.scheduled_posts'::regclass AND attname = 'provider_asset_urns' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'SPAU rollback postcondition: public.scheduled_posts.provider_asset_urns must not exist';
  END IF;
END
$verify$;
COMMIT;
