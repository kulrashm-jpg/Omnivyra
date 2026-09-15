/**
 * 3AH-91/92 — the ONE object-scope check for the `media-uploads` bucket: the
 * only objects an activity-workspace route may read or delete on behalf of an
 * authorized activity are the ones that belong to it. Both upload paths name
 * them that way:
 *   TUS client (creatorMediaUploadHandlers / ActivityWorkspacePrimaryBrief):
 *     `<activityId>/<subdir>/<session>.<ext>`
 *   upload-media-direct deriveObjectPath:
 *     `<companyId>/<activityId>/<subdir>/<stem>.<ext>`
 * Anything else — another activity's or another tenant's object, a traversal,
 * an encoded or control-character key — is refused and never touched.
 *
 * Every segment must match an ALLOWLIST (every key either client mints uses
 * only these characters). A denylist is not enough: '%2e%2e' passes a literal
 * '..' check and is resolved to '..' by the URL layer on the download fallback.
 *
 * `activityId` and `companyId` must be the server-authorized values, never
 * caller-supplied ones.
 */
const SAFE_OBJECT_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function isActivityObjectPath(objectPath: string, activityId: string, companyId: string): boolean {
  if (!objectPath || objectPath.length > 1024) return false;
  const segments = objectPath.split('/');
  if (!segments.every((s) => SAFE_OBJECT_SEGMENT.test(s))) return false;
  if (segments.some((s) => s === '.' || s === '..')) return false;
  const tusLayout = segments.length >= 3 && segments[0] === activityId;
  const directLayout = segments.length >= 4 && segments[0] === companyId && segments[1] === activityId;
  return tusLayout || directLayout;
}
