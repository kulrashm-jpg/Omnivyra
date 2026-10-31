-- MEDIA-H3 — least-privilege Storage policies for browser media uploads.
--
-- NOT APPLIED ANYWHERE REAL. Owner-gated: apply only with explicit release
-- authorization, against the verified target project, after a preview check
-- that a SIGNED resumable upload (x-signature) still succeeds (see
-- H3-UPLOAD-SECURITY-REMEDIATION.md). Rollback:
-- supabase/migrations/rollbacks/20270110000000_media_h3_storage_quarantine_policies_rollback.sql
--
-- Model
--   media-quarantine  PRIVATE. Browser bytes land here, at a server-minted key
--                     `<companyId>/<activityId>/<subdir>/<stem>.<ext>`, only via a
--                     server-issued signed upload token (upsert:false). No client
--                     role may read, write, overwrite or delete anything here.
--   media-uploads     PUBLIC delivery. Only the server (service_role) writes, and
--                     only objects it validated. No client role may insert,
--                     overwrite or delete; public read is the bucket's purpose.
--
-- The client-role denials are RESTRICTIVE policies: they AND with every
-- permissive policy, including any created in the dashboard (the repo does not
-- manage those; scripts/operator/sql/setup-storage-buckets.sql documents an
-- "authenticated may insert into media-*" example). service_role bypasses RLS.
-- Tenant isolation by path is therefore enforced as "no client access at all"
-- at the storage layer, plus the app's server-side scope check
-- (backend/services/activityWorkspace/activityObjectPath.ts).
--
-- Idempotent and safe on plain Postgres: the real-schema CI replays every
-- migration onto a baseline that has no `storage` schema, so every statement is
-- guarded by the presence of storage.objects / storage.buckets.

DO $media_h3$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'MEDIA-H3: storage schema not present; nothing to do';
    RETURN;
  END IF;

  -- Quarantine bucket: private, typed, capped (2 GiB, matching the app cap).
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'media-quarantine', 'media-quarantine', false, 2147483648,
    ARRAY['video/mp4','video/quicktime','video/webm','video/x-msvideo',
          'audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg',
          'image/png','image/jpeg','image/webp','image/gif']
  )
  ON CONFLICT (id) DO UPDATE
    SET public = false,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_update ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_delete ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS media_h3_deny_client_quarantine_select ON storage.objects';

  -- No client write (insert / upsert / overwrite / delete) to either bucket.
  EXECUTE $p$
    CREATE POLICY media_h3_deny_client_insert ON storage.objects
      AS RESTRICTIVE FOR INSERT TO anon, authenticated
      WITH CHECK (bucket_id NOT IN ('media-uploads', 'media-quarantine'))
  $p$;
  EXECUTE $p$
    CREATE POLICY media_h3_deny_client_update ON storage.objects
      AS RESTRICTIVE FOR UPDATE TO anon, authenticated
      USING (bucket_id NOT IN ('media-uploads', 'media-quarantine'))
      WITH CHECK (bucket_id NOT IN ('media-uploads', 'media-quarantine'))
  $p$;
  EXECUTE $p$
    CREATE POLICY media_h3_deny_client_delete ON storage.objects
      AS RESTRICTIVE FOR DELETE TO anon, authenticated
      USING (bucket_id NOT IN ('media-uploads', 'media-quarantine'))
  $p$;
  -- Quarantine is never readable by a client role (not even its uploader).
  EXECUTE $p$
    CREATE POLICY media_h3_deny_client_quarantine_select ON storage.objects
      AS RESTRICTIVE FOR SELECT TO anon, authenticated
      USING (bucket_id <> 'media-quarantine')
  $p$;
END
$media_h3$;
