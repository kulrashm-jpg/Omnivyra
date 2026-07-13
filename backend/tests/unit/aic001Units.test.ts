/**
 * AIC-001 §2/§5/§6/§8 — pure framework units: registry, tool orchestration,
 * validation framework, and the deterministic recovery decision table.
 */

import { resolveCapability, isModelSupported, REGISTERED_CAPABILITIES } from '../../services/aiCapability/capabilityRegistry';
import { decideRecovery } from '../../services/aiCapability/capabilityRecovery';
import { orchestrateTools, buildToolPlan, type ToolSpec, type ToolContext } from '../../services/aiCapability/capabilityTools';
import { validateCapabilityOutput } from '../../services/aiCapability/capabilityValidation';

const ctx = (): ToolContext => ({ companyId: 'org1', input: {}, memo: {}, now: 'T0' });

describe('AIC-001 §2 — capability registry', () => {
  test('all nine capabilities registered and resolvable', () => {
    for (const id of ['CONTENT_WRITER', 'CONTENT_CREATOR', 'CAMPAIGN_PLANNER', 'STRATEGIC_MIX', 'SEO_INTELLIGENCE', 'GROWTH_INTELLIGENCE', 'RECOMMENDATION_ENGINE', 'COMPETITOR_INTELLIGENCE', 'WEBSITE_INTELLIGENCE']) {
      const def = resolveCapability(id);
      expect(def).not.toBeNull();
      expect(def!.id).toBe(id);
      expect(def!.knowledge.domains.length).toBeGreaterThan(0);
      expect(def!.supportedModels.length).toBeGreaterThan(0);
    }
    // 9 base capabilities; PMF-001 adds the migrated CONTENT_WRITER_WORKSPACE.
    expect(REGISTERED_CAPABILITIES.length).toBeGreaterThanOrEqual(9);
    expect(REGISTERED_CAPABILITIES).toContain('CONTENT_WRITER_WORKSPACE');
  });
  test('unknown capability → null; model support gate', () => {
    expect(resolveCapability('NOPE')).toBeNull();
    const def = resolveCapability('CONTENT_WRITER')!;
    expect(isModelSupported(def, 'claude-sonnet-5')).toBe(true);
    expect(isModelSupported(def, 'gpt-nonexistent')).toBe(false);
  });
});

describe('AIC-001 §8 — deterministic recovery', () => {
  const base = { attempt: 1, maxAttempts: 3, hasFallbackModel: true, fallbackModelUsed: false, partialAllowed: false };
  test('model error with unused fallback → fallback_model', () => {
    expect(decideRecovery({ ...base, failure: 'model_error' }).action).toBe('fallback_model');
  });
  test('validation failure with attempts left → retry', () => {
    expect(decideRecovery({ ...base, failure: 'validation_failure' }).action).toBe('retry');
  });
  test('attempts exhausted → fail (or partial when allowed)', () => {
    expect(decideRecovery({ ...base, failure: 'validation_failure', attempt: 3 }).action).toBe('fail');
    expect(decideRecovery({ ...base, failure: 'validation_failure', attempt: 3, partialAllowed: true }).action).toBe('partial');
  });
  test('no_knowledge is non-recoverable → fail/partial', () => {
    expect(decideRecovery({ ...base, failure: 'no_knowledge' }).action).toBe('fail');
    expect(decideRecovery({ ...base, failure: 'no_knowledge', partialAllowed: true }).action).toBe('partial');
  });
  test('fallback already used → retry not fallback', () => {
    expect(decideRecovery({ ...base, failure: 'model_error', fallbackModelUsed: true }).action).toBe('retry');
  });
  test('identical state → identical decision', () => {
    expect(decideRecovery({ ...base, failure: 'timeout' })).toEqual(decideRecovery({ ...base, failure: 'timeout' }));
  });
});

describe('AIC-001 §5 — tool orchestration', () => {
  const okTool = (id: string, output: unknown): ToolSpec => ({ id, run: async () => ({ ok: true, output, sources: [{ kind: 'tool', ref: id, tool: id }] }) });

  test('parallel tools run and produce summary + sources + outputs', async () => {
    const res = await orchestrateTools([{ spec: okTool('a', 1), mode: 'parallel' }, { spec: okTool('b', 2), mode: 'parallel' }], ctx());
    expect(res.summary.okCount).toBe(2);
    expect(res.outputs).toEqual({ a: 1, b: 2 });
    expect(res.sources.map((s) => s.ref).sort()).toEqual(['a', 'b']);
  });

  test('retry then fallback on failure', async () => {
    let calls = 0;
    const flaky: ToolSpec = {
      id: 'flaky', maxAttempts: 2,
      run: async () => { calls++; return { ok: false, output: null, error: 'boom' }; },
      fallback: { id: 'flaky_fb', run: async () => ({ ok: true, output: 'fb' }) },
    };
    const res = await orchestrateTools([{ spec: flaky, mode: 'sequential' }], ctx());
    expect(calls).toBe(2); // both attempts tried
    expect(res.summary.calls[0].fallbackUsed).toBe(true);
    expect(res.summary.calls[0].ok).toBe(true);
    expect(res.outputs.flaky).toBe('fb');
  });

  test('conditional tool skipped when when()=false', async () => {
    const gated: ToolSpec = { id: 'gated', when: () => false, run: async () => ({ ok: true, output: 'x' }) };
    const res = await orchestrateTools([{ spec: gated, mode: 'parallel' }], ctx());
    expect(res.summary.calls).toHaveLength(0);
  });

  test('idempotency memo dedupes identical work', async () => {
    let runs = 0;
    const c = ctx();
    const t: ToolSpec = { id: 'memoized', idempotencyKey: () => 'K', run: async () => { runs++; return { ok: true, output: runs }; } };
    await orchestrateTools([{ spec: t, mode: 'sequential' }], c);
    await orchestrateTools([{ spec: t, mode: 'sequential' }], c); // same memo → not re-run
    expect(runs).toBe(1);
  });

  test('buildToolPlan skips unknown ids', () => {
    const plan = buildToolPlan(['known', 'unknown'], { known: okTool('known', 1) });
    expect(plan).toHaveLength(1);
    expect(plan[0].spec.id).toBe('known');
  });
});

describe('AIC-001 §6 — validation framework', () => {
  const def = resolveCapability('CONTENT_WRITER')!;
  const okCtx = { sources: [{ kind: 'knowledge' as const, ref: 'k' }], confidence: 80, input: {}, knowledgeAvailable: true };

  test('schema passes with required key present and non-empty', () => {
    const v = validateCapabilityOutput(def, { body: 'hello' }, okCtx);
    expect(v.ok).toBe(true);
  });
  test('schema fails on missing/empty required key', () => {
    expect(validateCapabilityOutput(def, { body: '' }, okCtx).ok).toBe(false);
    expect(validateCapabilityOutput(def, {}, okCtx).ok).toBe(false);
    expect(validateCapabilityOutput(def, null, okCtx).ok).toBe(false);
  });
  test('grounding fails without sources', () => {
    const v = validateCapabilityOutput(def, { body: 'x' }, { ...okCtx, sources: [] });
    expect(v.checks.find((c) => c.kind === 'grounding')!.ok).toBe(false);
  });
  test('confidence threshold enforced', () => {
    const v = validateCapabilityOutput(def, { body: 'x' }, { ...okCtx, confidence: 10 });
    expect(v.checks.find((c) => c.kind === 'confidence')!.ok).toBe(false);
  });
  test('injected business + policy rules compose', () => {
    const v = validateCapabilityOutput(def, { body: 'x' }, okCtx, {
      business: () => 'bad', policy: () => null,
    });
    expect(v.checks.find((c) => c.kind === 'business')!.ok).toBe(false);
    expect(v.ok).toBe(false);
  });
});
