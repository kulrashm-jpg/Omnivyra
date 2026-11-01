# MEDIA-H3: browser media upload quarantine (runbook)

Browser (resumable/TUS) uploads never write to the public `media-uploads` bucket.

1. `POST /api/activity-workspace/[id]/upload-media-authorize` mints a key
   `<companyId>/<activityId>/<subdir>/<stem>.<ext>` and a signed upload token
   (`upsert:false`) for that key in the private `media-quarantine` bucket. The
   key's `<subdir>/<ext>` fixes the authorized content type.
2. The browser uploads to that key with `x-signature`.
3. `POST .../upload-media-finalize` re-authorizes, requires the declared type to
   equal the key's authorized type, validates the stored size, stored content
   type and bytes (images are re-encoded), and only then moves the object to
   `media-uploads`. A non-image object that already sits at the delivery key is
   never adopted on its own evidence; it is accepted only when a committed row
   records that key as promoted.

Code: `backend/services/activityWorkspace/quarantinedMediaUpload.ts`,
`pages/api/activity-workspace/[id]/upload-media-{authorize,finalize}.ts`.

## Migration `20270111000000_media_h3_storage_quarantine_policies.sql`

- Owner-gated. Apply WITH or BEFORE the H-3 application code, against the
  verified target project.
- Before apply, check on a preview/staging project that a signed resumable
  upload (`/storage/v1/upload/resumable/sign` with `x-signature`) still succeeds.
- Until it is applied, any permissive dashboard policy on `storage.objects`
  still lets clients write `media-uploads` directly.

## Rollback `rollbacks/media_h3_storage_quarantine_policies_rollback.sql`

**Never run it while the H-3 application code is live.** It re-opens direct
client writes to the public `media-uploads` bucket wherever a permissive
dashboard policy exists (the original H-3 exposure), with no visible app
failure. Run it only together with a rollback of the application to pre-H3
code, and only with explicit owner authorization.

## Known residuals

- Video and audio are validated by their first 32 bytes only (no transcode or
  container parse).
- Nothing cleans `media-quarantine`. Objects refused by caller-controlled
  finalize exits are intentionally kept (private) rather than deleted.
