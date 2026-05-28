/**
 * Phase 24E — DomainReplayGovernor unit tests.
 */

import {
  createDomainReplayGovernor,
} from '../../../../services/orchestration/distributed/domain/domainReplayGovernor';
import type {
  HydratedQueuePayload,
  QueuePayloadV1,
  WorkflowType,
} from '../../../../services/orchestration/distributed/workflowExecutionTypes';

function makeHydrated(opts: {
  workflowType: WorkflowType;
  workflowParams: Record<string, unknown>;
  completed?: string[];
  pending?: string[];
}): HydratedQueuePayload {
  const payload: QueuePayloadV1 = {
    schemaVersion: 1, workflowType: opts.workflowType,
    executionId: 'e', companyId: 'co',
    workflowParams: opts.workflowParams,
  };
  return {
    payload,
    queueEntry: {
      queueEntryId: 'qe', executionId: 'e', companyId: 'co',
      kind: 'execution_start', status: 'claimed', priority: 50,
      runAtIso: '2026-01-01T00:00:00Z', visibilityDeadlineIso: null,
      claimedByWorkerId: 'w', attemptCount: 1, maxAttempts: 5,
      dedupKey: 'k', payload: null, resultPayload: null,
      failureReason: null,
      createdAtIso: '2026-01-01T00:00:00Z', updatedAtIso: '2026-01-01T00:00:00Z',
    },
    execution: {
      executionId: 'e', runtimeSessionId: 'rs', threadId: 'thr',
      companyId: 'co', orchestrationPhase: 'precheck',
      executionStatus: 'running', executionOwner: null,
      retryCount: 0, recoveryState: 'idle',
      startedAt: '2026-01-01T00:00:00Z',
      heartbeatAt: null, completedAt: null,
      failureReason: null, replayCheckpointId: null,
    },
    restored: opts.completed || opts.pending ? {
      executionId: 'e', latestCheckpointId: 'cp',
      phase: 'generation',
      completedNodeOperationIds: opts.completed ?? [],
      pendingNodeOperationIds: opts.pending ?? [],
      pendingTopologyMutationIds: [],
      recoveryProgress: null, replayContinuity: null,
      chain: [],
      integrity: { status: 'intact', integrityScore: 100, issues: [], phaseTransitions: 0, windowStartIso: null, windowEndIso: null },
    } : null,
  };
}

describe('DomainReplayGovernor', () => {
  test('generic workflowType passes through as eligible', () => {
    const g = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
    const v = g.validate(makeHydrated({
      workflowType: 'content_generation',
      workflowParams: {},
    }));
    expect(v.ok).toBe(true);
    expect(v.code).toBe('eligible');
  });

  test('long-form fully complete → duplicate_long_form_generation (suppress)', () => {
    const g = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
    const v = g.validate(makeHydrated({
      workflowType: 'long_form_generation',
      workflowParams: { generationId: 'g1', sectionIds: ['s1', 's2'] },
      completed: ['lf_gen_s1', 'lf_gen_s2', 'lf_finalize'],
    }));
    expect(v.code).toBe('duplicate_long_form_generation');
    expect(v.recommendedAction).toBe('suppress');
  });

  test('long-form partial complete → eligible', () => {
    const g = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
    const v = g.validate(makeHydrated({
      workflowType: 'long_form_generation',
      workflowParams: { generationId: 'g1', sectionIds: ['s1', 's2'] },
      completed: ['lf_gen_s1'],
    }));
    expect(v.ok).toBe(true);
  });

  test('social_publish with completed publish step → duplicate_publish', () => {
    const g = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
    const v = g.validate(makeHydrated({
      workflowType: 'social_publish',
      workflowParams: {
        provider: 'x', socialAccountId: 'a', scheduledPostId: 'sp',
        contentFingerprint: 'fp',
      },
      completed: ['sp_publish_x_fp'],
    }));
    expect(v.code).toBe('duplicate_publish');
    expect(v.recommendedAction).toBe('suppress');
  });

  test('social_publish missing fingerprint → missing_required_field (fail)', () => {
    const g = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
    const v = g.validate(makeHydrated({
      workflowType: 'social_publish',
      workflowParams: { provider: 'x' },
    }));
    expect(v.recommendedAction).toBe('fail');
  });

  test('campaign fully complete → duplicate_campaign_post (suppress)', () => {
    const g = createDomainReplayGovernor({ telemetry: { emit: () => {} } });
    const v = g.validate(makeHydrated({
      workflowType: 'campaign_execution',
      workflowParams: { campaignId: 'c1', posts: [{ postId: 'p1' }, { postId: 'p2' }] },
      completed: ['camp_post_p1', 'camp_post_p2', 'camp_finalize'],
    }));
    expect(v.code).toBe('duplicate_campaign_post');
  });

  test('reconciliation suppression window prevents back-to-back', () => {
    const g = createDomainReplayGovernor({
      telemetry: { emit: () => {} },
      reconciliationSuppressionMs: 60_000,
    });
    const payload = makeHydrated({
      workflowType: 'provider_reconciliation',
      workflowParams: { rowId: 'r1', provider: 'instagram' },
    });
    const a = g.validate(payload);
    const b = g.validate(payload);
    expect(a.ok).toBe(true);
    expect(b.code).toBe('reconciliation_within_window');
  });

  test('reconciliation outside window → eligible', () => {
    const g = createDomainReplayGovernor({
      telemetry: { emit: () => {} },
      reconciliationSuppressionMs: 0, // disable suppression
    });
    const payload = makeHydrated({
      workflowType: 'provider_reconciliation',
      workflowParams: { rowId: 'r1', provider: 'instagram' },
    });
    const a = g.validate(payload);
    const b = g.validate(payload);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});
