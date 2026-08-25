/**
 * The production `media_files` storage contract.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Phase 65's live test failed with, verbatim from production:
 *
 *   "Failed to read uploaded file: column media_files.storage_bucket does not exist"
 *
 * `registerUploadedMediaAsset` selected storage_bucket, file_path, mime_type,
 * file_size, width, height and file_url. Production `media_files` has NONE of
 * them. `deleteMediaFile` read `file_path` and threw
 * "Cannot read properties of undefined (reading 'split')" for the same reason,
 * so no media file could be deleted at all.
 *
 * The mismatch stayed invisible because `uploadMedia` writes the wide payload
 * through `stripMissingColumnFromInsertPayload`, which drops whatever the table
 * lacks and retries — uploads returned 200 while persisting rows without the
 * canonical metadata. Unit tests could not have caught it either: they stub the
 * database with the INTENDED schema, so they encoded the assumption.
 *
 * These tests therefore pin the REAL production column set, taken from a live
 * read, and prove the parser fails closed rather than guessing at a location.
 */

import {
  MEDIA_STORAGE_BUCKETS,
  isMediaStorageBucket,
  parseMediaStorageLocator,
  parseMediaDimensions,
} from '../../../lib/content/mediaStorageLocator';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const REGISTER = strip(read('../../services/creator/creatorCompositionAssetService.ts'));
const MEDIA = strip(read('../../services/mediaService.ts'));
const LOCATOR_RAW = read('../../../lib/content/mediaStorageLocator.ts');
const LOCATOR = strip(LOCATOR_RAW);
const MEDIA_RAW = read('../../services/mediaService.ts');

/** The column set read live from production on 2026-08-25. */
const PRODUCTION_COLUMNS = [
  'id', 'user_id', 'file_name', 'file_type', 'file_size_bytes', 'storage_url',
  'thumbnail_url', 'dimensions', 'duration_seconds', 'metadata', 'created_at',
  'original_name', 'tags', 'is_public', 'campaign_id',
];
/** Columns the services USED to read. None exist in production. */
const PHANTOM_COLUMNS = [
  'storage_bucket', 'file_path', 'mime_type', 'file_size', 'width', 'height', 'file_url',
];

const URL_OK = 'https://klkiseupptzbecbxwrky.supabase.co/storage/v1/object/public/media-images/user-1/1787628526945-anyvaj.png';

describe('A — the parser recovers bucket and path', () => {
  it('parses a real production storage_url', () => {
    const r = parseMediaStorageLocator(URL_OK);
    expect(r.ok).toBe(true);
    expect(r.bucket).toBe('media-images');
    expect(r.path).toBe('user-1/1787628526945-anyvaj.png');
  });

  it('the path excludes the bucket — that is what the storage API takes', () => {
    expect(parseMediaStorageLocator(URL_OK).path.startsWith('media-images')).toBe(false);
  });

  it.each(MEDIA_STORAGE_BUCKETS)('accepts the known bucket %s', (bucket) => {
    const r = parseMediaStorageLocator(
      `https://ref.supabase.co/storage/v1/object/public/${bucket}/u/f.png`);
    expect(r.ok).toBe(true);
    expect(r.bucket).toBe(bucket);
  });

  it('strips a query string — transforms are not part of the object key', () => {
    const r = parseMediaStorageLocator(`${URL_OK}?width=200&quality=80`);
    expect(r.ok).toBe(true);
    expect(r.path).toBe('user-1/1787628526945-anyvaj.png');
  });

  it('strips a fragment', () => {
    expect(parseMediaStorageLocator(`${URL_OK}#anchor`).path)
      .toBe('user-1/1787628526945-anyvaj.png');
  });

  it('decodes percent-encoding, because getPublicUrl encodes the key', () => {
    const r = parseMediaStorageLocator(
      'https://ref.supabase.co/storage/v1/object/public/media-images/u/my%20file%20(1).png');
    expect(r.ok).toBe(true);
    expect(r.path).toBe('u/my file (1).png');
  });

  it('handles nested key segments', () => {
    expect(parseMediaStorageLocator(
      'https://ref.supabase.co/storage/v1/object/public/media-images/a/b/c/d.png').path)
      .toBe('a/b/c/d.png');
  });
});

describe('B — it fails CLOSED, never guessing a location', () => {
  const rejected: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['a number', 12345],
    ['an object', { bucket: 'media-images' }],
    ['a bare path', 'media-images/u/f.png'],
    ['a relative URL', '/storage/v1/object/public/media-images/u/f.png'],
    ['http (not https)', 'http://ref.supabase.co/storage/v1/object/public/media-images/u/f.png'],
    ['an external host', 'https://evil.example.com/storage/v1/object/public/media-images/u/f.png'],
    ['an unknown bucket', 'https://ref.supabase.co/storage/v1/object/public/secrets/u/f.png'],
    ['a signed URL', 'https://ref.supabase.co/storage/v1/object/sign/media-images/u/f.png?token=abc'],
    ['a token query', 'https://ref.supabase.co/storage/v1/object/public/media-images/u/f.png?token=abc'],
    ['no object path', 'https://ref.supabase.co/storage/v1/object/public/media-images/'],
    ['path traversal', 'https://ref.supabase.co/storage/v1/object/public/media-images/../other/f.png'],
    ['malformed escape', 'https://ref.supabase.co/storage/v1/object/public/media-images/u/%ZZ.png'],
  ];

  it.each(rejected)('CRITICAL: rejects %s', (_label, value) => {
    const r = parseMediaStorageLocator(value);
    expect(r.ok).toBe(false);
    expect(r.bucket).toBe('');
    expect(r.path).toBe('');
    expect(r.error.length).toBeGreaterThan(0);
  });

  it('CRITICAL: a rejection never yields a usable bucket to fall back on', () => {
    for (const [, v] of rejected) {
      const r = parseMediaStorageLocator(v);
      expect(isMediaStorageBucket(r.bucket)).toBe(false);
    }
  });

  it('M1/M4 GUARD: the parser matches only the public-object route in a known bucket', () => {
    expect(LOCATOR_RAW).toMatch(/storage\/v1\/object\/public/);
    expect(LOCATOR).toContain('isMediaStorageBucket(bucket)');
    // No default/fallback bucket anywhere.
    expect(LOCATOR).not.toMatch(/\|\|\s*'media-images'|\?\?\s*'media-images'/);
  });

  it('M3 GUARD: decoding is explicit and a bad escape is a rejection', () => {
    expect(LOCATOR).toContain('decodeURIComponent(match[2])');
    expect(LOCATOR).toContain('not valid percent-encoding');
  });
});

describe('C — the bucket allow-list does not drift from the app', () => {
  it('matches operationsCenterService.STORAGE_BUCKETS exactly', () => {
    // Duplicated deliberately (lib must not import backend); this stops the two
    // copies diverging without anyone noticing.
    const ops = read('../../services/operationsCenterService.ts');
    const line = (ops.match(/const STORAGE_BUCKETS = \[[^\]]*\]/) || [])[0] || '';
    const listed = Array.from(line.matchAll(/'([a-z-]+)'/g)).map((m) => m[1]);
    expect(listed.sort()).toEqual([...MEDIA_STORAGE_BUCKETS].sort());
  });

  it('covers every bucket uploadMedia can write to', () => {
    // bucketName = `media-${mediaType}s`, mediaType ∈ image|video|audio|document
    for (const t of ['image', 'video', 'audio', 'document']) {
      expect(MEDIA_STORAGE_BUCKETS).toContain(`media-${t}s`);
    }
  });
});

describe('D — dimensions map without inventing values', () => {
  it('parses the "WxH" string production actually stores', () => {
    expect(parseMediaDimensions('512x512')).toEqual({ width: 512, height: 512 });
    expect(parseMediaDimensions('898x278')).toEqual({ width: 898, height: 278 });
  });

  it('falls back to metadata written by the same upload call', () => {
    expect(parseMediaDimensions(null, { width: 893, height: 893 }))
      .toEqual({ width: 893, height: 893 });
  });

  it('CRITICAL: unknown dimensions stay NULL rather than being guessed', () => {
    for (const bad of [null, undefined, '', 'unknown', '512', 'x512', '512x', '0x0', '-1x5', {}]) {
      expect(parseMediaDimensions(bad as never)).toEqual({ width: null, height: null });
    }
  });

  it('prefers the explicit dimensions column over metadata', () => {
    expect(parseMediaDimensions('100x200', { width: 999, height: 999 }))
      .toEqual({ width: 100, height: 200 });
  });
});

describe('E — canonical registration reads the REAL contract', () => {
  it('CRITICAL MUTATION GUARD: it selects only columns production has', () => {
    const select = (REGISTER.match(/\.select\('id, user_id[^']*'\)/) || [])[0] || '';
    expect(select).toContain('storage_url');
    expect(select).toContain('file_type');
    expect(select).toContain('file_size_bytes');
    expect(select).toContain('dimensions');
    const cols = (select.match(/'([^']*)'/) || ['',''])[1].split(',').map((c) => c.trim());
    for (const phantom of PHANTOM_COLUMNS) {
      expect(cols).not.toContain(phantom);
    }
  });

  it('CRITICAL: every selected column exists in production', () => {
    const select = (REGISTER.match(/\.select\('([^']*)'\)/) || [])[1] || '';
    for (const col of select.split(',').map((c) => c.trim()).filter(Boolean)) {
      expect(PRODUCTION_COLUMNS).toContain(col);
    }
  });

  it('the location goes through the shared parser and fails closed', () => {
    expect(REGISTER).toContain('parseMediaStorageLocator(row.storage_url)');
    expect(REGISTER).toContain('if (!locator.ok)');
    expect(REGISTER).toContain('has no usable storage location');
  });

  it('CRITICAL: no URL is constructed or fetched to locate the object', () => {
    for (const forbidden of ['getPublicUrl', 'createSignedUrl', 'fetch(', 'axios', 'https://']) {
      expect(REGISTER).not.toContain(forbidden);
    }
  });

  it('M5 GUARD: bucket and path are never taken from the caller', () => {
    expect(REGISTER).not.toMatch(/input\.(storageBucket|storagePath|bucket|path)/);
    expect(REGISTER).toContain('const bucket = locator.bucket;');
    expect(REGISTER).toContain('const storagePath = locator.path;');
  });

  it('tenant scoping and lifecycle semantics are unchanged', () => {
    expect(REGISTER).toContain("String(row.user_id || '') !== userId");
    expect(REGISTER).toContain('Uploaded file not found for this user');
    expect(REGISTER).toContain("setCanonicalMediaAssetLifecycle(companyId, created.id, 'ready')");
  });

  it('there is only ONE storage-locator parser — the old one is gone', () => {
    expect(REGISTER).not.toContain('storageKeyFromMediaPath');
    expect(MEDIA).not.toContain('storageKeyFromMediaPath');
  });
});

describe('F — media deletion reads the REAL contract', () => {
  it('CRITICAL MUTATION GUARD: it no longer reads file_path or storage_bucket', () => {
    const body = MEDIA.slice(MEDIA.indexOf('export async function deleteMediaFile'));
    expect(body).not.toContain('file_path');
    expect(body).not.toContain('mediaFile.storage_bucket');
  });

  it('CRITICAL: it derives the location from storage_url via the shared parser', () => {
    const body = MEDIA.slice(MEDIA.indexOf('export async function deleteMediaFile'));
    expect(body).toContain('parseMediaStorageLocator(mediaFile.storage_url)');
    expect(body).toContain('.from(locator.bucket)');
    expect(body).toContain('.remove([locator.path])');
  });

  it('CRITICAL: an unparseable locator deletes NO object — never a guessed one', () => {
    const body = MEDIA.slice(MEDIA.indexOf('export async function deleteMediaFile'));
    expect(body).toContain('if (!locator.ok)');
    expect(body).toContain('Skipping storage delete');
    // The remove call is inside the else branch, not reachable on failure.
    expect(body.indexOf('Skipping storage delete')).toBeLessThan(body.indexOf('.remove([locator.path])'));
  });

  it('the row is still deleted, and storage failure remains non-fatal', () => {
    const body = MEDIA.slice(MEDIA.indexOf('export async function deleteMediaFile'));
    expect(body).toContain("ownedDbTable('media_files')");
    expect(body).toContain('.delete()');
    expect(MEDIA_RAW).toContain('Continue to delete DB record even if storage deletion fails');
  });

  it('deletion still refuses an unknown media id', () => {
    const body = MEDIA.slice(MEDIA.indexOf('export async function deleteMediaFile'));
    expect(body).toContain("throw new Error('Media file not found')");
  });
});

describe('G — the parser stays pure', () => {
  it('no network, database, or authorization', () => {
    for (const forbidden of ['fetch(', 'supabase.storage', 'supabase.from', 'ownedDbTable', 'process.env', 'require(']) {
      expect(LOCATOR).not.toContain(forbidden);
    }
    expect(LOCATOR).not.toMatch(/^import .*(supabaseClient|writeOwner)/m);
  });

  it('it never produces a browser-facing URL', () => {
    expect(LOCATOR).not.toContain('getPublicUrl');
    expect(LOCATOR).not.toContain('createSignedUrl');
  });

  it('the result is a single always-populated shape (strict:false safe)', () => {
    const r = parseMediaStorageLocator('nonsense');
    expect(Object.keys(r).sort()).toEqual(['bucket', 'error', 'ok', 'path']);
  });
});

describe('H — nothing else moved', () => {
  it('the upload writer is unchanged — masking is analysed, not silently altered', () => {
    expect(MEDIA).toContain('stripMissingColumnFromInsertPayload');
    expect(MEDIA).toContain('storage_url: fileUrl');
  });

  it('canonical asset tables and Phase 63/64 behaviour are untouched', () => {
    expect(REGISTER).toContain('const mode = input.mode ?? defaultModeForPurpose(input.purpose);');
    const canonical = strip(read('../../services/canonicalMediaAssetService.ts'));
    expect(canonical).toContain('export async function deleteCanonicalMediaAsset');
  });
});
