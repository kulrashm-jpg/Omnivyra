/**
 * Phase 27B.8 — rollback governor tests.
 */

import {
  ProductionRuntimeRolloutGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/productionRuntimeRolloutGovernor';
import {
  ReplayAuditEnforcementGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/replayAuditEnforcementGovernor';
import {
  ProductionRollbackGovernor,
} from '../../../../../services/orchestration/distributed/domain/production/productionRollbackGovernor';

function setupGovernors(opts?: { autoApplyDowngrade?: boolean; initialStage?: 'single_provider_live' | 'staged_provider_rollout' | 'full_runtime_live' }) {
  const rolloutGov = new ProductionRuntimeRolloutGovernor({
    initialStage: opts?.initialStage ?? 'single_provider_live',
    telemetry: { emit: () => {} },
  });
  const auditGov = new ReplayAuditEnforcementGovernor({
    telemetry: { emit: () => {} },
  });
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const rollbackGov = new ProductionRollbackGovernor({
    rolloutGovernor: rolloutGov,
    replayAuditGovernor: auditGov,
    telemetry: { emit: (event, payload) => events.push({ event, payload }) },
    autoApplyDowngrade: opts?.autoApplyDowngrade ?? false,
  });
  return { rolloutGov, auditGov, rollbackGov, events };
}

describe('ProductionRollbackGovernor', () => {
  test('irreversible mutation anomaly freezes rollout', () => {
    const { rolloutGov, rollbackGov, events } = setupGovernors();
    rollbackGov.recordIrreversibleAnomaly('platform_post_id overwrite detected');
    expect(rolloutGov.isFrozen().frozen).toBe(true);
    expect(events.some((e) => e.event === 'rollback_freeze_applied')).toBe(true);
    expect(events.some((e) => e.event === 'rollback_critical_alert')).toBe(true);
  });

  test('adapter duplicate triggers rollback via audit signals', () => {
    const { auditGov, rollbackGov } = setupGovernors();
    auditGov.recordAdapterDuplicate({ provider: 'x', scheduledPostId: 'sp-1' });
    const evalRes = rollbackGov.evaluateAuditSignals();
    expect(evalRes.triggered).toBe(true);
    expect(evalRes.triggers.some((t) => t.kind === 'adapter_duplicate_detected')).toBe(true);
    expect(rollbackGov.snapshot().rollbackRecommended).toBe(true);
  });

  test('autoApplyDowngrade transitions to publish_disabled on zero-tolerance trigger', () => {
    const { rolloutGov, rollbackGov, events } = setupGovernors({
      autoApplyDowngrade: true,
      initialStage: 'full_runtime_live',
    });
    rollbackGov.recordIrreversibleAnomaly('UPDATE_LOST');
    expect(rolloutGov.getStage()).toBe('publish_disabled');
    expect(events.some((e) => e.event === 'rollback_force_downgrade_applied')).toBe(true);
  });

  test('replay divergence spike threshold respected', () => {
    const { rollbackGov } = setupGovernors();
    rollbackGov.recordReplayDivergenceSpike('first divergence');
    expect(rollbackGov.snapshot().triggersFired.length).toBe(1);
  });

  test('snapshot exposes triggers + action', () => {
    const { auditGov, rollbackGov } = setupGovernors();
    auditGov.recordAdapterDuplicate({ provider: 'x', scheduledPostId: 'sp' });
    rollbackGov.evaluateAuditSignals();
    const snap = rollbackGov.snapshot();
    expect(snap.rollbackRecommended).toBe(true);
    expect(snap.suggestedAction).toBe('downgrade');
  });
});
