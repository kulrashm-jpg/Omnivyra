/**
 * Phase 26F — Domain continuity rules unit tests.
 */

import {
  longFormPartialGenerationContinuationRule,
  publishReplaySuppressionRule,
  campaignReplayContinuationRule,
  reconciliationReplaySuppressionRule,
  getAllDomainContinuityRules,
} from '../../../../../services/orchestration/distributed/domain/production/domainContinuityRules';
import type {
  HydratedQueuePayload,
  QueuePayloadV1,
  WorkflowType,
} from '../../../../../services/orchestration/distributed/workflowExecutionTypes';

function makeHydrated(opts: {
  workflowType: WorkflowType;
  workflowParams: Record<string, unknown>;
  completed?: string[];
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
    restored: opts.completed ? {
      executionId: 'e', latestCheckpointId: 'cp',
      phase: 'generation',
      completedNodeOperationIds: opts.completed,
      pendingNodeOperationIds: [], pendingTopologyMutationIds: [],
      recoveryProgress: null, replayContinuity: null,
      chain: [], integrity: { status: 'intact', integrityScore: 100, issues: [], phaseTransitions: 0, windowStartIso: null, windowEndIso: null },
    } : null,
  };
}

describe('longFormPartialGenerationContinuationRule', () => {
  test('null payload (no sectionIds) returns null (defers)', () => {
    expect(longFormPartialGenerationContinuationRule.evaluate(makeHydrated({
      workflowType: 'long_form_generation',
      workflowParams: { generationId: 'g1', sectionIds: [] },
    }))).toBeNull();
  });

  test('all sections + finalize complete → suppress', () => {
    const v = longFormPartialGenerationContinuationRule.evaluate(makeHydrated({
      workflowType: 'long_form_generation',
      workflowParams: { generationId: 'g1', sectionIds: ['s1', 's2'] },
      completed: ['lf_gen_s1', 'lf_gen_s2', 'lf_finalize'],
    }));
    expect(v?.recommendedAction).toBe('suppress');
  });

  test('partial completion returns null (defers)', () => {
    expect(longFormPartialGenerationContinuationRule.evaluate(makeHydrated({
      workflowType: 'long_form_generation',
      workflowParams: { generationId: 'g1', sectionIds: ['s1', 's2'] },
      completed: ['lf_gen_s1'],
    }))).toBeNull();
  });
});

describe('publishReplaySuppressionRule', () => {
  test('publish step in completed_set → suppress', () => {
    const v = publishReplaySuppressionRule.evaluate(makeHydrated({
      workflowType: 'social_publish',
      workflowParams: {
        provider: 'x', socialAccountId: 'acc',
        scheduledPostId: 'sp', contentFingerprint: 'fp1',
      },
      completed: ['sp_publish_x_fp1'],
    }));
    expect(v?.recommendedAction).toBe('suppress');
  });

  test('publish step NOT in completed_set → defers', () => {
    expect(publishReplaySuppressionRule.evaluate(makeHydrated({
      workflowType: 'social_publish',
      workflowParams: {
        provider: 'x', socialAccountId: 'acc',
        scheduledPostId: 'sp', contentFingerprint: 'fp1',
      },
      completed: [],
    }))).toBeNull();
  });

  test('missing provider/fingerprint → defers', () => {
    expect(publishReplaySuppressionRule.evaluate(makeHydrated({
      workflowType: 'social_publish',
      workflowParams: {},
    }))).toBeNull();
  });
});

describe('campaignReplayContinuationRule', () => {
  test('all posts + finalize complete → suppress', () => {
    const v = campaignReplayContinuationRule.evaluate(makeHydrated({
      workflowType: 'campaign_execution',
      workflowParams: { campaignId: 'c1', posts: [{ postId: 'p1' }, { postId: 'p2' }] },
      completed: ['camp_post_p1', 'camp_post_p2', 'camp_finalize'],
    }));
    expect(v?.recommendedAction).toBe('suppress');
  });

  test('partial campaign returns null', () => {
    expect(campaignReplayContinuationRule.evaluate(makeHydrated({
      workflowType: 'campaign_execution',
      workflowParams: { campaignId: 'c1', posts: [{ postId: 'p1' }, { postId: 'p2' }] },
      completed: ['camp_post_p1'],
    }))).toBeNull();
  });
});

describe('reconciliationReplaySuppressionRule', () => {
  test('apply step in completed_set → suppress', () => {
    const v = reconciliationReplaySuppressionRule.evaluate(makeHydrated({
      workflowType: 'provider_reconciliation',
      workflowParams: { rowId: 'r1', provider: 'instagram' },
      completed: ['rec_apply_r1'],
    }));
    expect(v?.recommendedAction).toBe('suppress');
  });

  test('apply step NOT in completed_set → defers', () => {
    expect(reconciliationReplaySuppressionRule.evaluate(makeHydrated({
      workflowType: 'provider_reconciliation',
      workflowParams: { rowId: 'r1', provider: 'instagram' },
      completed: [],
    }))).toBeNull();
  });
});

describe('getAllDomainContinuityRules', () => {
  test('returns all four rules in order', () => {
    const rules = getAllDomainContinuityRules();
    expect(rules).toHaveLength(4);
    expect(rules.map((r) => r.workflowType)).toEqual([
      'long_form_generation',
      'social_publish',
      'campaign_execution',
      'provider_reconciliation',
    ]);
  });
});
