/**
 * Phase 26A-D — Production hook factory unit tests.
 */

import {
  createProductionLongFormHooks,
} from '../../../../../services/orchestration/distributed/domain/production/productionLongFormHooks';
import {
  createProductionCampaignHooks,
} from '../../../../../services/orchestration/distributed/domain/production/productionCampaignHooks';
import {
  createProductionSocialPublishHooks,
  ProductionPublishHookError,
} from '../../../../../services/orchestration/distributed/domain/production/productionSocialPublishHooks';
import {
  createProductionReconciliationHooks,
} from '../../../../../services/orchestration/distributed/domain/production/productionReconciliationHooks';

describe('createProductionLongFormHooks', () => {
  test('throws when generateSection dep missing', () => {
    expect(() => createProductionLongFormHooks({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deps: {} as any,
    })).toThrow();
  });

  test('omits optional hooks when deps not supplied', () => {
    const h = createProductionLongFormHooks({
      deps: { generateSection: async () => {} },
    });
    expect(h.runGenerationSection).toBeDefined();
    expect(h.runPrecheck).toBeUndefined();
    expect(h.runEnrichment).toBeUndefined();
  });

  test('hook calls underlying generateSection with context fields', async () => {
    let captured: { executionId?: string; sectionId?: string } = {};
    const h = createProductionLongFormHooks({
      deps: {
        async generateSection(input) { captured = input; },
      },
    });
    await h.runGenerationSection({
      executionId: 'e1', generationId: 'g1', companyContext: { foo: 'bar' },
    }, 'section_a');
    expect(captured.executionId).toBe('e1');
    expect(captured.sectionId).toBe('section_a');
  });
});

describe('createProductionCampaignHooks', () => {
  test('throws when publishPost missing', () => {
    expect(() => createProductionCampaignHooks({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deps: {} as any,
    })).toThrow();
  });

  test('runPost passes (campaignId, postId, meta) to dep', async () => {
    let captured: { campaignId?: string; postId?: string; meta?: Record<string, unknown> } = {};
    const h = createProductionCampaignHooks({
      deps: {
        async publishPost(input) { captured = input; },
      },
    });
    await h.runPost({
      executionId: 'e', campaignId: 'c1', totalPosts: 2,
    }, 'p1', { hint: true });
    expect(captured.campaignId).toBe('c1');
    expect(captured.postId).toBe('p1');
    expect(captured.meta?.hint).toBe(true);
  });
});

describe('createProductionSocialPublishHooks', () => {
  test('throws when adapters map missing', () => {
    expect(() => createProductionSocialPublishHooks({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deps: {} as any,
    })).toThrow();
  });

  test('runProviderPublish throws NO_ADAPTER when provider has no adapter', async () => {
    const h = createProductionSocialPublishHooks({
      deps: { adapters: {} },
    });
    await expect(h.runProviderPublish({
      executionId: 'e', provider: 'x', socialAccountId: 'acc',
      scheduledPostId: 'sp', contentFingerprint: 'fp', threadRootId: null,
    })).rejects.toBeInstanceOf(ProductionPublishHookError);
  });

  test('runProviderPublish suppresses second call with same fingerprint', async () => {
    let calls = 0;
    const h = createProductionSocialPublishHooks({
      deps: {
        adapters: {
          x: async () => { calls += 1; },
        },
      },
    });
    const ctx = {
      executionId: 'e', provider: 'x' as const, socialAccountId: 'acc',
      scheduledPostId: 'sp', contentFingerprint: 'fp1', threadRootId: null,
    };
    await h.runProviderPublish(ctx);
    await h.runProviderPublish(ctx);
    await h.runProviderPublish(ctx);
    expect(calls).toBe(1);
  });

  test('different fingerprints with same provider all hit the adapter', async () => {
    let calls = 0;
    const h = createProductionSocialPublishHooks({
      deps: {
        adapters: {
          linkedin: async () => { calls += 1; },
        },
      },
    });
    await h.runProviderPublish({
      executionId: 'e', provider: 'linkedin', socialAccountId: 'acc',
      scheduledPostId: 'sp', contentFingerprint: 'fp_a', threadRootId: null,
    });
    await h.runProviderPublish({
      executionId: 'e', provider: 'linkedin', socialAccountId: 'acc',
      scheduledPostId: 'sp', contentFingerprint: 'fp_b', threadRootId: null,
    });
    expect(calls).toBe(2);
  });

  test('adapter failure does NOT populate the cache (retries possible)', async () => {
    let attempts = 0;
    const h = createProductionSocialPublishHooks({
      deps: {
        adapters: {
          x: async () => {
            attempts += 1;
            if (attempts < 3) throw new Error('transient');
          },
        },
      },
    });
    const ctx = {
      executionId: 'e', provider: 'x' as const, socialAccountId: 'acc',
      scheduledPostId: 'sp', contentFingerprint: 'fp_retry', threadRootId: null,
    };
    let threwTwice = 0;
    for (let i = 0; i < 2; i += 1) {
      try { await h.runProviderPublish(ctx); } catch { threwTwice += 1; }
    }
    await h.runProviderPublish(ctx); // succeeds on third attempt
    expect(threwTwice).toBe(2);
    expect(attempts).toBe(3);
  });
});

describe('createProductionReconciliationHooks', () => {
  test('throws when reconcileRow missing', () => {
    expect(() => createProductionReconciliationHooks({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deps: {} as any,
    })).toThrow();
  });

  test('runReconcileRow forwards to dep', async () => {
    let captured: { rowId?: string; provider?: string } = {};
    const h = createProductionReconciliationHooks({
      deps: {
        async reconcileRow(input) { captured = input; },
      },
    });
    await h.runReconcileRow({
      executionId: 'e', rowId: 'r_42', provider: 'instagram',
    });
    expect(captured.rowId).toBe('r_42');
    expect(captured.provider).toBe('instagram');
  });
});
