-- ROLLBACK for 20270111000000_media_h3_storage_quarantine_policies.sql
--
-- DO NOT RUN WHILE THE H-3 APPLICATION CODE IS LIVE. OWNER-GATED.
-- Rolling these policies back while H-3 code is deployed RE-OPENS DIRECT
-- CLIENT (anon / authenticated, publishable-key) WRITES TO THE PUBLIC
-- `media-uploads` BUCKET wherever a permissive dashboard policy exists - the
-- original H-3 exposure - and re-enables the planted-object and overwrite
-- residuals (F-H3-1, J3-3) and client reads of `media-quarantine`. The app
-- itself keeps working (it uses service_role), which is exactly why the
-- re-opened exposure is silent. Run it ONLY together with a rollback of the
-- application to pre-H3 code, with explicit owner authorization.
-- Runbook: docs/MEDIA-H3-UPLOAD-QUARANTINE.md.
--
-- Removes the five MEDIA-H3 restrictive policies. It does NOT delete the
-- `media-quarantine` bucket or its objects (they may hold uploads awaiting
-- finalize; deleting a bucket with objects fails anyway). Rolling back the
-- APPLICATION to pre-H3 code requires this rollback: the old code writes to
-- media-uploads with the publishable key, which these policies deny - so roll
-- back the policies together with (immediately before) the application
-- rollback, or uploads will fail.
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
