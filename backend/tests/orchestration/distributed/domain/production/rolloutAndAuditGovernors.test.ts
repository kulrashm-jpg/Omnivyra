/**
 * Phase 27B.5 + 27B.6 — replay-audit + rollout-stage governor tests.
 */

import {
  ProductionRuntimeRolloutGovernor,
  RolloutGovernorError,
} from '../../../../../services/orchestration/distributed/domain/production/productionRuntimeRolloutGovernor';
import {
  ReplayAuditEnforcementGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/replayAuditEnforcementGovernor';

describe('ProductionRuntimeRolloutGovernor', () => {
  test('one-step forward transition allowed', () => {
    const gov = new ProductionRuntimeRolloutGovernor({
      initialStage: 'disabled',
      telemetry: { emit: () => {} },
    });
    expect(gov.applyTransition('shadow_only').toStage).toBe('shadow_only');
    expect(gov.getStage()).toBe('shadow_only');
  });

  test('forbidden jump refused', () => {
    const gov = new ProductionRuntimeRolloutGovernor({
      initialStage: 'disabled',
      telemetry: { emit: () => {} },
    });
    expect(() => gov.applyTransition('full_runtime_live')).toThrow(RolloutGovernorError);
    expect(gov.getStage()).toBe('disabled');
  });

  test('downgrade always allowed', () => {
    const gov = new ProductionRuntimeRolloutGovernor({
      initialStage: 'staged_provider_rollout',
      telemetry: { emit: () => {} },
    });
    const res = gov.applyTransition('disabled');
    expect(res.direction).toBe('downgrade');
    expect(gov.getStage()).toBe('disabled');
  });

  test('freeze blocks forward but allows downgrade', () => {
    const gov = new ProductionRuntimeRolloutGovernor({
      initialStage: 'single_provider_live',
      telemetry: { emit: () => {} },
    });
    gov.freeze('replay audit breach');
    expect(() => gov.applyTransition('staged_provider_rollout')).toThrow(RolloutGovernorError);
    expect(gov.applyTransition('publish_disabled').direction).toBe('downgrade');
  });

  test('provider-stage compatibility', () => {
    const gov = new ProductionRuntimeRolloutGovernor({
      initialStage: 'publish_disabled',
      telemetry: { emit: () => {} },
    });
    const v = gov.validateProviderStageCompatibility({ provider: 'x', publishRequested: true });
    expect(v.allowed).toBe(false);
    const v2 = gov.validateProviderStageCompatibility({ provider: 'x', publishRequested: false });
    expect(v2.allowed).toBe(true);
  });
});

describe('ReplayAuditEnforcementGovernor', () => {
  test('zero-tolerance adapter duplicate triggers freeze', () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const gov = new ReplayAuditEnforcementGovernor({
      telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    });
    gov.recordAdapterDuplicate({ provider: 'x', scheduledPostId: 'sp-1' });
    expect(gov.isFreezeRecommended().frozen).toBe(true);
    expect(events.some((e) => e.event === 'replay_audit_rollout_freeze_recommended')).toBe(true);
    expect(gov.evaluatePromotion().allowed).toBe(false);
  });

  test('high enqueue divergence ratio triggers freeze', () => {
    const gov = new ReplayAuditEnforcementGovernor({
      telemetry: { emit: () => {} },
    });
    // 50 enqueues, 2 divergent = 4% > 1% threshold.
    for (let i = 0; i < 48; i++) gov.recordEnqueue({ divergent: false });
    gov.recordEnqueue({ divergent: true });
    gov.recordEnqueue({ divergent: true });
    expect(gov.isFreezeRecommended().frozen).toBe(true);
  });

  test('long-form collision rate breach', () => {
    const gov = new ReplayAuditEnforcementGovernor({
      telemetry: { emit: () => {} },
    });
    // 1 collision in ~10 claims is 10% > 2% threshold.
    for (let i = 0; i < 9; i++) gov.recordLongFormClaim({ collision: false });
    gov.recordLongFormClaim({ collision: true });
    const breach = gov.evaluatePromotion();
    expect(breach.allowed).toBe(false);
    expect(breach.breaches).toContain('long_form_collision_rate');
  });

  test('within thresholds permits promotion', () => {
    const gov = new ReplayAuditEnforcementGovernor({
      telemetry: { emit: () => {} },
    });
    // 100 calls, 1 short-circuit = 1% < 5% threshold.
    for (let i = 0; i < 99; i++) gov.recordGateCall({ shortCircuited: false });
    gov.recordGateCall({ shortCircuited: true });
    expect(gov.evaluatePromotion().allowed).toBe(true);
  });

  test('rollback recommendation produced on breach', () => {
    const gov = new ReplayAuditEnforcementGovernor({
      telemetry: { emit: () => {} },
    });
    gov.recordAdapterDuplicate({ provider: 'x', scheduledPostId: 'sp-1' });
    const rec = gov.generateRollbackRecommendation();
    expect(rec.recommended).toBe(true);
    expect(rec.suggestedAction).toBe('downgrade');
    expect(rec.reasons).toContain('adapter_duplicate_detected');
  });

  test('snapshot reports current state', () => {
    const gov = new ReplayAuditEnforcementGovernor({
      telemetry: { emit: () => {} },
    });
    gov.recordGateCall({ shortCircuited: true });
    gov.recordGateCall({ shortCircuited: false });
    const snap = gov.snapshot();
    expect(snap.totals.gateCalls).toBe(2);
    expect(snap.totals.gateShortCircuits).toBe(1);
    expect(snap.gate_short_circuit_rate).toBeCloseTo(0.5);
  });
});
