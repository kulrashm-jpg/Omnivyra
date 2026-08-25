/**
 * The production `media_files` storage locator.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two services read a stored file's location, and both were reading columns
 * that do not exist in production:
 *
 *   registerUploadedMediaAsset  →  storage_bucket, file_path, mime_type, …
 *   deleteMediaFile             →  file_path
 *
 * Production `media_files` carries none of them. Its columns are:
 *
 *   id, user_id, file_name, file_type, file_size_bytes, storage_url,
 *   thumbnail_url, dimensions, duration_seconds, metadata, created_at,
 *   original_name, tags, is_public, campaign_id
 *
 * `uploadMedia` writes the wider payload and `stripMissingColumnFromInsertPayload`
 * silently drops whatever the table lacks, so uploads returned 200 while
 * persisting rows without the canonical storage metadata. The mismatch was
 * therefore invisible until something actually READ those columns.
 *
 * `storage_url` IS authoritative. The repository has exactly ONE writer of it
 * (`mediaService.uploadMedia`), which always sets
 * `supabase.storage.from(bucket).getPublicUrl(objectPath)`. Every production row
 * inspected matches that shape. So bucket and path are recoverable from it
 * deterministically — which is why this module exists rather than a migration.
 *
 * PURE. No network, no database, no authorization, no URL construction. It only
 * takes apart a locator the server itself wrote, and it FAILS CLOSED: anything
 * that is not a recognised public object URL in a known bucket is rejected
 * rather than guessed at.
 */

/**
 * Buckets the platform stores media in.
 *
 * Mirrors `STORAGE_BUCKETS` in `operationsCenterService`, which is module-
 * private there. Duplicated deliberately rather than importing backend code
 * into `lib/` (wrong layering direction); a test asserts the two agree so they
 * cannot drift apart silently.
 */
export const MEDIA_STORAGE_BUCKETS = [
  'media-uploads',
  'media-images',
  'media-videos',
  'media-audios',
  'media-documents',
] as const;

export type MediaStorageBucket = (typeof MEDIA_STORAGE_BUCKETS)[number];

/**
 * Single shape, always populated — not a discriminated union.
 * `tsconfig` sets `"strict": false`, under which narrowing on a boolean
 * discriminant fails with TS2339; every prior attempt in this repo hit it.
 */
export interface MediaStorageLocator {
  ok: boolean;
  bucket: string;
  path: string;
  error: string;
}

const FAIL = (error: string): MediaStorageLocator => ({ ok: false, bucket: '', path: '', error });

/** `https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<objectPath>` */
const PUBLIC_OBJECT = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/([a-z0-9][a-z0-9-]*)\/(.+)$/i;

export function isMediaStorageBucket(value: unknown): value is MediaStorageBucket {
  return typeof value === 'string' && (MEDIA_STORAGE_BUCKETS as readonly string[]).includes(value);
}

/**
 * Recover `{ bucket, path }` from a `media_files.storage_url`.
 *
 * Rejects — never repairs — anything else: signed URLs (their path is a
 * different route and the token would rot), external hosts, unknown buckets,
 * and traversal. Returning a "best guess" bucket here would mean deleting or
 * reading somebody else's object, so every failure is explicit.
 */
export function parseMediaStorageLocator(storageUrl: unknown): MediaStorageLocator {
  if (typeof storageUrl !== 'string' || storageUrl.trim().length === 0) {
    return FAIL('storage_url is missing');
  }
  const raw = storageUrl.trim();

  // A signed URL is `/object/sign/...?token=…`. It names the same object, but
  // accepting it would mean parsing a credential-bearing URL — refuse instead.
  if (/\/storage\/v1\/object\/sign\//i.test(raw) || /[?&]token=/i.test(raw)) {
    return FAIL('signed storage URLs are not accepted');
  }

  // Query and fragment are presentation concerns (transforms, cache-busting)
  // and are never part of the object key.
  const withoutFragment = raw.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];

  const match = withoutQuery.match(PUBLIC_OBJECT);
  if (!match) {
    return FAIL(
      /^https?:\/\//i.test(withoutQuery)
        ? 'storage_url is not a Supabase public object URL'
        : 'storage_url is not an absolute URL',
    );
  }

  const bucket = match[1];
  if (!isMediaStorageBucket(bucket)) {
    return FAIL(`unknown storage bucket "${bucket}"`);
  }

  // `getPublicUrl` percent-encodes the key, so decode to recover the exact key
  // the storage API expects. A malformed escape is a rejection, not a fallback.
  let path: string;
  try {
    path = decodeURIComponent(match[2]);
  } catch {
    return FAIL('storage_url path is not valid percent-encoding');
  }

  path = path.replace(/^\/+/, '');
  if (path.length === 0) return FAIL('storage_url has no object path');
  // `..` cannot appear in a key this server wrote; if it does, something else
  // produced the URL and it must not be used to address an object.
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) {
    return FAIL('storage_url path contains traversal');
  }

  return { ok: true, bucket, path, error: '' };
}

/**
 * `media_files.dimensions` is the string `"<width>x<height>"`, or null.
 *
 * Absent or unparseable stays NULL. Canonical assets record what is known, and
 * a guessed dimension is worse than an absent one — it would be indistinguishable
 * from a measured value downstream.
 */
export function parseMediaDimensions(
  dimensions: unknown,
  metadata?: unknown,
): { width: number | null; height: number | null } {
  if (typeof dimensions === 'string') {
    const m = dimensions.trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (m) {
      const width = Number(m[1]);
      const height = Number(m[2]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { width, height };
      }
    }
  }
  // `metadata.{width,height}` is written by the same upload call, so it is a
  // legitimate second reading of the same fact — not an invented one.
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const meta = metadata as Record<string, unknown>;
    const width = typeof meta.width === 'number' ? meta.width : null;
    const height = typeof meta.height === 'number' ? meta.height : null;
    if (width !== null && height !== null && width > 0 && height > 0) {
      return { width, height };
    }
  }
  return { width: null, height: null };
}
