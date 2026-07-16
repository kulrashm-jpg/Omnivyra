/**
 * Wave R3 / E3 — canonical grounding cache integration (adapter-only).
 * Verifies the F-12 cache wraps ONLY the deterministic context: request-level
 * dedup (single assembly per request), tenant isolation, kill switch → uncached,
 * fail-open, and that OFF mode never touches the cache.
 */
jest.mock('../../services/companyProfileServiceRest1Rest2Pulse', () => ({
  getProfile: jest.fn(),
}));
jest.mock('../../services/context/contextAssimilationEngine', () => ({
  getCanonicalContext: jest.fn(),
}));
jest.mock('../../services/context/canonicalProfileOverlay', () => ({
  overlayCanonicalOntoProfile: jest.fn(),
}));
jest.mock('../../services/context/canonicalAdoptionMetrics', () => ({
  recordCanonicalRead: jest.fn(),
}));

import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { getProfile } from '../../services/companyProfileServiceRest1Rest2Pulse';
import { getCanonicalContext } from '../../services/context/contextAssimilationEngine';
import { overlayCanonicalOntoProfile } from '../../services/context/canonicalProfileOverlay';
import { runWithRequestExecutionContext } from '../../../lib/platform/requestContext';

const mGetProfile = getProfile as jest.Mock;
const mGetCtx = getCanonicalContext as jest.Mock;
const mOverlay = overlayCanonicalOntoProfile as jest.Mock;

const ENV = ['ROLLOUT_CANONICAL_GROUNDING_MODE', 'CACHE_KILL_OMNIVYRA_CANONICAL_CTX', 'CACHE_KILL_ALL'];

// Unique tenant id per test → each test starts with a COLD cache key
// (the real F-12 cache persists keys across tests within the process).
let _n = 0;
const uid = () => `org-cache-${process.pid}-${Date.now()}-${++_n}`;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV) delete process.env[k];
  process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
  mGetProfile.mockResolvedValue({ company_name: 'Acme', team_size: '' });
  mGetCtx.mockResolvedValue({ assembled: true });
  mOverlay.mockReturnValue({ company_name: 'Acme', team_size: '50' });
});
afterAll(() => { for (const k of ENV) delete process.env[k]; });

describe('request-level dedup (F-12 memoRequest single-flight)', () => {
  test('two adapter calls for the same company in ONE request → context assembled once', async () => {
    await runWithRequestExecutionContext({ requestId: 'r1' }, async () => {
      const id = uid();
      const a = await getCanonicalProfile(id);
      const b = await getCanonicalProfile(id);
      expect(a).toEqual({ company_name: 'Acme', team_size: '50' });
      expect(b).toEqual({ company_name: 'Acme', team_size: '50' });
      // legacy profile is still loaded per call (its own W4-5 path), but the
      // canonical CONTEXT fan-out is deduped to one assembly.
      expect(mGetCtx).toHaveBeenCalledTimes(1);
    });
  });
  test('different companies do NOT share (tenant isolation of the key)', async () => {
    await runWithRequestExecutionContext({ requestId: 'r2' }, async () => {
      const a = uid(); const b = uid();
      await getCanonicalProfile(a);
      await getCanonicalProfile(b);
      expect(mGetCtx).toHaveBeenCalledTimes(2);
      expect(mGetCtx.mock.calls[0][0]).toBe(a);
      expect(mGetCtx.mock.calls[1][0]).toBe(b);
    });
  });
});

describe('kill switch → uncached (fail-open to direct assembly)', () => {
  test('per-namespace kill: still grounds, no cache dedup', async () => {
    process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX = '1';
    await runWithRequestExecutionContext({ requestId: 'r3' }, async () => {
      const id = uid();
      const a = await getCanonicalProfile(id);
      const b = await getCanonicalProfile(id);
      expect(a).toEqual({ company_name: 'Acme', team_size: '50' });
      expect(b).toEqual({ company_name: 'Acme', team_size: '50' });
      expect(mGetCtx).toHaveBeenCalledTimes(2); // no dedup when killed
    });
  });
});

describe('fail-open + correctness', () => {
  test('context assembly failure → legacy (never cached, never thrown)', async () => {
    mGetCtx.mockRejectedValue(new Error('ctx down'));
    const out = await getCanonicalProfile(uid());
    expect(out).toEqual({ company_name: 'Acme', team_size: '' }); // legacy
    expect(mOverlay).not.toHaveBeenCalled();
  });
  test('null context → legacy, not cached', async () => {
    mGetCtx.mockResolvedValue(null);
    await runWithRequestExecutionContext({ requestId: 'r4' }, async () => {
      const id = uid();
      const a = await getCanonicalProfile(id);
      const b = await getCanonicalProfile(id);
      expect(a).toEqual({ company_name: 'Acme', team_size: '' });
      // null is not cached → within-request memo dedups the assembly, but the
      // second call still resolves to legacy (no stale-null poisoning of Redis)
      expect(mGetCtx).toHaveBeenCalled();
      expect(b).toEqual({ company_name: 'Acme', team_size: '' });
    });
  });
});

describe('OFF mode never touches the cache', () => {
  test('flag off → legacy, context + cache untouched', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'off';
    await runWithRequestExecutionContext({ requestId: 'r5' }, async () => {
      const out = await getCanonicalProfile(uid());
      expect(out).toEqual({ company_name: 'Acme', team_size: '' });
      expect(mGetCtx).not.toHaveBeenCalled();
    });
  });
});
