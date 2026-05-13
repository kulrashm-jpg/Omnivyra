/**
 * Pins the PDF storage graceful-degradation contract (Part 3):
 *   - The renderer's internal `classifyPdfStorageFailure` correctly buckets
 *     known failure modes (MIME-blocked, permission, transient, unknown).
 *   - The user-facing messages are non-empty and category-appropriate.
 *   - The `USER_MESSAGE_FOR_PDF_FALLBACK` map covers every category.
 *
 * The classifier is not exported as a public API, so we reach in via the
 * existing `__test` export — same pattern used by the dual-mode tests.
 */

jest.mock('sharp', () => ({}), { virtual: false });
jest.mock('pdfkit', () => ({}), { virtual: false });
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../../config', () => ({ config: {} }));

import { __test as renderer__test } from '../../services/creatorAssetRenderer';

describe('classifyPdfStorageFailure', () => {
  it('detects MIME-policy blocks', () => {
    expect(renderer__test.classifyPdfStorageFailure('mime type application/pdf is not in allowed_mime_types')).toBe('storage_mime_blocked');
    expect(renderer__test.classifyPdfStorageFailure('Mime type not allowed for this bucket')).toBe('storage_mime_blocked');
  });

  it('detects permission / RLS / unauthorized errors', () => {
    expect(renderer__test.classifyPdfStorageFailure('permission denied for bucket')).toBe('storage_permission');
    expect(renderer__test.classifyPdfStorageFailure('Forbidden: storage RLS policy rejected the write')).toBe('storage_permission');
    expect(renderer__test.classifyPdfStorageFailure('Unauthorized')).toBe('storage_permission');
  });

  it('detects transient unavailability (network/timeout/5xx)', () => {
    expect(renderer__test.classifyPdfStorageFailure('ETIMEDOUT')).toBe('storage_unavailable');
    expect(renderer__test.classifyPdfStorageFailure('network unreachable')).toBe('storage_unavailable');
    expect(renderer__test.classifyPdfStorageFailure('ECONNRESET while uploading')).toBe('storage_unavailable');
    expect(renderer__test.classifyPdfStorageFailure('503 service unavailable')).toBe('storage_unavailable');
  });

  it('falls back to unknown_storage_error for everything else', () => {
    expect(renderer__test.classifyPdfStorageFailure('weird thing happened')).toBe('unknown_storage_error');
    expect(renderer__test.classifyPdfStorageFailure('')).toBe('unknown_storage_error');
  });
});

describe('USER_MESSAGE_FOR_PDF_FALLBACK', () => {
  it('covers every category', () => {
    for (const key of ['storage_mime_blocked', 'storage_permission', 'storage_unavailable', 'unknown_storage_error'] as const) {
      const msg = renderer__test.USER_MESSAGE_FOR_PDF_FALLBACK[key];
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(20);
      // Every message must indicate preview availability — that's the
      // graceful-degradation contract.
      expect(msg.toLowerCase()).toContain('preview available');
    }
  });
});
