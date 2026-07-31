/**
 * AI-ORCH 2A-2 — Configuration Resolver (shadow) contract tests.
 *
 * Proves: determinism, deterministic precedence, fingerprint reproducibility
 * (resolver recomputes the exact 2B.1A seed fingerprint), trace emission,
 * override-patch merge, comparator MATCH/MISMATCH, and the shadow-mode safety
 * contract (OFF → never runs; ON → runs, discards, never throws).
 */
import {
  resolveExecutionPlan,
  type ResolverDeps,
  type ResolverBindingRow,
  type ResolverProfileVersion,
} from '../../services/aiOrchestration/configurationResolver';
import { compareToLegacy, type LegacyExecutionConfig } from '../../services/aiOrchestration/resolverComparator';
import { runConfigResolverShadow, type ShadowObservation } from '../../services/aiOrchestration/resolverShadow';
import type { ResolvedExecutionPlan } from '../../services/aiOrchestration/types/ResolvedExecutionPlan';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BALANCED_VERSION: ResolverProfileVersion = {
  profileId: 'p-balanced', profileKey: 'BALANCED', version: 1, mode: 'tier', qualityTier: 'balanced',
  capabilityRequirements: {},
  params: { temperature: 0.4, max_output_tokens: 2000, seed_policy: 'none' },
  modality: { streaming: false, structured_output: false },
  reliability: { timeout_ms: 60000, max_retries: 2, partial_allowed: false },
  limits: {}, caching: { cacheable: true }, safety: { moderation: 'off', prompt_injection_guard: false },
};

const BALANCED_FINGERPRINT = 'sha256:v1:9dbba7cc97a50e79c8bd4bde455514865dad37c3d0ab7601025eb980ffc92910';

/** Configurable in-memory deps. `bindings` keyed by `${orgId ?? '*'}::${cap ?? '*'}`. */
function makeDeps(opts: {
  bindings?: Record<string, ResolverBindingRow>;
  platformDefault?: ResolverBindingRow | null;
  version?: ResolverProfileVersion | null;
  opMap?: Record<string, string>;
  onCall?: (name: string) => void;
} = {}): ResolverDeps {
  const bindings = opts.bindings ?? {};
  const version = opts.version === undefined ? BALANCED_VERSION : opts.version;
  return {
    async mapOperationToCapability(op) { opts.onCall?.('map'); return opts.opMap?.[op] ?? null; },
    async loadBinding(orgId, cap) { opts.onCall?.('binding'); return bindings[`${orgId ?? '*'}::${cap ?? '*'}`] ?? null; },
    async loadPlatformDefaultBinding() { opts.onCall?.('platform'); return opts.platformDefault ?? null; },
    async loadActiveProfileVersion() { opts.onCall?.('version'); return version; },
  };
}

const platformDefaultBinding: ResolverBindingRow = { scope: 'platform_default', capabilityId: null, orgId: null, profileId: 'p-balanced', isActive: true };
const capDefaultBinding: ResolverBindingRow = { scope: 'capability_default', capabilityId: 'CONTENT_WRITER', orgId: null, profileId: 'p-balanced', isActive: true };

// ── Determinism ───────────────────────────────────────────────────────────────

describe('ConfigurationResolver — determinism', () => {
  test('same inputs produce identical plan/metadata/trace/fingerprint', async () => {
    const deps = makeDeps({ platformDefault: platformDefaultBinding });
    const a = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1', legacyProvider: 'openai', legacyModel: 'gpt-4o-mini' }, deps);
    const b = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1', legacyProvider: 'openai', legacyModel: 'gpt-4o-mini' }, deps);
    expect(a.plan).toEqual(b.plan);
    expect(a.metadata).toEqual(b.metadata);
    expect(a.trace).toEqual(b.trace);
    expect(a.plan.configFingerprint).toBe(b.plan.configFingerprint);
  });

  test('recomputed fingerprint reproduces the 2B.1A BALANCED seed fingerprint', async () => {
    const deps = makeDeps({ platformDefault: platformDefaultBinding });
    const { plan, metadata } = await resolveExecutionPlan({ capabilityId: 'X', legacyProvider: 'openai', legacyModel: 'gpt-4o-mini' }, deps);
    expect(plan.configFingerprint).toBe(BALANCED_FINGERPRINT);
    expect(metadata.configFingerprint).toBe(BALANCED_FINGERPRINT);
    expect(metadata.executionSchemaVersion).toBe(1);
    expect(metadata.canonicalizationVersion).toBe(1);
    expect(metadata.fingerprintAlgorithm).toBe('sha256');
  });
});

// ── Precedence ──────────────────────────────────────────────────────────────

describe('ConfigurationResolver — deterministic precedence (most specific first)', () => {
  test('capability override wins over everything', async () => {
    const deps = makeDeps({
      bindings: {
        'org1::CONTENT_WRITER': { scope: 'capability_override', capabilityId: 'CONTENT_WRITER', orgId: 'org1', profileId: 'p-balanced', isActive: true },
        'org1::*': { scope: 'org_default', capabilityId: null, orgId: 'org1', profileId: 'p-balanced', isActive: true },
        '*::CONTENT_WRITER': capDefaultBinding,
      },
      platformDefault: platformDefaultBinding,
    });
    const { plan, metadata } = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1' }, deps);
    expect(plan.source).toBe('capability_override');
    expect(metadata.resolutionDecisionCode).toBe('USE_OVERRIDE');
  });

  test('org default wins when no capability override', async () => {
    const deps = makeDeps({
      bindings: { 'org1::*': { scope: 'org_default', capabilityId: null, orgId: 'org1', profileId: 'p-balanced', isActive: true }, '*::CONTENT_WRITER': capDefaultBinding },
      platformDefault: platformDefaultBinding,
    });
    const { plan } = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1' }, deps);
    expect(plan.source).toBe('org_default');
  });

  test('capability default wins when no org bindings', async () => {
    const deps = makeDeps({ bindings: { '*::CONTENT_WRITER': capDefaultBinding }, platformDefault: platformDefaultBinding });
    const { plan } = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1' }, deps);
    expect(plan.source).toBe('capability_default');
  });

  test('platform default is the final binding fallback', async () => {
    const deps = makeDeps({ platformDefault: platformDefaultBinding });
    const { plan } = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1' }, deps);
    expect(plan.source).toBe('platform_default');
  });

  test('no binding at all → legacy_hardcoded plan (fail-safe)', async () => {
    const deps = makeDeps({ platformDefault: null });
    const { plan, metadata } = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER', orgId: 'org1', legacyProvider: 'openai', legacyModel: 'gpt-4o' }, deps);
    expect(plan.source).toBe('legacy_hardcoded');
    expect(plan.model.model).toBe('gpt-4o');
    expect(plan.configFingerprint).toBeNull();
    expect(metadata.resolutionReasonCode).toBe('LEGACY_RESOLVER_UNAVAILABLE');
  });

  test('unmapped operation resolves to GENERIC_COMPLETION', async () => {
    const deps = makeDeps({ platformDefault: platformDefaultBinding, opMap: {} });
    const { plan, trace } = await resolveExecutionPlan({ operation: 'someUnknownOp', orgId: 'org1' }, deps);
    expect(plan.capabilityId).toBe('GENERIC_COMPLETION');
    expect(trace.steps[0].reasonCode).toBe('LEGACY_UNMAPPED_OPERATION');
  });
});

// ── Trace + override patch ────────────────────────────────────────────────────

describe('ConfigurationResolver — trace + override patch', () => {
  test('trace has sequential steps and a finish', async () => {
    const deps = makeDeps({ platformDefault: platformDefaultBinding });
    const { trace } = await resolveExecutionPlan({ capabilityId: 'CONTENT_WRITER' }, deps);
    trace.steps.forEach((s, i) => expect(s.sequence).toBe(i));
    expect(trace.steps.some((s) => s.decisionCode === 'SELECT_PROFILE')).toBe(true);
    expect(trace.steps[trace.steps.length - 1].step).toBe('finish');
  });

  test('override patch changes params AND the fingerprint', async () => {
    const patched: ResolverBindingRow = { ...platformDefaultBinding, overridePatch: { params: { temperature: 0.9 } } };
    const deps = makeDeps({ platformDefault: patched });
    const { plan } = await resolveExecutionPlan({ capabilityId: 'X', legacyProvider: 'openai', legacyModel: 'gpt-4o-mini' }, deps);
    expect(plan.params.temperature).toBe(0.9);
    expect(plan.configFingerprint).not.toBe(BALANCED_FINGERPRINT);
  });
});

// ── Comparator ────────────────────────────────────────────────────────────────

describe('ResolverComparator', () => {
  const plan: ResolvedExecutionPlan = {
    capabilityId: 'C', model: { provider: 'openai', model: 'gpt-4o-mini', modelVersion: null },
    params: { temperature: 0.4, maxOutputTokens: 2000, streaming: false, structuredOutput: false, vision: null },
    reliability: { timeoutMs: 60000, maxRetries: 2 }, limits: {}, caching: {}, source: 'platform_default',
  };

  test('MATCH when every compared field agrees (null==undefined)', () => {
    const legacy: LegacyExecutionConfig = { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, maxOutputTokens: 2000, streaming: false, structuredOutput: false, timeoutMs: 60000, maxRetries: 2 };
    const r = compareToLegacy(legacy, plan);
    expect(r.status).toBe('MATCH');
    expect(r.diffs).toHaveLength(0);
    expect(r.comparedFields).toContain('temperature');
  });

  test('MISMATCH surfaces field-level diffs', () => {
    const legacy: LegacyExecutionConfig = { provider: 'anthropic', model: 'gpt-4o-mini', temperature: 0.7, maxOutputTokens: 2000 };
    const r = compareToLegacy(legacy, plan);
    expect(r.status).toBe('MISMATCH');
    const fields = r.diffs.map((d) => d.field).sort();
    expect(fields).toContain('provider');
    expect(fields).toContain('temperature');
    const prov = r.diffs.find((d) => d.field === 'provider')!;
    expect(prov.legacy).toBe('anthropic');
    expect(prov.resolved).toBe('openai');
  });
});

// ── Shadow mode safety contract ───────────────────────────────────────────────

describe('runConfigResolverShadow — safety contract', () => {
  const FLAG_ENV = 'ROLLOUT_AI_CONFIG_RESOLVER_SHADOW_MODE';
  afterEach(() => { delete process.env[FLAG_ENV]; });

  // A full legacy config that faithfully mirrors the resolved BALANCED plan → MATCH.
  const legacy: LegacyExecutionConfig = {
    provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4, maxOutputTokens: 2000,
    streaming: false, structuredOutput: false, vision: null, timeoutMs: 60000, maxRetries: 2,
  };

  test('OFF (default) → resolver NEVER runs; sink never called; deps never touched', async () => {
    let depsTouched = false;
    const deps = makeDeps({ platformDefault: platformDefaultBinding, onCall: () => { depsTouched = true; } });
    const sink = jest.fn();
    const ran = await runConfigResolverShadow({ input: { capabilityId: 'CONTENT_WRITER', orgId: 'o' }, deps, legacy, sink });
    expect(ran).toBe(false);
    expect(sink).not.toHaveBeenCalled();
    expect(depsTouched).toBe(false);
  });

  test('ON → resolver runs, emits one observation, and discards (returns true)', async () => {
    process.env[FLAG_ENV] = 'shadow';
    const deps = makeDeps({ platformDefault: platformDefaultBinding });
    let observed: ShadowObservation | null = null;
    const ran = await runConfigResolverShadow({ input: { capabilityId: 'CONTENT_WRITER', legacyProvider: 'openai', legacyModel: 'gpt-4o-mini' }, deps, legacy, sink: (o) => { observed = o; } });
    expect(ran).toBe(true);
    expect(observed).not.toBeNull();
    expect(observed!.parity.status).toBe('MATCH');
    expect(observed!.configFingerprint).toBe(BALANCED_FINGERPRINT);
  });

  test('ON but deps throw → fail-safe: never throws, still returns true', async () => {
    process.env[FLAG_ENV] = 'enforce';
    const deps: ResolverDeps = {
      mapOperationToCapability: async () => { throw new Error('boom'); },
      loadBinding: async () => { throw new Error('boom'); },
      loadPlatformDefaultBinding: async () => { throw new Error('boom'); },
      loadActiveProfileVersion: async () => { throw new Error('boom'); },
    };
    await expect(runConfigResolverShadow({ input: { operation: 'x' }, deps, legacy })).resolves.toBe(true);
  });
});
