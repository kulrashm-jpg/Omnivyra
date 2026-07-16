/**
 * RF-2 — shadow-divergence forensic traceability.
 * Verifies that a PROMOTION-BLOCKING divergence (canonical overwrote a value
 * legacy already held) produces a bounded, tenant-free, trace-correlated
 * diagnostic; backfill-only shadows do NOT; and sampling/dedup/bounding hold.
 * Drives the real shadow path via getCanonicalProfile; overlay is mocked to
 * SIMULATE an overwrite regression (the real overlay never overwrites).
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

import { getCanonicalProfile, getShadowDivergenceDiagnostics } from '../../services/context/canonicalProfileAdapter';
import { getProfile } from '../../services/companyProfileServiceRest1Rest2Pulse';
import { getCanonicalContext } from '../../services/context/contextAssimilationEngine';
import { overlayCanonicalOntoProfile } from '../../services/context/canonicalProfileOverlay';
import { runWithRequestExecutionContext } from '../../../lib/platform/requestContext';

const mGetProfile = getProfile as jest.Mock;
const mGetCtx = getCanonicalContext as jest.Mock;
const mOverlay = overlayCanonicalOntoProfile as jest.Mock;

const ENV = ['ROLLOUT_CANONICAL_GROUNDING_MODE', 'CANONICAL_SHADOW_DIAG_MAX', 'CANONICAL_SHADOW_DIAG_WINDOW_MAX'];

/** Drive one shadow overwrite of `field`: legacy has it, canonical changes it. */
async function overwriteShadow(field: string, seed?: Record<string, unknown>) {
  mGetProfile.mockResolvedValue({ company_name: 'Acme', [field]: 'legacy-value' });
  mOverlay.mockReturnValue({ company_name: 'Acme', [field]: 'canonical-CHANGED' });
  const run = () => getCanonicalProfile('org-1');
  if (seed) return runWithRequestExecutionContext(seed as never, run);
  return run();
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of ENV) delete process.env[k];
  process.env.ROLLOUT_CANONICAL_GROUNDING_MODE = 'shadow';
  process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX = '1'; // isolate from E3 cache
  mGetCtx.mockResolvedValue({ assembled: true });
});
afterAll(() => { for (const k of ENV) delete process.env[k]; delete process.env.CACHE_KILL_OMNIVYRA_CANONICAL_CTX; });

describe('overwrite divergence → traceable diagnostic', () => {
  test('captures a trace-correlated record for a promotion-blocking overwrite', async () => {
    const before = getShadowDivergenceDiagnostics().entries.length;
    const out = await overwriteShadow('k_over_trace', {
      requestId: 'req-1', correlationId: 'corr-1', traceId: 'trace-1', orgId: 'ORG-SECRET',
    });
    // shadow ALWAYS returns legacy (unchanged consumer behaviour)
    expect(out).toEqual({ company_name: 'Acme', k_over_trace: 'legacy-value' });

    const { entries } = getShadowDivergenceDiagnostics();
    expect(entries.length).toBe(before + 1);
    const d = entries.find((e) => e.overwrittenFields.includes('k_over_trace'))!;
    expect(d).toBeDefined();
    expect(d.category).toBe('overwrote');
    expect(d.fieldsOverwritten).toBeGreaterThanOrEqual(1);
    expect(d.mode).toBe('shadow');
    expect(d.contextAvailable).toBe(true);
    expect(typeof d.assemblyMs).toBe('number');
    expect(typeof d.ts).toBe('string');
    // Trace correlation (F-03)
    expect(d.traceId).toBe('trace-1');
    expect(d.requestId).toBe('req-1');
    expect(d.correlationId).toBe('corr-1');
  });

  test('NO tenant identifier, field VALUES, or content in the record', async () => {
    await overwriteShadow('k_no_pii', {
      requestId: 'req-2', correlationId: 'corr-2', traceId: 'trace-2', orgId: 'ORG-SECRET', userId: 'USER-SECRET',
    });
    const d = getShadowDivergenceDiagnostics().entries.find((e) => e.overwrittenFields.includes('k_no_pii'))!;
    const json = JSON.stringify(d);
    expect(json).not.toContain('ORG-SECRET');
    expect(json).not.toContain('USER-SECRET');
    expect(json).not.toContain('legacy-value');       // no field VALUES
    expect(json).not.toContain('canonical-CHANGED');   // no field VALUES
    expect(Object.keys(d)).not.toContain('orgId');
    expect(Object.keys(d)).not.toContain('userId');
    expect(Object.keys(d)).not.toContain('tenantId');
    // overwrittenFields carries schema KEYS only
    expect(d.overwrittenFields).toEqual(['k_no_pii']);
  });

  test('trace correlation works unscoped too (fail-safe: ids undefined, still captured)', async () => {
    const before = getShadowDivergenceDiagnostics().entries.length;
    await overwriteShadow('k_unscoped'); // no request context
    const { entries } = getShadowDivergenceDiagnostics();
    expect(entries.length).toBe(before + 1);
    const d = entries.find((e) => e.overwrittenFields.includes('k_unscoped'))!;
    expect(d.traceId).toBeUndefined();
    expect(d.category).toBe('overwrote');
  });
});

describe('backfill-only divergence is NOT captured', () => {
  test('empty legacy field filled by canonical → metric only, no forensic record', async () => {
    const before = getShadowDivergenceDiagnostics().entries.length;
    mGetProfile.mockResolvedValue({ company_name: 'Acme', k_backfill: '' }); // empty
    mOverlay.mockReturnValue({ company_name: 'Acme', k_backfill: 'filled' }); // backfill
    const out = await getCanonicalProfile('org-1');
    expect(out).toEqual({ company_name: 'Acme', k_backfill: '' }); // legacy returned
    expect(getShadowDivergenceDiagnostics().entries.length).toBe(before); // unchanged
  });
});

describe('sampling / bounding', () => {
  test('dedup: identical overwrite signature within window captured once, rest dropped', async () => {
    const beforeDropped = getShadowDivergenceDiagnostics().dropped;
    await overwriteShadow('k_dedup');
    const midLen = getShadowDivergenceDiagnostics().entries.length;
    await overwriteShadow('k_dedup'); // identical signature → dropped
    await overwriteShadow('k_dedup');
    const after = getShadowDivergenceDiagnostics();
    expect(after.entries.length).toBe(midLen);                 // no new entry
    expect(after.dropped).toBeGreaterThanOrEqual(beforeDropped + 2);
  });

  test('bounded store: retained entries never exceed CANONICAL_SHADOW_DIAG_MAX', async () => {
    process.env.CANONICAL_SHADOW_DIAG_MAX = '3';
    process.env.CANONICAL_SHADOW_DIAG_WINDOW_MAX = '100'; // avoid rate-limit interference
    for (let i = 0; i < 6; i++) await overwriteShadow(`k_bound_${i}`); // 6 distinct signatures
    const { entries } = getShadowDivergenceDiagnostics();
    expect(entries.length).toBe(3);                            // capped (drop-oldest)
    // most-recent retained
    expect(entries.some((e) => e.overwrittenFields.includes('k_bound_5'))).toBe(true);
  });
});

describe('fail-safe / regression safety', () => {
  test('shadow overwrite path never throws and always returns legacy', async () => {
    process.env.CANONICAL_SHADOW_DIAG_MAX = '5';
    await expect(overwriteShadow('k_safe')).resolves.toEqual({ company_name: 'Acme', k_safe: 'legacy-value' });
  });
});
