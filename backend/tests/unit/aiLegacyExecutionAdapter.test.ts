/**
 * AI-ORCH 2A-2.3 — LegacyExecutionAdapter + AdapterValidator round-trip.
 *
 * Proves the adapter is a pure deterministic 1:1 mapper, that its output round-trips
 * to an IDENTICAL execution snapshot (not merely semantically equivalent), that every
 * mapped field is verified, and that metrics/report update.
 */
import {
  LegacyExecutionAdapter,
  AdapterValidator,
} from '../../services/aiOrchestration/legacyExecutionAdapter';
import {
  recordAdapterParity,
  getResolverShadowMetrics,
  getEquivalenceValidationReport,
  resetResolverShadowMetrics,
} from '../../services/aiOrchestration/resolverShadowMetrics';
import type { ResolvedExecutionPlan } from '../../services/aiOrchestration/types/ResolvedExecutionPlan';

function plan(over: Partial<ResolvedExecutionPlan> = {}): ResolvedExecutionPlan {
  return {
    capabilityId: 'CONTENT_WRITER', operation: 'op', orgId: 'org1', source: 'platform_default',
    profileId: 'p1', profileKey: 'BALANCED', profileVersion: 1,
    model: { provider: 'openai', model: 'gpt-4o-mini', modelVersion: null, deploymentId: null },
    params: { temperature: 0.4, maxOutputTokens: 2000, seedPolicy: 'none', streaming: false, structuredOutput: false, vision: false },
    reliability: { timeoutMs: 60000, maxRetries: 2, partialAllowed: false },
    limits: {}, caching: { cacheable: true }, safety: { moderation: 'off', prompt_injection_guard: false },
    routingPolicyId: null, routingPolicyKey: null,
    configFingerprint: 'sha256:v1:deadbeef', ...over,
  };
}

describe('LegacyExecutionAdapter — pure 1:1 mapper', () => {
  test('maps every documented field from the plan', () => {
    const cfg = LegacyExecutionAdapter.toLegacyConfiguration(plan());
    expect(cfg.provider).toBe('openai');
    expect(cfg.model).toBe('gpt-4o-mini');
    expect(cfg.temperature).toBe(0.4);
    expect(cfg.maxOutputTokens).toBe(2000);
    expect(cfg.timeoutMs).toBe(60000);
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.streaming).toBe(false);
    expect(cfg.structuredOutput).toBe(false);
    expect(cfg.vision).toBe(false);
    expect(cfg.seedPolicy).toBe('none');
    expect(cfg.safety).toEqual({ moderation: 'off', prompt_injection_guard: false });
    expect(cfg.cachePolicy).toEqual({ cacheable: true });
    expect(cfg.configFingerprint).toBe('sha256:v1:deadbeef'); // diagnostic only
  });

  test('is deterministic — repeated runs are identical', () => {
    expect(LegacyExecutionAdapter.toLegacyConfiguration(plan())).toEqual(LegacyExecutionAdapter.toLegacyConfiguration(plan()));
  });

  test('missing optional fields map to null (no invented values)', () => {
    const cfg = LegacyExecutionAdapter.toLegacyConfiguration(plan({ params: { temperature: 0.4 } as any }));
    expect(cfg.topP).toBeNull();
    expect(cfg.presencePenalty).toBeNull();
    expect(cfg.frequencyPenalty).toBeNull();
    expect(cfg.reasoning).toBeNull();
  });
});

describe('AdapterValidator — round-trip snapshot identity', () => {
  test('adapter output round-trips to an IDENTICAL execution snapshot', () => {
    const r = AdapterValidator.validate(plan());
    expect(r.parity).toBe('IDENTICAL');
    expect(r.differences).toHaveLength(0);
    expect(r.snapshotHashMatch).toBe(true);
    expect(r.snapshotHashPlan).toBe(r.snapshotHashAdapter);
  });

  test('IDENTICAL holds across varied plans (explicit + tier fields)', () => {
    for (const p of [
      plan(),
      plan({ params: { temperature: 0.9, maxOutputTokens: 4000, streaming: true, seedPolicy: 'fixed' } }),
      plan({ model: { provider: 'anthropic', model: 'claude-haiku-4-5', modelVersion: 'claude-haiku-4-5-20251001', deploymentId: null } }),
      plan({ reliability: { timeoutMs: 240000, maxRetries: 0 }, limits: { maxCostUsdPerCall: 0.5, tokenCeiling: 8000 } }),
    ]) {
      expect(AdapterValidator.validate(p).parity).toBe('IDENTICAL');
    }
  });

  test('is deterministic — repeated validation identical', () => {
    expect(AdapterValidator.validate(plan())).toEqual(AdapterValidator.validate(plan()));
  });
});

describe('adapter metrics + report', () => {
  beforeEach(() => resetResolverShadowMetrics());

  test('recordAdapterParity updates counters + report (100% parity)', () => {
    recordAdapterParity(AdapterValidator.validate(plan()));
    recordAdapterParity(AdapterValidator.validate(plan({ params: { temperature: 0.7 } as any })));
    const m = getResolverShadowMetrics();
    expect(m.adapterInvocations).toBe(2);
    expect(m.adapterIdentical).toBe(2);
    expect(m.adapterDifferent).toBe(0);
    const report = getEquivalenceValidationReport();
    expect(report.adapterInvocations).toBe(2);
    expect(report.adapterParityRate).toBe(1);
    expect(report.topAdapterDifferences).toEqual([]);
  });
});
