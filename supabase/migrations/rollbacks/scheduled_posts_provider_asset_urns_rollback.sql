-- Rollback of 20270217000020_scheduled_posts_provider_asset_urns.sql.
-- Drops the LinkedIn URN cache column. Loses only cached URNs (a cache: the next publish uploads
-- the media again). The code treats a missing column as a cache miss, so it keeps working.
BEGIN;
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
