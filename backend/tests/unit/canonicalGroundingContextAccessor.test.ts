/**
 * RF-1 — gated canonical CONTEXT accessor (single control point).
 * Certifies that getCanonicalGroundingContext obeys the SAME rollout flag as
 * getCanonicalProfile, so the brief-suggestions consumer can no longer bypass
 * the adapter:
 *   OFF     → null, and canonical context is NEVER executed (byte-faithful).
 *   SHADOW  → context IS executed (measured) but null is returned (legacy).
 *   ENFORCE → the canonical context is returned for grounding.
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

import { getCanonicalGroundingContext } from '../../services/context/canonicalProfileAdapter';
import { getCanonicalContext } from '../../services/context/contextAssimilationEngine';

const mGetCtx = getCanonicalContext as jest.Mock;

const ENV_KEYS = ['ROLLOUT_CANONICAL_GROUNDING_MODE', 'ROLLOUT_CANONICAL_GROUNDING_KILL',
  'ROLLOUT_CANONICAL_GROUNDING_TENANTS', 'ROLLOUT_KILL_SWITCH'];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  // Isolate mode logic from the E3 cache so every context load is observable.
  process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX = '1';
  mGetCtx.mockResolvedValue({ assembled: true });
});
afterAll(() => { for (const k of ENV_KEYS) delete process.env[k]; delete process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX; });

describe('OFF (default) — byte-faithful: canonical never runs', () => {
  test('returns null and does NOT execute canonical context', async () => {
    const out = await getCanonicalGroundingContext('org-1');
    expect(out).toBeNull();
    expect(mGetCtx).not.toHaveBeenCalled();
  });
  test('no companyId → null, canonical not run', async () => {
    const out = await getCanonicalGroundingContext(undefined);
    expect(out).toBeNull();
    expect(mGetCtx).not.toHaveBeenCalled();
  });
});

describe('SHADOW — measured, but legacy semantics (null returned)', () => {
  beforeEach(() => { process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'shadow'; });
  test('executes canonical context (measurement) yet returns null', async () => {
    const out = await getCanonicalGroundingContext('org-1');
    expect(out).toBeNull();                 // consumer prompt unchanged from main
    expect(mGetCtx).toHaveBeenCalled();      // canonical measured
  });
  test('context failure in shadow → null (never throws)', async () => {
    mGetCtx.mockRejectedValueOnce(new Error('ctx down'));
    await expect(getCanonicalGroundingContext('org-1')).resolves.toBeNull();
  });
});

describe('ENFORCE — canonical context returned', () => {
  beforeEach(() => { process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce'; });
  test('returns the canonical context', async () => {
    const out = await getCanonicalGroundingContext('org-1');
    expect(out).toEqual({ assembled: true });
    expect(mGetCtx).toHaveBeenCalledWith('org-1');
  });
  test('canonical unavailable (null) → null grounding (graceful)', async () => {
    mGetCtx.mockResolvedValueOnce(null);
    const out = await getCanonicalGroundingContext('org-1');
    expect(out).toBeNull();
  });
});

describe('kill switch forces OFF (no bypass)', () => {
  test('enforce + kill → null, canonical never runs', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    process.env.ROLLOUT_CANONICAL_GROUNDING_KILL = '1';
    const out = await getCanonicalGroundingContext('org-1');
    expect(out).toBeNull();
    expect(mGetCtx).not.toHaveBeenCalled();
  });
});
