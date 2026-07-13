/**
 * CKRE-001 §4 — fingerprint persistence reuses report_settings (no new table),
 * merges siblings, and is idempotent + fail-safe.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import { supabase } from '../../db/supabaseClient';
import { getLatestWebsiteFingerprint, saveWebsiteFingerprint } from '../../services/crawl/fingerprintStore';
import { computeWebsiteFingerprint } from '../../services/crawl/websiteFingerprintService';

const mockFrom = (supabase as any).from as jest.Mock;

const FP = computeWebsiteFingerprint({ url: 'https://acme.com', html: '<html><h1>Acme</h1></html>', metadata: null }, 't');

describe('CKRE-001 §4 — fingerprint store', () => {
  test('reads the latest fingerprint from report_settings.website_fingerprint', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: { report_settings: { website_fingerprint: FP } } }),
        }),
      }),
    });
    const got = await getLatestWebsiteFingerprint('org1');
    expect(got?.url).toBe('https://acme.com');
    expect(got?.version).toBe(FP.version);
  });

  test('returns null when no profile / no fingerprint', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) }),
    });
    expect(await getLatestWebsiteFingerprint('org1')).toBeNull();
  });

  test('save merges into existing report_settings without clobbering siblings', async () => {
    const updateMock = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: { report_settings: { discovered_metadata: { keep: true }, activation_latch: { cms: true } } } }),
        }),
      }),
      update: updateMock,
    });
    await saveWebsiteFingerprint('org1', FP);
    const written = updateMock.mock.calls[0][0].report_settings;
    expect(written.discovered_metadata).toEqual({ keep: true }); // sibling preserved
    expect(written.activation_latch).toEqual({ cms: true });     // sibling preserved
    expect(written.website_fingerprint.url).toBe('https://acme.com');
  });

  test('never throws on read/write failure (fail-safe)', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    await expect(getLatestWebsiteFingerprint('org1')).resolves.toBeNull();
    await expect(saveWebsiteFingerprint('org1', FP)).resolves.toBeUndefined();
  });
});
