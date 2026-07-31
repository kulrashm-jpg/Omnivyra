/**
 * AI-ORCH 2A-2.1 — shadow wiring: mismatch categories, the fire-and-forget hook's
 * OFF/ON contract, fail-safe, and in-memory metrics.
 */
import { compareToLegacy, type LegacyExecutionConfig } from '../../services/aiOrchestration/resolverComparator';
import {
  maybeRunResolverShadow,
  type ShadowObservation,
} from '../../services/aiOrchestration/resolverShadow';
import {
  getResolverShadowMetrics,
  resetResolverShadowMetrics,
} from '../../services/aiOrchestration/resolverShadowMetrics';
import type {
  ResolverDeps,
  ResolverBindingRow,
  ResolverProfileVersion,
} from '../../services/aiOrchestration/configurationResolver';
import type { ResolvedExecutionPlan } from '../../services/aiOrchestration/types/ResolvedExecutionPlan';

const BALANCED_VERSION: ResolverProfileVersion = {
  profileId: 'p-balanced', profileKey: 'BALANCED', version: 1, mode: 'tier', qualityTier: 'balanced',
  capabilityRequirements: {},
  params: { temperature: 0.4, max_output_tokens: 2000, seed_policy: 'none' },
  modality: { streaming: false, structured_output: false },
  reliability: { timeout_ms: 60000, max_retries: 2, partial_allowed: false },
  limits: {}, caching: { cacheable: true }, safety: { moderation: 'off', prompt_injection_guard: false },
};
const platformDefault: ResolverBindingRow = { scope: 'platform_default', capabilityId: null, orgId: null, profileId: 'p-balanced', isActive: true };

function inMemoryDeps(onCall?: () => void): ResolverDeps {
  return {
    async mapOperationToCapability() { onCall?.(); return null; },
    async loadBinding() { onCall?.(); return null; },
    async loadPlatformDefaultBinding() { onCall?.(); return platformDefault; },
    async loadActiveProfileVersion() { onCall?.(); return BALANCED_VERSION; },
  };
}

const flush = () => new Promise((r) => setImmediate(r));
const syncSchedule = (fn: () => void) => fn();

// ── Comparator categories ─────────────────────────────────────────────────────

describe('ResolverComparator — mismatch categories', () => {
  const basePlan: ResolvedExecutionPlan = {
    capabilityId: 'C', model: { provider: 'openai', model: 'gpt-4o-mini', modelVersion: null },
    params: { temperature: 0.4, maxOutputTokens: 2000, streaming: false, structuredOutput: false, vision: false },
    reliability: { timeoutMs: 60000, maxRetries: 2 }, limits: {}, caching: {}, source: 'platform_default',
  };
  const fullMatch: LegacyExecutionConfig = {
    provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, maxOutputTokens: 2000,
    streaming: false, structuredOutput: false, vision: false, timeoutMs: 60000, maxRetries: 2,
  };

  test('MATCH → mismatchCategory MATCH', () => {
    expect(compareToLegacy(fullMatch, basePlan).mismatchCategory).toBe('MATCH');
  });

  test.each([
    ['provider',        { provider: 'anthropic' },      'PROVIDER_MISMATCH'],
    ['model',           { model: 'gpt-4o' },            'MODEL_MISMATCH'],
    ['temperature',     { temperature: 0.9 },           'PARAMETER_MISMATCH'],
    ['streaming',       { streaming: true },            'STREAMING_MISMATCH'],
    ['structuredOutput',{ structuredOutput: true },     'STRUCTURED_OUTPUT_MISMATCH'],
    ['vision',          { vision: true },               'VISION_MISMATCH'],
    ['timeoutMs',       { timeoutMs: 30000 },           'TIMEOUT_MISMATCH'],
    ['maxRetries',      { maxRetries: 5 },              'RETRY_MISMATCH'],
  ])('single %s diff → %s', (_f, override, expected) => {
    const r = compareToLegacy({ ...fullMatch, ...(override as object) }, basePlan);
    expect(r.status).toBe('MISMATCH');
    expect(r.mismatchCategory).toBe(expected);
    expect(r.diffs[0].category).toBe(expected);
    expect(typeof r.diffs[0].reason).toBe('string');
  });

  test('two diffs → MULTIPLE', () => {
    const r = compareToLegacy({ ...fullMatch, provider: 'anthropic', temperature: 0.9 }, basePlan);
    expect(r.mismatchCategory).toBe('MULTIPLE');
    expect(r.diffs).toHaveLength(2);
  });
});

// ── The fire-and-forget hook ──────────────────────────────────────────────────

describe('maybeRunResolverShadow — hook contract', () => {
  const FLAG = 'ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE';
  beforeEach(() => resetResolverShadowMetrics());
  afterEach(() => { delete process.env[FLAG]; });

  test('OFF (default) → returns void, schedules nothing, deps never built, metrics untouched', async () => {
    let depsBuilt = false;
    const depsFactory = () => { depsBuilt = true; return inMemoryDeps(); };
    let scheduled = false;
    const schedule = (fn: () => void) => { scheduled = true; fn(); };
    const ret = maybeRunResolverShadow(null, 'op', 'openai', 'gpt-4o-mini', 0.4, 2000, { depsFactory, schedule });
    await flush();
    expect(ret).toBeUndefined();
    expect(scheduled).toBe(false);
    expect(depsBuilt).toBe(false);
    expect(getResolverShadowMetrics().invocations).toBe(0);
  });

  test('ON → runs exactly once, emits observation, records metrics, returns void', async () => {
    process.env[FLAG] = 'shadow';
    let observed: ShadowObservation | null = null;
    const legacyMatch = { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, maxOutputTokens: 2000, streaming: false, structuredOutput: false, vision: false, timeoutMs: 60000, maxRetries: 2 };
    const ret = maybeRunResolverShadow(null, 'op', 'openai', 'gpt-4o-mini', 0.4, 2000, {
      depsFactory: () => inMemoryDeps(),
      schedule: syncSchedule,
      sink: (o) => { observed = o; },
    });
    // The runner adopts legacy provider/model for tier mode; the legacy config we
    // pass to the comparator is what the hook built from the same primitives.
    await flush();
    expect(ret).toBeUndefined();
    const m = getResolverShadowMetrics();
    expect(m.invocations).toBe(1);
    expect(m.success).toBe(1);
    expect(m.failure).toBe(0);
    expect(observed).not.toBeNull();
    expect(observed!.profileKey).toBe('BALANCED');
    expect(observed!.mismatchCategory).toBeDefined();
    // parity recorded (match or mismatch) exactly once
    expect(m.parityMatch + m.parityMismatch).toBe(1);
    // legacy-vs-resolved: provider/model adopt legacy in tier mode → those match;
    // the profile also sets params → surface them via the comparator regardless.
    void legacyMatch;
  });

  test('ON but deps factory throws → fail-safe: never throws, records a failure', async () => {
    process.env[FLAG] = 'enforce';
    const ret = maybeRunResolverShadow(null, 'op', 'openai', 'gpt-4o-mini', 0.4, 2000, {
      depsFactory: () => { throw new Error('deps boom'); },
      schedule: syncSchedule,
    });
    await flush();
    expect(ret).toBeUndefined();
    const m = getResolverShadowMetrics();
    expect(m.failure).toBe(1);
    expect(m.invocations).toBe(0); // never reached the runner
  });

  test('ON but flag read throws is impossible here; gate failure is swallowed (no throw)', () => {
    // Sanity: calling with no opts + flag OFF must not throw and must be a no-op.
    expect(() => maybeRunResolverShadow(null, 'op', 'openai', 'gpt-4o-mini', 0.4, 2000)).not.toThrow();
  });
});

// ── Metrics module ────────────────────────────────────────────────────────────

describe('resolverShadowMetrics', () => {
  test('snapshot is frozen + reset clears', () => {
    resetResolverShadowMetrics();
    const snap = getResolverShadowMetrics();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toEqual({
      invocations: 0, success: 0, failure: 0, parityMatch: 0, parityMismatch: 0, mismatchCategories: {},
      // AI-ORCH 2A-2.2 equivalence counters
      identical: 0, semanticallyEquivalent: 0, different: 0,
      snapshotHashMatches: 0, snapshotHashMismatches: 0,
      normalizationDifferences: 0, executionDifferences: 0, differenceCategories: {},
      // AI-ORCH 2A-2.3 adapter counters
      adapterInvocations: 0, adapterIdentical: 0, adapterDifferent: 0, adapterDifferences: {},
      // AI-ORCH 2A-3 dual-execution counters
      dualExecutions: 0, legacyExecutions: 0, resolverExecutions: 0, canaryExecutions: 0,
      structuralParity: 0, snapshotParity: 0, fingerprintParity: 0, configParityDifferent: 0, rollbackEvents: 0,
    });
  });
});
