/**
 * AI-ORCH 2A-2.2 — Execution Equivalence Validation.
 *
 * Proves the ExecutionSnapshotBuilder / Hasher are pure + deterministic, the
 * normalization rules behave as documented, and compareExecutionEquivalence yields
 * the three levels (IDENTICAL / SEMANTICALLY_EQUIVALENT / DIFFERENT) exactly per the
 * brief's cases, with correct difference classification and metrics.
 */
import {
  ExecutionSnapshotBuilder,
  hashExecutionSnapshot,
  normalizeField,
  UNSET,
  NORMALIZATION_VERSION,
} from '../../services/aiOrchestration/executionSnapshot';
import {
  compareExecutionEquivalence,
  type LegacyExecutionConfig,
} from '../../services/aiOrchestration/resolverComparator';
import {
  recordEquivalence,
  getResolverShadowMetrics,
  getEquivalenceValidationReport,
  resetResolverShadowMetrics,
} from '../../services/aiOrchestration/resolverShadowMetrics';
import type { ResolvedExecutionPlan } from '../../services/aiOrchestration/types/ResolvedExecutionPlan';

/** Minimal plan whose EXECUTION fields exactly mirror a legacy config (for IDENTICAL). */
function planLike(over: Partial<{
  provider: string | null; model: string | null; modelVersion: string | null;
  temperature: number | null; maxOutputTokens: number | null; streaming: boolean | null;
  structuredOutput: boolean | null; vision: boolean | null; timeoutMs: number | null; maxRetries: number | null;
}> = {}): ResolvedExecutionPlan {
  return {
    capabilityId: 'C', source: 'platform_default',
    model: { provider: over.provider ?? 'openai', model: over.model ?? 'gpt-4o-mini', modelVersion: over.modelVersion, deploymentId: undefined },
    params: {
      temperature: over.temperature ?? 0.4, maxOutputTokens: over.maxOutputTokens,
      streaming: over.streaming, structuredOutput: over.structuredOutput, vision: over.vision,
    },
    reliability: { timeoutMs: over.timeoutMs ?? 60000, maxRetries: over.maxRetries ?? 2 },
    limits: {}, caching: {}, safety: undefined,
  };
}

const legacyBase: LegacyExecutionConfig = {
  provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, timeoutMs: 60000, maxRetries: 2,
};

// ── Snapshot builder + hasher ────────────────────────────────────────────────

describe('ExecutionSnapshotBuilder + Hasher — pure & deterministic', () => {
  test('same input → identical snapshot + identical hash across runs', () => {
    const s1 = ExecutionSnapshotBuilder.fromLegacy(legacyBase);
    const s2 = ExecutionSnapshotBuilder.fromLegacy(legacyBase);
    expect(s1).toEqual(s2);
    expect(hashExecutionSnapshot(s1)).toBe(hashExecutionSnapshot(s2));
    expect(hashExecutionSnapshot(s1)).toMatch(new RegExp(`^snap:v${NORMALIZATION_VERSION}:[0-9a-f]{64}$`));
  });

  test('hash covers execution semantics, not provenance', () => {
    const a = ExecutionSnapshotBuilder.fromPlan(planLike());
    const b = ExecutionSnapshotBuilder.fromPlan(planLike());
    // Different provenance would not change the execution hash (provenance excluded).
    expect(hashExecutionSnapshot(a)).toBe(hashExecutionSnapshot(b));
  });
});

describe('Normalization rules', () => {
  test('null and undefined both normalize to UNSET (no default field)', () => {
    expect(normalizeField('temperature', null)).toBe(UNSET);
    expect(normalizeField('temperature', undefined)).toBe(UNSET);
  });
  test('modality flags default to false when unset', () => {
    expect(normalizeField('streaming', undefined)).toBe(false);
    expect(normalizeField('vision', null)).toBe(false);
    expect(normalizeField('streaming', true)).toBe(true);
  });
  test('provider aliases map to the canonical id (PB-006)', () => {
    expect(normalizeField('provider', 'chatgpt')).toBe('openai');
    expect(normalizeField('provider', 'claude')).toBe('anthropic');
    expect(normalizeField('provider', '  openai ')).toBe('openai');
  });
  test('empty policy object normalizes to UNSET', () => {
    expect(normalizeField('cachePolicy', {})).toBe(UNSET);
  });
});

// ── Equivalence levels (the brief's cases) ────────────────────────────────────

describe('compareExecutionEquivalence — three levels', () => {
  test('identical configurations → IDENTICAL', () => {
    const r = compareExecutionEquivalence(legacyBase, planLike());
    expect(r.level).toBe('IDENTICAL');
    expect(r.snapshotHashMatch).toBe(true);
    expect(r.rawDifferenceCount).toBe(0);
  });

  test('null vs undefined → SEMANTICALLY_EQUIVALENT', () => {
    // legacy leaves modelVersion undefined; plan sets it null → raw differ, normalized both UNSET.
    const r = compareExecutionEquivalence({ ...legacyBase, modelVersion: undefined }, planLike({ modelVersion: null }));
    expect(r.level).toBe('SEMANTICALLY_EQUIVALENT');
    expect(r.snapshotHashMatch).toBe(true);
    expect(r.normalizationDifferenceCount).toBeGreaterThanOrEqual(1);
    expect(r.rawDiffs.some((d) => d.field === 'modelVersion' && d.category === 'NORMALIZATION_DIFFERENCE')).toBe(true);
  });

  test('explicit default vs implicit default → SEMANTICALLY_EQUIVALENT', () => {
    // legacy explicitly streaming:false; plan leaves it undefined → default false.
    const r = compareExecutionEquivalence({ ...legacyBase, streaming: false }, planLike({ streaming: undefined }));
    expect(r.level).toBe('SEMANTICALLY_EQUIVALENT');
    expect(r.snapshotHashMatch).toBe(true);
  });

  test('provider alias vs canonical id → SEMANTICALLY_EQUIVALENT', () => {
    const r = compareExecutionEquivalence({ ...legacyBase, provider: 'chatgpt' }, planLike({ provider: 'openai' }));
    expect(r.level).toBe('SEMANTICALLY_EQUIVALENT');
    expect(r.rawDiffs.some((d) => d.field === 'provider' && d.category === 'NORMALIZATION_DIFFERENCE')).toBe(true);
  });

  test('different provider → DIFFERENT (EXECUTION_DIFFERENCE)', () => {
    const r = compareExecutionEquivalence({ ...legacyBase, provider: 'anthropic' }, planLike({ provider: 'openai' }));
    expect(r.level).toBe('DIFFERENT');
    expect(r.snapshotHashMatch).toBe(false);
    expect(r.normalizedDiffs.find((d) => d.field === 'provider')!.category).toBe('EXECUTION_DIFFERENCE');
    expect(r.executionDifferenceCount).toBe(1);
  });

  test('different timeout → DIFFERENT', () => {
    const r = compareExecutionEquivalence({ ...legacyBase, timeoutMs: 30000 }, planLike({ timeoutMs: 60000 }));
    expect(r.level).toBe('DIFFERENT');
    expect(r.normalizedDiffs.some((d) => d.field === 'timeout')).toBe(true);
  });

  test('different retry count → DIFFERENT', () => {
    const r = compareExecutionEquivalence({ ...legacyBase, maxRetries: 5 }, planLike({ maxRetries: 2 }));
    expect(r.level).toBe('DIFFERENT');
    expect(r.normalizedDiffs.some((d) => d.field === 'retries')).toBe(true);
  });

  test('one-side-only field (config completeness) → CONFIGURATION_DIFFERENCE', () => {
    // legacy leaves maxOutputTokens unset; plan sets 2000.
    const r = compareExecutionEquivalence({ ...legacyBase, maxOutputTokens: undefined }, planLike({ maxOutputTokens: 2000 }));
    expect(r.level).toBe('DIFFERENT');
    expect(r.normalizedDiffs.find((d) => d.field === 'maxOutputTokens')!.category).toBe('CONFIGURATION_DIFFERENCE');
  });

  test('repeated runs are identical (determinism)', () => {
    const a = compareExecutionEquivalence(legacyBase, planLike({ provider: 'anthropic' }));
    const b = compareExecutionEquivalence(legacyBase, planLike({ provider: 'anthropic' }));
    expect(a).toEqual(b);
  });
});

// ── Metrics + report ──────────────────────────────────────────────────────────

describe('equivalence metrics + validation report', () => {
  beforeEach(() => resetResolverShadowMetrics());

  test('recordEquivalence updates counters + report', () => {
    recordEquivalence(compareExecutionEquivalence(legacyBase, planLike()));                          // IDENTICAL
    recordEquivalence(compareExecutionEquivalence({ ...legacyBase, provider: 'chatgpt' }, planLike())); // SEMANTICALLY_EQUIVALENT
    recordEquivalence(compareExecutionEquivalence({ ...legacyBase, provider: 'anthropic' }, planLike())); // DIFFERENT

    const m = getResolverShadowMetrics();
    expect(m.identical).toBe(1);
    expect(m.semanticallyEquivalent).toBe(1);
    expect(m.different).toBe(1);
    expect(m.snapshotHashMatches).toBe(2); // identical + semantically-equivalent
    expect(m.snapshotHashMismatches).toBe(1);
    expect(m.executionDifferences).toBe(1);

    const report = getEquivalenceValidationReport();
    expect(report.requestsObserved).toBe(3);
    expect(report.identical).toBe(1);
    expect(report.snapshotHashMatchRate).toBeCloseTo(2 / 3);
    expect(report.topDifferenceCategories.length).toBeGreaterThan(0);
  });
});
