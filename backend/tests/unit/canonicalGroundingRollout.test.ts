/**
 * Wave R2 / E4 — canonical-grounding rollout gate (all logic in the adapter).
 * Verifies OFF byte-faithfulness, SHADOW returns-legacy-measures-canonical,
 * ENFORCE returns-canonical, per-tenant + kill-switch, and graceful fallback.
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

const mGetProfile = getProfile as jest.Mock;
const mGetCtx = getCanonicalContext as jest.Mock;
const mOverlay = overlayCanonicalOntoProfile as jest.Mock;

const LEGACY = { company_name: 'Acme', mission: 'M', team_size: '' } as const;
const CANON = { company_name: 'Acme', mission: 'M', team_size: '50' } as const; // backfilled team_size

const ENV_KEYS = ['ROLLOUT_CANONICAL_GROUNDING_MODE', 'ROLLOUT_CANONICAL_GROUNDING_KILL',
  'ROLLOUT_CANONICAL_GROUNDING_TENANTS', 'ROLLOUT_KILL_SWITCH'];

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  mGetProfile.mockResolvedValue({ ...LEGACY });
  mGetCtx.mockResolvedValue({ assembled: true });
  mOverlay.mockReturnValue({ ...CANON });
});
afterAll(() => { for (const k of ENV_KEYS) delete process.env[k]; });

describe('OFF (default)', () => {
  test('returns legacy byte-faithfully; canonical NEVER runs', async () => {
    const out = await getCanonicalProfile('org-1', { autoRefine: false });
    expect(out).toEqual(LEGACY);
    expect(mGetProfile).toHaveBeenCalledWith('org-1', { autoRefine: false });
    expect(mGetCtx).not.toHaveBeenCalled();
    expect(mOverlay).not.toHaveBeenCalled();
  });
  test('no companyId → legacy, canonical not run', async () => {
    const out = await getCanonicalProfile(undefined);
    expect(out).toEqual(LEGACY);
    expect(mGetCtx).not.toHaveBeenCalled();
  });
});

describe('SHADOW', () => {
  beforeEach(() => { process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'shadow'; });
  test('runs canonical but RETURNS LEGACY (never canonical)', async () => {
    const out = await getCanonicalProfile('org-1');
    expect(out).toEqual(LEGACY);              // legacy returned
    expect(mGetCtx).toHaveBeenCalled();        // canonical measured
    expect(mOverlay).toHaveBeenCalled();
  });
  test('canonical failure in shadow still returns legacy (no throw)', async () => {
    mGetCtx.mockRejectedValueOnce(new Error('ctx down'));
    const out = await getCanonicalProfile('org-1');
    expect(out).toEqual(LEGACY);
  });
});

describe('ENFORCE', () => {
  beforeEach(() => { process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce'; });
  test('returns canonical (overlaid) result', async () => {
    const out = await getCanonicalProfile('org-1');
    expect(out).toEqual(CANON);
    expect(mOverlay).toHaveBeenCalled();
  });
  test('graceful fallback: canonical unavailable → legacy', async () => {
    mGetCtx.mockResolvedValueOnce(null);
    const out = await getCanonicalProfile('org-1');
    expect(out).toEqual(LEGACY);
    expect(mOverlay).not.toHaveBeenCalled();
  });
});

describe('per-tenant + kill switch + rollback', () => {
  test('per-tenant: shadow globally, enforce for a listed tenant', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'shadow';
    process.env.ROLLOUT_CANONICAL_GROUNDING_TENANTS = 'org-vip';
    expect(await getCanonicalProfile('org-plain')).toEqual(LEGACY); // shadow → legacy
    expect(await getCanonicalProfile('org-vip')).toEqual(CANON);    // promoted → canonical
  });
  test('per-flag kill switch → OFF even when mode=enforce', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    process.env.ROLLOUT_CANONICAL_GROUNDING_KILL = '1';
    const out = await getCanonicalProfile('org-1');
    expect(out).toEqual(LEGACY);
    expect(mGetCtx).not.toHaveBeenCalled();
  });
  test('global kill switch → OFF', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    process.env.ROLLOUT_KILL_SWITCH = 'true';
    expect(await getCanonicalProfile('org-1')).toEqual(LEGACY);
  });
  test('rollback: enforce → off restores legacy immediately', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    expect(await getCanonicalProfile('org-1')).toEqual(CANON);
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'off';
    expect(await getCanonicalProfile('org-1')).toEqual(LEGACY);
  });
});
