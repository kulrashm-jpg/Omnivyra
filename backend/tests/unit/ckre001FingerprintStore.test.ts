/**
 * CKRE-001 §4 — fingerprint persistence reuses report_settings (no new table),
 * merges siblings, and is idempotent + fail-safe.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

import { supabase } from '../../db/supabaseClient';
import { getLatestWebsiteFingerprint, saveWebsiteFingerprint } from '../../services/crawl/fingerprintStore';
import { computeWebsiteFingerprint } from '../../services/crawl/websiteFingerprintService';
import { rpcOver } from '../helpers/reportSettingsRpcFake';

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
    mockFrom.mockReset();
    const row = { report_settings: { discovered_metadata: { keep: true }, activation_latch: { cms: true } } as any };
    const rpc = rpcOver(() => row);
    (supabase as any).rpc = rpc;
    await saveWebsiteFingerprint('org1', FP);
    // Server-side key merge: ONE rpc carrying ONLY website_fingerprint; no client read, no whole-column update.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(Object.keys(rpc.mock.calls[0][1].p_patch as object)).toEqual(['website_fingerprint']);
    expect(mockFrom).not.toHaveBeenCalled();
    const written = row.report_settings;
    expect(written.discovered_metadata).toEqual({ keep: true }); // sibling preserved
    expect(written.activation_latch).toEqual({ cms: true });     // sibling preserved
    expect(written.website_fingerprint.url).toBe('https://acme.com');
  });

  test('report_settings unit 1: a save never sends sibling keys, so an unreadable column cannot be wiped', async () => {
    mockFrom.mockReset();
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }) }) }),
      update: jest.fn(),
    });
    const row = { report_settings: { discovered_metadata: { keep: true } } as any };
    (supabase as any).rpc = rpcOver(() => row);
    await saveWebsiteFingerprint('org1', FP);
    expect(row.report_settings.discovered_metadata).toEqual({ keep: true });
    expect(row.report_settings.website_fingerprint.url).toBe('https://acme.com');
  });

  test('never throws on read/write failure (fail-safe)', async () => {
    mockFrom.mockImplementation(() => { throw new Error('db down'); });
    (supabase as any).rpc = jest.fn(() => { throw new Error('db down'); });
    await expect(getLatestWebsiteFingerprint('org1')).resolves.toBeNull();
    await expect(saveWebsiteFingerprint('org1', FP)).resolves.toBeUndefined();
  });
});
