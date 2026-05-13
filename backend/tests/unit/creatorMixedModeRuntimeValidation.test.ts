import { runCreatorAssetGenerationRuntime } from '../../services/creatorAssetGenerationRuntime';
import { deriveCreatorAssetTypeFromIntent } from '../../services/creatorTemplateRegistryService';
import { validateCreatorScheduleRequest } from '../../../lib/shared/creatorGovernanceRegistry';

type Row = Record<string, any>;

const store: {
  campaigns: Row[];
  dailyPlans: Row[];
  creatorAssets: Row[];
  scheduledPosts: Row[];
  calls: {
    engine: number;
    render: number;
  };
} = {
  campaigns: [],
  dailyPlans: [],
  creatorAssets: [],
  scheduledPosts: [],
  calls: {
    engine: 0,
    render: 0,
  },
};

function resetStore(contentTypes: string[]) {
  store.campaigns = [{ id: 'campaign-1', company_id: 'company-1', user_id: 'user-1' }];
  store.dailyPlans = contentTypes.map((contentType, index) => ({
    id: `plan-${index + 1}`,
    campaign_id: 'campaign-1',
    week_number: 1,
    day_of_week: `Day ${index + 1}`,
    date: `2026-05-${String(index + 14).padStart(2, '0')}`,
    platform: 'linkedin',
    content_type: contentType,
    title: `${contentType} plan`,
    topic: `${contentType} topic`,
    content: {
      creative_guidance: {
        theme: `${contentType} theme`,
        hook: `${contentType} hook`,
        visual_direction: 'clear product visual',
        shot_guidance: 'shot guidance',
        scene_direction: 'scene direction',
        CTA_direction: 'cta direction',
        platform_adaptation: 'linkedin adaptation',
        repurposing_guidance: 'repurpose this',
        caption_direction: 'caption this',
        posting_guidance: 'post guidance',
        production_notes: 'production notes',
        production_checklist: ['prepare', 'record'],
        talking_points: ['point 1'],
        b_roll_ideas: ['b-roll'],
      },
      creator_card: {
        objective: 'awareness',
        summary: 'summary',
        target_audience: 'marketers',
      },
    },
    retry_count: 0,
    max_retries: 3,
  }));
  store.creatorAssets = [];
  store.scheduledPosts = [];
  store.calls.engine = 0;
  store.calls.render = 0;
}

function applyFilters(rows: Row[], filters: Record<string, any>) {
  return rows.filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
}

function query(table: string) {
  const state: {
    filters: Record<string, any>;
    updatePayload: Row | null;
    single: boolean;
  } = {
    filters: {},
    updatePayload: null,
    single: false,
  };

  const api: any = {
    select: jest.fn(() => api),
    eq: jest.fn((key: string, value: any) => {
      state.filters[key] = value;
      return api;
    }),
    order: jest.fn(() => api),
    limit: jest.fn(() => api),
    maybeSingle: jest.fn(async () => {
      const rows = table === 'campaigns' ? store.campaigns : store.dailyPlans;
      return { data: applyFilters(rows, state.filters)[0] ?? null, error: null };
    }),
    update: jest.fn((payload: Row) => {
      state.updatePayload = payload;
      return api;
    }),
    upsert: jest.fn(async (payload: Row) => {
      if (table === 'creator_assets') {
        const existingIndex = store.creatorAssets.findIndex((asset) => asset.id === payload.id);
        if (existingIndex >= 0) store.creatorAssets[existingIndex] = { ...store.creatorAssets[existingIndex], ...payload };
        else store.creatorAssets.push(payload);
      }
      return { data: payload, error: null };
    }),
    insert: jest.fn(async (payload: Row) => {
      if (table === 'scheduled_posts') store.scheduledPosts.push(payload);
      return { data: payload, error: null };
    }),
    then(resolve: any, reject: any) {
      if (state.updatePayload && table === 'daily_content_plans') {
        for (const row of applyFilters(store.dailyPlans, state.filters)) {
          Object.assign(row, state.updatePayload);
        }
      }
      const rows = table === 'campaigns'
        ? store.campaigns
        : table === 'creator_assets'
          ? store.creatorAssets
          : table === 'scheduled_posts'
            ? store.scheduledPosts
            : store.dailyPlans;
      return Promise.resolve({ data: applyFilters(rows, state.filters), error: null }).then(resolve, reject);
    },
  };

  return api;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => query(table)),
}));

jest.mock('../../services/creatorExecutionContracts', () => ({
  validateCreatorExecutionOutput: jest.fn(() => ({ ok: true, issues: [] })),
}));

jest.mock('../../services/creatorAssetValidationService', () => ({
  validateAssetReadiness: jest.fn(async () => ({ ready: true, failure_reason: null })),
}));

jest.mock('../../services/creatorAssetRenderer', () => ({
  renderAsset: jest.fn(async (payload: any) => {
    store.calls.render += 1;
    return {
      url: `https://cdn.example.test/${payload.asset_type || 'asset'}-${store.calls.render}.png`,
      files: [`https://cdn.example.test/${payload.asset_type || 'asset'}-${store.calls.render}.png`],
      metadata: { preview_kind: payload.asset_type || 'image' },
    };
  }),
}));

jest.mock('../../services/executionEngines', () => ({
  getExecutionEngine: jest.fn(() => ({
    generateFromIntent: jest.fn(async (intent: any) => {
      store.calls.engine += 1;
      const assetType = intent.contentType === 'carousel' ? 'carousel' : 'image';
      return {
        intent_type: 'creator',
        asset_type: assetType,
        asset_instruction: {
          blueprint: {},
          structure: {},
          visual_style: 'clean',
          template_id: `template-${assetType}`,
        },
        asset_payload: {
          asset_type: assetType,
          media_bundle: {
            metadata: {
              preview_kind: assetType,
              content_type: intent.contentType,
            },
          },
        },
        packaging: {
          caption: `${intent.contentType} caption`,
          hashtags: ['#test'],
          cta: 'Learn more',
          platform_variants: {},
        },
        generation_prompt: `creator:${assetType}:${intent.topic}`,
        metadata: {
          campaign_id: intent.campaignId,
          content_type: intent.contentType,
          topic: intent.topic,
        },
      };
    }),
    adaptForPlatform: jest.fn(async (output: any, platform: string) => ({
      ...output,
      metadata: {
        ...output.metadata,
        platform_variant: platform,
      },
    })),
  })),
}));

describe('creator mixed-mode runtime validation', () => {
  test('pure autonomous creator campaign renders assets and does not mark guidance rows', async () => {
    resetStore(['infographic', 'carousel']);

    const result = await runCreatorAssetGenerationRuntime({
      campaignId: 'campaign-1',
      companyId: 'company-1',
      userId: 'user-1',
      mode: 'RENDER_ONLY',
    });

    expect(result).toMatchObject({
      mode: 'RENDER_ONLY',
      rendered_count: 2,
      guidance_ready_count: 0,
      failed_count: 0,
      final_status: 'render_ready',
    });
    expect(store.calls.engine).toBe(2);
    expect(store.calls.render).toBe(2);
    expect(store.creatorAssets).toHaveLength(2);
    expect(store.scheduledPosts).toHaveLength(0);
    expect(store.dailyPlans.every((row) => row.content_status === 'render_ready')).toBe(true);
    expect(store.dailyPlans.every((row) => JSON.parse(row.content).rendered_asset.export_ready === true)).toBe(true);
    expect(store.dailyPlans.some((row) => row.content_status === 'guidance_ready')).toBe(false);
  });

  test('pure guidance-only campaign marks guidance_ready without render, assets, or retries', async () => {
    resetStore(['reel', 'short', 'podcast']);

    const result = await runCreatorAssetGenerationRuntime({
      campaignId: 'campaign-1',
      companyId: 'company-1',
      userId: 'user-1',
      mode: 'GUIDANCE_ONLY',
    });

    expect(result).toMatchObject({
      mode: 'GUIDANCE_ONLY',
      rendered_count: 0,
      guidance_ready_count: 3,
      failed_count: 0,
      final_status: 'guidance_ready',
    });
    expect(store.calls.engine).toBe(0);
    expect(store.calls.render).toBe(0);
    expect(store.creatorAssets).toHaveLength(0);
    expect(store.scheduledPosts).toHaveLength(0);
    expect(store.dailyPlans.every((row) => row.content_status === 'guidance_ready')).toBe(true);
    expect(store.dailyPlans.every((row) => row.retry_count === 0)).toBe(true);
    expect(store.dailyPlans.every((row) => JSON.parse(row.content).render_policy.skipped_reason === 'skipped_due_to_guidance_only_policy')).toBe(true);
  });

  test('mixed-mode campaign renders autonomous rows and preserves guidance-only row', async () => {
    resetStore(['infographic', 'carousel', 'reel']);

    const result = await runCreatorAssetGenerationRuntime({
      campaignId: 'campaign-1',
      companyId: 'company-1',
      userId: 'user-1',
      mode: 'RENDER_ONLY',
    });

    expect(result).toMatchObject({
      mode: 'RENDER_ONLY',
      rendered_count: 2,
      guidance_ready_count: 1,
      failed_count: 0,
      final_status: 'partially_rendered',
    });
    expect(store.calls.engine).toBe(2);
    expect(store.calls.render).toBe(2);
    expect(store.creatorAssets).toHaveLength(2);
    expect(store.scheduledPosts).toHaveLength(0);
    expect(store.dailyPlans.filter((row) => row.content_status === 'render_ready')).toHaveLength(2);
    expect(store.dailyPlans.filter((row) => row.content_status === 'guidance_ready')).toHaveLength(1);
    const reel = store.dailyPlans.find((row) => row.content_type === 'reel')!;
    expect(JSON.parse(reel.content).render_policy.skipped_reason).toBe('skipped_due_to_guidance_only_policy');
  });

  test('legacy governance bypasses fail before render or schedule paths', () => {
    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'campaign_schedule',
      executionConfig: { campaign_mode: 'creator', content_formats: ['reel'] },
    })).toMatchObject({
      ok: false,
      blockedFormats: ['reel'],
    });

    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'schedule',
      executionConfig: { campaign_mode: 'creator', content_formats: ['video'] },
    })).toMatchObject({
      ok: false,
      blockedFormats: ['video'],
    });

    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'daily_plan',
      executionConfig: { campaign_mode: 'creator', content_formats: ['unknown-format'] },
    })).toMatchObject({
      ok: false,
      unsupportedFormats: ['unknown_format'],
    });

    expect(() => deriveCreatorAssetTypeFromIntent({ contentType: 'reel' })).toThrow(/guidance-only/);
    expect(() => deriveCreatorAssetTypeFromIntent({ contentType: 'unknown-format' })).toThrow(/Unsupported creator content type/);
  });
});
