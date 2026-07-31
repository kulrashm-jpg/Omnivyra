/**
 * AI-ORCH 2B — Resolver Promotion control plane: authority gating (master enable
 * flag), promotion state machine, parity-gated selection, checklist/readiness, and
 * the failure/rollback policy. All pure; nothing executes.
 */
import { resolveExecutionAuthority, isResolverAuthorityEnabled } from '../../services/aiOrchestration/orchestrationMode';
import {
  getPromotionState, getLivePromotionState, getLivePromotionReadiness,
  selectExecutionConfiguration, recommendRollback, evaluatePromotionReadiness, nextStage,
} from '../../services/aiOrchestration/promotion';
import { getResolverShadowMetrics, getEquivalenceValidationReport, resetResolverShadowMetrics } from '../../services/aiOrchestration/resolverShadowMetrics';
import type { ConfigurationParityResult } from '../../services/aiOrchestration/configurationParityGuard';
import type { LegacyExecutionConfiguration } from '../../services/aiOrchestration/types/LegacyExecutionConfiguration';

const MODE = 'AI_CONFIG_RESOLVER_MODE';
const ENABLE = 'ROLLOUT_AI_CONFIG_RESOLVER_ENABLED_MODE';
afterEach(() => { delete process.env[MODE]; delete process.env[ENABLE]; });

const legacyCfg: LegacyExecutionConfiguration = { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4 };
const resolverCfg: LegacyExecutionConfiguration = { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.4 };
const guard = (over: Partial<ConfigurationParityResult> = {}): ConfigurationParityResult => ({
  parity: 'IDENTICAL', reason: '', differences: [], structuralMatch: true,
  snapshotHashExecuted: 'h', snapshotHashResolver: 'h', snapshotHashMatch: true,
  fingerprintExecuted: null, fingerprintResolver: null, fingerprintMatch: true,
  fieldCoverage: 1, ...over,
});

// ── Authority gating (master enable flag) ─────────────────────────────────────

describe('execution authority — master enable flag gating', () => {
  test('default: resolver NEVER executes, even in canary/full', () => {
    expect(isResolverAuthorityEnabled()).toBe(false);
    expect(resolveExecutionAuthority('canary').executes).toBe('legacy');
    expect(resolveExecutionAuthority('full').executes).toBe('legacy');
  });

  test('canary/full execute resolver ONLY when the enable flag is enforce', () => {
    process.env[ENABLE] = 'enforce';
    expect(isResolverAuthorityEnabled()).toBe(true);
    expect(resolveExecutionAuthority('canary').executes).toBe('resolver');
    expect(resolveExecutionAuthority('full').executes).toBe('resolver');
    // dual/shadow still legacy regardless of the enable flag.
    expect(resolveExecutionAuthority('dual').executes).toBe('legacy');
    expect(resolveExecutionAuthority('shadow').executes).toBe('legacy');
  });
});

// ── Promotion state machine ───────────────────────────────────────────────────

describe('promotion state machine', () => {
  test('maps mode → stage; resolverActive requires enable', () => {
    expect(getPromotionState(resolveExecutionAuthority('off')).stage).toBe('STAGE_0_OFF');
    expect(getPromotionState(resolveExecutionAuthority('dual')).stage).toBe('STAGE_2_DUAL');
    process.env[ENABLE] = 'enforce';
    const canary = getPromotionState(resolveExecutionAuthority('canary'));
    expect(canary.stage).toBe('STAGE_3_CANARY');
    expect(canary.resolverActive).toBe(true);
    expect(canary.legacyRetained).toBe(true);
  });

  test('default live state is STAGE_0_OFF, resolver inactive', () => {
    const s = getLivePromotionState();
    expect(s.stage).toBe('STAGE_0_OFF');
    expect(s.resolverActive).toBe(false);
  });

  test('nextStage guidance', () => {
    expect(nextStage('STAGE_2_DUAL')).toBe('STAGE_3_CANARY');
    expect(nextStage('STAGE_4_FULL')).toBeNull();
  });
});

// ── Parity-gated selection (byte-identical or legacy fallback) ────────────────

describe('selectExecutionConfiguration — parity-gated', () => {
  test('authority=legacy → legacy', () => {
    const sel = selectExecutionConfiguration(resolveExecutionAuthority('off'), legacyCfg, resolverCfg, guard());
    expect(sel.source).toBe('legacy');
  });

  test('authority=resolver + parity IDENTICAL → resolver (byte-identical)', () => {
    process.env[ENABLE] = 'enforce';
    const sel = selectExecutionConfiguration(resolveExecutionAuthority('full'), legacyCfg, resolverCfg, guard());
    expect(sel.source).toBe('resolver');
  });

  test('authority=resolver + parity DIFFERENT → legacy FALLBACK (never diverges)', () => {
    process.env[ENABLE] = 'enforce';
    const sel = selectExecutionConfiguration(
      resolveExecutionAuthority('full'), legacyCfg, resolverCfg,
      guard({ parity: 'DIFFERENT', snapshotHashMatch: false }),
    );
    expect(sel.source).toBe('legacy');
    expect(sel.reason).toContain('fallback');
  });
});

// ── Failure / rollback policy ─────────────────────────────────────────────────

describe('recommendRollback', () => {
  beforeEach(() => resetResolverShadowMetrics());
  test('clean metrics → no rollback', () => {
    expect(recommendRollback(getResolverShadowMetrics()).rollback).toBe(false);
  });
  test('any divergence → rollback', () => {
    const m = { ...getResolverShadowMetrics(), configParityDifferent: 1 };
    expect(recommendRollback(m).rollback).toBe(true);
    expect(recommendRollback(m).reasons.length).toBeGreaterThan(0);
  });
});

// ── Evidence-driven checklist ─────────────────────────────────────────────────

describe('evaluatePromotionReadiness', () => {
  beforeEach(() => resetResolverShadowMetrics());

  test('no observations → HOLD (not ready)', () => {
    const r = evaluatePromotionReadiness('STAGE_3_CANARY', getResolverShadowMetrics(), getEquivalenceValidationReport());
    expect(r.ready).toBe(false);
    expect(r.recommendation).toBe('HOLD');
  });

  test('all criteria pass → PROMOTE', () => {
    const metrics = { ...getResolverShadowMetrics(), executionDifferences: 0, configParityDifferent: 0 };
    const report = {
      ...getEquivalenceValidationReport(),
      structuralParityRate: 1, snapshotParityRate: 1, adapterParityRate: 1, dualExecutions: 100,
    };
    const r = evaluatePromotionReadiness('STAGE_3_CANARY', metrics, report);
    expect(r.ready).toBe(true);
    expect(r.recommendation).toBe('PROMOTE');
  });

  test('divergence → ROLLBACK (overrides everything)', () => {
    const metrics = { ...getResolverShadowMetrics(), configParityDifferent: 3 };
    const report = { ...getEquivalenceValidationReport(), structuralParityRate: 1, snapshotParityRate: 1, adapterParityRate: 1, dualExecutions: 100 };
    const r = evaluatePromotionReadiness('STAGE_3_CANARY', metrics, report);
    expect(r.recommendation).toBe('ROLLBACK');
    expect(r.ready).toBe(false);
  });

  test('live readiness (default env) → HOLD', () => {
    resetResolverShadowMetrics();
    expect(getLivePromotionReadiness().recommendation).toBe('HOLD');
  });
});
