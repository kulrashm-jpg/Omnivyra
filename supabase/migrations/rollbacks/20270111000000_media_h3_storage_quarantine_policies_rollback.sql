-- ROLLBACK for 20270111000000_media_h3_storage_quarantine_policies.sql
--
-- Removes the five MEDIA-H3 restrictive policies. It does NOT delete the
-- `media-quarantine` bucket or its objects (they may hold uploads awaiting
-- finalize; deleting a bucket with objects fails anyway). Rolling back the
-- policies while the H-3 application code is deployed is safe for the app (it
-- uses service_role), but re-opens whatever permissive client policies exist
-- in the dashboard. Rolling back the APPLICATION to pre-H3 code requires
-- nothing here: the old code writes to media-uploads with the publishable key,
-- which these policies deny — so roll back the policies FIRST if the app is
-- rolled back, or uploads will fail.
DO $media_h3_rb$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'MEDIA-H3 rollback: storage schema not present; nothing to do';
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_delete ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_quarantine_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_delivery_select ON storage.objects';
END
$media_h3_rb$;
