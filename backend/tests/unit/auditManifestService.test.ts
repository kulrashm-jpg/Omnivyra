jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { createHash } from 'crypto';
import { supabase } from '../../db/supabaseClient';
import { recordExportManifest, verifyExportContent } from '../../services/billing/exports/auditManifestService';

type AnyMock = jest.Mock;

describe('auditManifestService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records a manifest with the correct SHA-256 checksum', async () => {
    let captured: Record<string, unknown> | null = null;
    (supabase.from as AnyMock).mockReturnValue({
      insert: jest.fn().mockImplementation((row: Record<string, unknown>) => {
        captured = row;
        return Promise.resolve({ data: null, error: null });
      }),
    });

    const body = JSON.stringify([{ a: 1 }, { a: 2 }]);
    const result = await recordExportManifest({
      exportType:  'ledger',
      requestedBy: 'user-1',
      body,
      rowCount:    2,
      format:      'json',
    });

    expect(result.rowCount).toBe(2);
    expect(result.byteSize).toBe(Buffer.from(body, 'utf8').byteLength);

    const expected = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    expect(result.contentSha256).toBe(expected);
    expect((captured as Record<string, unknown>).content_sha256).toBe(expected);
  });

  it('verifyExportContent returns ok=true on matching body', async () => {
    const body = 'hello world';
    const sha = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { content_sha256: sha, row_count: 1, requested_at: '2024-01-01T00:00:00Z', export_type: 'ledger', byte_size: body.length },
            error: null,
          }),
        }),
      }),
    });
    const r = await verifyExportContent('m1', body);
    expect(r.ok).toBe(true);
  });

  it('verifyExportContent returns ok=false on mismatch', async () => {
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { content_sha256: 'WRONG', row_count: 1, requested_at: '2024-01-01T00:00:00Z', export_type: 'ledger', byte_size: 0 },
            error: null,
          }),
        }),
      }),
    });
    const r = await verifyExportContent('m1', 'hello world');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('CHECKSUM_MISMATCH');
  });

  it('verifyExportContent returns NOT_FOUND for missing manifest', async () => {
    (supabase.from as AnyMock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    });
    const r = await verifyExportContent('missing', 'whatever');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('MANIFEST_NOT_FOUND');
  });
});
