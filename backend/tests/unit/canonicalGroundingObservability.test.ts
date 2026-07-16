/**
 * Wave R4 / E6 — canonical grounding observability.
 * Verifies every canonical grounding metric is routed through the HARDEN-001
 * registry (recordRawCounter/recordRawHistogram), that the NEW E6 series fire
 * (rollout mode per call, total grounding latency, graceful fallback rate,
 * kill-switch activation, canonical adoption / context availability), and —
 * the load-bearing invariant — that NO metric label ever carries a tenant
 * identifier (aggregate-only; bounded cardinality).
 *
 * canonicalAdoptionMetrics is intentionally NOT mocked: its real
 * recordCanonicalRead must route through the registry for this test.
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

import * as observability from '../../observability';
import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { getProfile } from '../../services/companyProfileServiceRest1Rest2Pulse';
import { getCanonicalContext } from '../../services/context/contextAssimilationEngine';
import { overlayCanonicalOntoProfile } from '../../services/context/canonicalProfileOverlay';

const mGetProfile = getProfile as jest.Mock;
const mGetCtx = getCanonicalContext as jest.Mock;
const mOverlay = overlayCanonicalOntoProfile as jest.Mock;

const TENANT = 'org-secret-does-not-leak-42';
const ENV_KEYS = ['ROLLOUT_CANONICAL_GROUNDING_MODE', 'ROLLOUT_CANONICAL_GROUNDING_KILL',
  'ROLLOUT_CANONICAL_GROUNDING_TENANTS', 'ROLLOUT_KILL_SWITCH'];

let counter: jest.SpyInstance;
let histo: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  // Isolate from the E3 cache so ctx loads on every call (deterministic reads).
  process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX = '1';
  mGetProfile.mockResolvedValue({ company_name: 'Acme', team_size: '' });
  mGetCtx.mockResolvedValue({ assembled: true });
  mOverlay.mockReturnValue({ company_name: 'Acme', team_size: '50' });
  counter = jest.spyOn(observability, 'recordRawCounter').mockImplementation(() => {});
  histo = jest.spyOn(observability, 'recordRawHistogram').mockImplementation(() => {});
});
afterAll(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  delete process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX;
});

// All (name, value, labels) recorder invocations across both recorders.
const emissions = () => [...counter.mock.calls, ...histo.mock.calls];
const named = (name: string) => emissions().filter((c) => c[0] === name);
const allLabelValues = () =>
  emissions()
    .map((c) => c[2])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
    .flatMap((l) => Object.values(l));

describe('routes through HARDEN-001 + NO tenant identifier in any label', () => {
  test('ENFORCE: emits call/read/total_ms via the registry; tenant id absent from every label', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    await getCanonicalProfile(TENANT);

    // rollout mode per call
    expect(named('canonical_grounding.call')).toContainEqual(['canonical_grounding.call', 1, { mode: 'enforce' }]);
    // canonical adoption / context availability (routed recordCanonicalRead)
    expect(named('canonical_grounding.read')).toContainEqual(['canonical_grounding.read', 1, { context_backed: true }]);
    // total grounding latency (histogram, mode-labelled)
    const total = named('canonical_grounding.total_ms');
    expect(total.length).toBe(1);
    expect(total[0][2]).toEqual({ mode: 'enforce' });
    expect(typeof total[0][1]).toBe('number');

    // THE invariant: no label value is (or contains) the tenant id.
    for (const v of allLabelValues()) {
      expect(String(v)).not.toContain(TENANT);
    }
    // Every label value is a bounded primitive (no tenant/company object leaks).
    for (const v of allLabelValues()) {
      expect(['string', 'number', 'boolean'].includes(typeof v)).toBe(true);
    }
  });

  test('label cardinality is bounded: mode ∈ {off,shadow,enforce}, context_backed ∈ {true,false}', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'shadow';
    await getCanonicalProfile(TENANT);
    for (const c of named('canonical_grounding.call')) {
      expect(['off', 'shadow', 'enforce']).toContain((c[2] as { mode: string }).mode);
    }
    for (const c of named('canonical_grounding.read')) {
      expect([true, false]).toContain((c[2] as { context_backed: boolean }).context_backed);
    }
  });
});

describe('new E6 series', () => {
  test('graceful fallback: enforce + context unavailable → fallback{mode} + read{context_backed:false}', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    mGetCtx.mockResolvedValueOnce(null);
    await getCanonicalProfile(TENANT);
    expect(named('canonical_grounding.fallback')).toContainEqual(['canonical_grounding.fallback', 1, { mode: 'enforce' }]);
    expect(named('canonical_grounding.read')).toContainEqual(['canonical_grounding.read', 1, { context_backed: false }]);
  });

  test('healthy enforce does NOT emit a fallback', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    await getCanonicalProfile(TENANT);
    expect(named('canonical_grounding.fallback').length).toBe(0);
  });

  test('kill switch: env kill → kill{source:env-kill} + call{mode:off} + total_ms{mode:off}', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    process.env.ROLLOUT_CANONICAL_GROUNDING_KILL = '1';
    await getCanonicalProfile(TENANT);
    expect(named('canonical_grounding.kill')).toContainEqual(['canonical_grounding.kill', 1, { source: 'env-kill' }]);
    expect(named('canonical_grounding.call')).toContainEqual(['canonical_grounding.call', 1, { mode: 'off' }]);
    expect(named('canonical_grounding.total_ms')[0][2]).toEqual({ mode: 'off' });
    // Kill short-circuits before assembly → no read emitted.
    expect(named('canonical_grounding.read').length).toBe(0);
  });

  test('OFF (no kill) records the call + off-mode latency but no kill counter', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'off';
    await getCanonicalProfile(TENANT);
    expect(named('canonical_grounding.call')).toContainEqual(['canonical_grounding.call', 1, { mode: 'off' }]);
    expect(named('canonical_grounding.kill').length).toBe(0);
    expect(named('canonical_grounding.total_ms')[0][2]).toEqual({ mode: 'off' });
  });

  test('no companyId short-circuit emits nothing (no tenant to ground)', async () => {
    process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'enforce';
    await getCanonicalProfile(undefined);
    expect(named('canonical_grounding.call').length).toBe(0);
    expect(named('canonical_grounding.read').length).toBe(0);
  });
});
