/**
 * Phase 24A-D — Domain builder unit tests.
 */

import {
  createLongFormWorkflowStepBuilder,
  LongFormBuilderError,
  LONG_FORM_STEP_IDS,
} from '../../../../services/orchestration/distributed/domain/longFormWorkflowStepBuilder';
import {
  createCampaignWorkflowStepBuilder,
  CampaignBuilderError,
  CAMPAIGN_STEP_IDS,
} from '../../../../services/orchestration/distributed/domain/campaignWorkflowStepBuilder';
import {
  createSocialPublishWorkflowStepBuilder,
  SocialPublishBuilderError,
  SOCIAL_PUBLISH_STEP_IDS,
} from '../../../../services/orchestration/distributed/domain/socialPublishWorkflowStepBuilder';
import {
  createProviderReconciliationWorkflowStepBuilder,
  ReconciliationBuilderError,
  RECONCILIATION_STEP_IDS,
} from '../../../../services/orchestration/distributed/domain/providerReconciliationWorkflowStepBuilder';
import type {
  HydratedQueuePayload,
  QueuePayloadV1,
  WorkflowType,
} from '../../../../services/orchestration/distributed/workflowExecutionTypes';

function makeHydrated(workflowType: WorkflowType, workflowParams: Record<string, unknown>): HydratedQueuePayload {
  const payload: QueuePayloadV1 = {
    schemaVersion: 1, workflowType,
    executionId: 'e', companyId: 'co',
    workflowParams,
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
      executionStatus: 'pending', executionOwner: null,
      retryCount: 0, recoveryState: 'idle',
      startedAt: '2026-01-01T00:00:00Z',
      heartbeatAt: null, completedAt: null,
      failureReason: null, replayCheckpointId: null,
    },
    restored: null,
  };
}

describe('LongFormWorkflowStepBuilder', () => {
  test('throws when runGenerationSection hook missing', () => {
    expect(() => createLongFormWorkflowStepBuilder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceHooks: {} as any,
    })).toThrow(LongFormBuilderError);
  });

  test('builds precheck + gen + finalize when only minimum hook supplied', async () => {
    const b = createLongFormWorkflowStepBuilder({
      serviceHooks: { runGenerationSection: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('long_form_generation', {
        subType: 'long_form_generation', generationId: 'g1',
        sectionIds: ['s1', 's2'],
      }),
    });
    const ids = out.steps.map((s) => s.id);
    expect(ids).toContain(LONG_FORM_STEP_IDS.precheck);
    expect(ids).toContain(LONG_FORM_STEP_IDS.generation('s1'));
    expect(ids).toContain(LONG_FORM_STEP_IDS.generation('s2'));
    expect(ids).toContain(LONG_FORM_STEP_IDS.finalize);
  });

  test('attaches per-section idempotency hints', async () => {
    const b = createLongFormWorkflowStepBuilder({
      serviceHooks: { runGenerationSection: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('long_form_generation', {
        subType: 'long_form_generation', generationId: 'g1',
        sectionIds: ['s1'],
      }),
    });
    const s1Step = out.steps.find((s) => s.id === LONG_FORM_STEP_IDS.generation('s1'));
    expect(s1Step?.idempotency?.cls).toBe('node_insert');
  });

  test('includes enrichment + recommendation when hooks present', async () => {
    const b = createLongFormWorkflowStepBuilder({
      serviceHooks: {
        runGenerationSection: async () => {},
        runEnrichment: async () => {},
        runRecommendationCard: async () => {},
      },
    });
    const out = await b.build({
      hydrated: makeHydrated('long_form_generation', {
        subType: 'long_form_generation', generationId: 'g1',
        sectionIds: ['s1'],
      }),
    });
    const ids = out.steps.map((s) => s.id);
    expect(ids).toContain(LONG_FORM_STEP_IDS.enrichment);
    expect(ids).toContain(LONG_FORM_STEP_IDS.recommendationCard);
  });
});

describe('CampaignWorkflowStepBuilder', () => {
  test('throws when runPost hook missing', () => {
    expect(() => createCampaignWorkflowStepBuilder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceHooks: {} as any,
    })).toThrow(CampaignBuilderError);
  });

  test('builds per-post + finalize', async () => {
    const b = createCampaignWorkflowStepBuilder({
      serviceHooks: { runPost: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('campaign_execution', {
        subType: 'campaign_execution', campaignId: 'c1',
        posts: [{ postId: 'p1' }, { postId: 'p2' }],
      }),
    });
    const ids = out.steps.map((s) => s.id);
    expect(ids).toContain(CAMPAIGN_STEP_IDS.precheck);
    expect(ids).toContain(CAMPAIGN_STEP_IDS.post('p1'));
    expect(ids).toContain(CAMPAIGN_STEP_IDS.post('p2'));
    expect(ids).toContain(CAMPAIGN_STEP_IDS.finalize);
  });

  test('per-post idempotency uses campaign + post id', async () => {
    const b = createCampaignWorkflowStepBuilder({
      serviceHooks: { runPost: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('campaign_execution', {
        subType: 'campaign_execution', campaignId: 'c1',
        posts: [{ postId: 'p1' }],
      }),
    });
    const post = out.steps.find((s) => s.id === CAMPAIGN_STEP_IDS.post('p1'));
    expect(post?.idempotency?.semanticParts).toContain('p1');
    expect(post?.idempotency?.semanticParts).toContain('c1');
  });
});

describe('SocialPublishWorkflowStepBuilder', () => {
  test('throws on missing runProviderPublish', () => {
    expect(() => createSocialPublishWorkflowStepBuilder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceHooks: {} as any,
    })).toThrow(SocialPublishBuilderError);
  });

  test('throws on invalid provider in payload', async () => {
    const b = createSocialPublishWorkflowStepBuilder({
      serviceHooks: { runProviderPublish: async () => {} },
    });
    await expect(b.build({
      hydrated: makeHydrated('social_publish', {
        subType: 'social_publish', provider: 'bogus',
        socialAccountId: 'a', scheduledPostId: 'sp', contentFingerprint: 'fp',
      }),
    })).rejects.toThrow(SocialPublishBuilderError);
  });

  test('builds publish step with fingerprint-based id', async () => {
    const b = createSocialPublishWorkflowStepBuilder({
      serviceHooks: { runProviderPublish: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('social_publish', {
        subType: 'social_publish', provider: 'x',
        socialAccountId: 'a', scheduledPostId: 'sp', contentFingerprint: 'fp123',
      }),
    });
    expect(out.steps.map((s) => s.id)).toContain(SOCIAL_PUBLISH_STEP_IDS.publish('x', 'fp123'));
  });

  test('publish step idempotency includes (provider, account, fingerprint, threadRoot)', async () => {
    const b = createSocialPublishWorkflowStepBuilder({
      serviceHooks: { runProviderPublish: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('social_publish', {
        subType: 'social_publish', provider: 'linkedin',
        socialAccountId: 'acc', scheduledPostId: 'sp',
        contentFingerprint: 'fp', threadRootId: 'thread1',
      }),
    });
    const publishStep = out.steps.find((s) => s.id.startsWith('sp_publish_'));
    expect(publishStep?.idempotency?.semanticParts).toContain('linkedin');
    expect(publishStep?.idempotency?.semanticParts).toContain('acc');
    expect(publishStep?.idempotency?.semanticParts).toContain('fp');
    expect(publishStep?.idempotency?.semanticParts).toContain('thread1');
  });
});

describe('ProviderReconciliationWorkflowStepBuilder', () => {
  test('throws on missing runReconcileRow', () => {
    expect(() => createProviderReconciliationWorkflowStepBuilder({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceHooks: {} as any,
    })).toThrow(ReconciliationBuilderError);
  });

  test('throws on invalid provider', async () => {
    const b = createProviderReconciliationWorkflowStepBuilder({
      serviceHooks: { runReconcileRow: async () => {} },
    });
    await expect(b.build({
      hydrated: makeHydrated('provider_reconciliation', {
        subType: 'provider_reconciliation', rowId: 'r', provider: 'unknown',
      }),
    })).rejects.toThrow(ReconciliationBuilderError);
  });

  test('builds reconcile_row with per-row idempotency', async () => {
    const b = createProviderReconciliationWorkflowStepBuilder({
      serviceHooks: { runReconcileRow: async () => {} },
    });
    const out = await b.build({
      hydrated: makeHydrated('provider_reconciliation', {
        subType: 'provider_reconciliation', rowId: 'r1', provider: 'instagram',
      }),
    });
    const reconcileStep = out.steps.find((s) => s.id === RECONCILIATION_STEP_IDS.apply('r1'));
    expect(reconcileStep?.idempotency?.cls).toBe('recovery_action');
    expect(reconcileStep?.idempotency?.semanticParts).toContain('r1');
    expect(reconcileStep?.idempotency?.semanticParts).toContain('instagram');
  });
});
