/**
 * AI-ORCH 2A-3 — ConfigurationParityGuard + orchestration mode/authority + dual flow.
 */
import { ConfigurationParityGuard } from '../../services/aiOrchestration/configurationParityGuard';
import { resolveOrchestrationMode, resolveExecutionAuthority, type OrchestrationMode } from '../../services/aiOrchestration/orchestrationMode';
import {
  recordDualExecution, recordOrchestrationMode,
  getResolverShadowMetrics, getEquivalenceValidationReport, resetResolverShadowMetrics,
} from '../../services/aiOrchestration/resolverShadowMetrics';
import { maybeRunResolverShadow } from '../../services/aiOrchestration/resolverShadow';
import type { LegacyExecutionConfiguration } from '../../services/aiOrchestration/types/LegacyExecutionConfiguration';
import type { ResolverDeps, ResolverBindingRow, ResolverProfileVersion } from '../../services/aiOrchestration/configurationResolver';

const cfg = (o: Partial<LegacyExecutionConfiguration> = {}): LegacyExecutionConfiguration => ({
  provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, maxOutputTokens: 2000,
  streaming: false, structuredOutput: false, vision: false, timeoutMs: 60000, maxRetries: 2, ...o,
});

// ── Guard ────────────────────────────────────────────────────────────────────

describe('ConfigurationParityGuard', () => {
  test('IDENTICAL when executed == resolver', () => {
    const r = ConfigurationParityGuard.compare(cfg(), cfg());
    expect(r.parity).toBe('IDENTICAL');
    expect(r.snapshotHashMatch).toBe(true);
    expect(r.structuralMatch).toBe(true);
    expect(r.differences).toHaveLength(0);
  });

  test('SEMANTICALLY_EQUIVALENT for provider alias (raw differs, normalized same)', () => {
    const r = ConfigurationParityGuard.compare(cfg({ provider: 'chatgpt' }), cfg({ provider: 'openai' }));
    expect(r.parity).toBe('SEMANTICALLY_EQUIVALENT');
    expect(r.snapshotHashMatch).toBe(true);
  });

  test('DIFFERENT (EXECUTION) for different temperature', () => {
    const r = ConfigurationParityGuard.compare(cfg({ temperature: 0.4 }), cfg({ temperature: 0.9 }));
    expect(r.parity).toBe('DIFFERENT');
    expect(r.snapshotHashMatch).toBe(false);
    expect(r.differences.find((d) => d.mappedField === 'temperature')!.category).toBe('EXECUTION_DIFFERENCE');
  });

  test('CONFIGURATION difference + structuralMatch=false when one side unset', () => {
    const r = ConfigurationParityGuard.compare(cfg({ maxOutputTokens: null }), cfg({ maxOutputTokens: 2000 }));
    expect(r.parity).toBe('DIFFERENT');
    expect(r.structuralMatch).toBe(false);
    expect(r.differences.find((d) => d.mappedField === 'maxOutputTokens')!.category).toBe('CONFIGURATION_DIFFERENCE');
  });

  test('fingerprint match reported (diagnostic only)', () => {
    const a = ConfigurationParityGuard.compare(cfg({ configFingerprint: 'x' }), cfg({ configFingerprint: 'x' }));
    expect(a.fingerprintMatch).toBe(true);
    const b = ConfigurationParityGuard.compare(cfg({ configFingerprint: null }), cfg({ configFingerprint: 'x' }));
    expect(b.fingerprintMatch).toBe(false);
  });

  test('deterministic', () => {
    expect(ConfigurationParityGuard.compare(cfg(), cfg({ temperature: 0.9 })))
      .toEqual(ConfigurationParityGuard.compare(cfg(), cfg({ temperature: 0.9 })));
  });
});

// ── Mode + authority ─────────────────────────────────────────────────────────

describe('orchestration mode + execution authority', () => {
  const ENV = 'AI_CONFIG_RESOLVER_MODE';
  afterEach(() => { delete process.env[ENV]; delete process.env.ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE; });

  test('default mode is off (byte-identical)', () => {
    expect(resolveOrchestrationMode()).toBe('off');
    expect(resolveExecutionAuthority('off')).toMatchObject({ executes: 'legacy', buildResolver: false, validateParity: false });
  });

  test('env selects the mode', () => {
    for (const m of ['off', 'shadow', 'dual', 'canary', 'full'] as OrchestrationMode[]) {
      process.env[ENV] = m;
      expect(resolveOrchestrationMode()).toBe(m);
    }
  });

  test('authority matrix (canary/full execute resolver ONLY when the master enable flag is on — 2B)', () => {
    expect(resolveExecutionAuthority('shadow')).toMatchObject({ executes: 'legacy', buildResolver: true, validateParity: false });
    expect(resolveExecutionAuthority('dual')).toMatchObject({ executes: 'legacy', buildResolver: true, validateParity: true, canary: false });
    // enable flag OFF (default) → canary/full still execute legacy (2B master switch).
    expect(resolveExecutionAuthority('canary')).toMatchObject({ executes: 'legacy', validateParity: true, canary: true });
    expect(resolveExecutionAuthority('full')).toMatchObject({ executes: 'legacy', validateParity: true });
    // enable flag ON → resolver.
    process.env.ROLLOUT_AI_CONFIG_RESOLVER_ENABLED_MODE = 'enforce';
    expect(resolveExecutionAuthority('canary').executes).toBe('resolver');
    expect(resolveExecutionAuthority('full').executes).toBe('resolver');
    delete process.env.ROLLOUT_AI_CONFIG_RESOLVER_ENABLED_MODE;
  });

  test('falls back to the shadow rollout flag when mode env unset', () => {
    process.env.ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE = 'shadow';
    expect(resolveOrchestrationMode()).toBe('shadow');
  });
});

// ── Metrics: dual + rollback ─────────────────────────────────────────────────

describe('dual metrics + rollback detection', () => {
  beforeEach(() => resetResolverShadowMetrics());

  test('recordDualExecution counts parity + execution source', () => {
    recordDualExecution(ConfigurationParityGuard.compare(cfg(), cfg()), 'legacy', false);
    recordDualExecution(ConfigurationParityGuard.compare(cfg(), cfg({ temperature: 0.9 })), 'resolver', true);
    const m = getResolverShadowMetrics();
    expect(m.dualExecutions).toBe(2);
    expect(m.legacyExecutions).toBe(1);
    expect(m.resolverExecutions).toBe(1);
    expect(m.canaryExecutions).toBe(1);
    expect(m.snapshotParity).toBe(1);      // first identical
    expect(m.configParityDifferent).toBe(1); // second different
    const rep = getEquivalenceValidationReport();
    expect(rep.dualExecutions).toBe(2);
    expect(rep.snapshotParityRate).toBe(0.5);
  });

  test('rollback increments when mode decreases', () => {
    recordOrchestrationMode('dual');
    recordOrchestrationMode('canary');
    recordOrchestrationMode('off');   // rollback
    expect(getResolverShadowMetrics().rollbackEvents).toBe(1);
  });
});

// ── Hook: DUAL builds both, legacy executes, parity validated ────────────────

describe('maybeRunResolverShadow — DUAL mode', () => {
  const ENV = 'AI_CONFIG_RESOLVER_MODE';
  beforeEach(() => resetResolverShadowMetrics());
  afterEach(() => { delete process.env[ENV]; });

  const version: ResolverProfileVersion = {
    profileId: 'p', profileKey: 'BALANCED', version: 1, mode: 'tier', qualityTier: 'balanced', capabilityRequirements: {},
    params: { temperature: 0.4, max_output_tokens: 2000, seed_policy: 'none' }, modality: { streaming: false, structured_output: false },
    reliability: { timeout_ms: 60000, max_retries: 2 }, limits: {}, caching: { cacheable: true }, safety: { moderation: 'off' },
  };
  const platformDefault: ResolverBindingRow = { scope: 'platform_default', capabilityId: null, orgId: null, profileId: 'p', isActive: true };
  const deps: ResolverDeps = {
    async mapOperationToCapability() { return null; },
    async loadBinding() { return null; },
    async loadPlatformDefaultBinding() { return platformDefault; },
    async loadActiveProfileVersion() { return version; },
  };
  const flush = () => new Promise((r) => setImmediate(r));

  test('DUAL: legacy executes, guard validates, dualExecutions recorded', async () => {
    process.env[ENV] = 'dual';
    await new Promise<void>((resolve) => {
      maybeRunResolverShadow(null, 'op', 'openai', 'gpt-4o-mini', 0.4, 2000, {
        depsFactory: () => deps, schedule: (fn) => fn(), sink: () => resolve(),
      });
    });
    await flush();
    const m = getResolverShadowMetrics();
    expect(m.dualExecutions).toBe(1);
    expect(m.legacyExecutions).toBe(1);   // legacy remains the executor
    expect(m.resolverExecutions).toBe(0);
  });
});
