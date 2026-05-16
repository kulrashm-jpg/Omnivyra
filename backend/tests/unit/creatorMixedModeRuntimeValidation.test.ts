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

// Mock the theme treatment service so the runtime's markAwaitingMediaUpload
// path can persist guidance synchronously in tests without making any LLM
// calls. The shape mirrors what the real service emits.
jest.mock('../../services/creatorThemeTreatmentService', () => ({
  generateCreatorThemeTreatment: jest.fn(async (input: any) => ({
    intent_type: 'creator',
    asset_type: 'video',
    asset_instruction: {
      blueprint: { hook_scene: { text: `${input.contentType} hook` } },
      structure: { output_shape: 'theme_treatment' },
      visual_style: 'mock',
      template_id: `theme-treatment-${input.contentType}`,
    },
    asset_payload: {
      asset_kind: 'theme_treatment',
      content_type: input.contentType,
      hook_scene: { text: `${input.contentType} hook` },
      scenes: [{ scene_number: 1, dialogue: 'open' }, { scene_number: 2, dialogue: 'reveal' }],
      cta_scene: { text: 'Watch now' },
      platform_notes: { optimal_aspect_ratio: '9:16' },
      duration_seconds: 60,
      aspect_ratio: '9:16',
      creator_guidance: {
        production_notes: `Produce ${input.contentType}`,
        production_checklist: ['set up scene', 'record'],
        talking_points: ['open', 'reveal'],
        b_roll_ideas: ['transition shot'],
      },
      marketing_package: {
        caption: `${input.contentType} caption`,
        hashtags: ['#mock'],
        cta: 'Watch now',
        meta_description: `${input.contentType} treatment for ${input.topic}`,
        keywords: [input.topic, input.contentType],
        platform_variants: {},
      },
      media_bundle: {
        metadata: { preview_kind: 'theme_treatment', content_type: input.contentType },
      },
    },
    packaging: {
      caption: `${input.contentType} caption`,
      hashtags: ['#mock'],
      cta: 'Watch now',
      meta_description: `${input.contentType} treatment for ${input.topic}`,
      keywords: [input.topic, input.contentType],
      platform_variants: {},
    },
    generation_prompt: `mock:${input.contentType}`,
    metadata: {
      content_type: input.contentType,
      preview_kind: 'theme_treatment',
      attachment_required: true,
    },
  })),
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

  test('pure attachment-required campaign emits awaiting_media_upload without render, assets, or retries', async () => {
    resetStore(['reel', 'short', 'podcast']);

    const result = await runCreatorAssetGenerationRuntime({
      campaignId: 'campaign-1',
      companyId: 'company-1',
      userId: 'user-1',
      mode: 'ATTACHMENT_ONLY',
    });

    expect(result).toMatchObject({
      mode: 'ATTACHMENT_ONLY',
      rendered_count: 0,
      awaiting_media_upload_count: 3,
      guidance_ready_count: 3, // legacy alias preserved
      failed_count: 0,
      final_status: 'awaiting_media_upload',
    });
    expect(store.calls.engine).toBe(0);
    expect(store.calls.render).toBe(0);
    expect(store.creatorAssets).toHaveLength(0);
    expect(store.scheduledPosts).toHaveLength(0);
    expect(store.dailyPlans.every((row) => row.content_status === 'awaiting_media_upload')).toBe(true);
    expect(store.dailyPlans.every((row) => row.retry_count === 0)).toBe(true);
    expect(store.dailyPlans.every((row) => JSON.parse(row.content).creator_lifecycle_state === 'awaiting_media_upload')).toBe(true);
    expect(store.dailyPlans.every((row) => JSON.parse(row.content).render_policy.skipped_reason === 'attachment_required_format_awaiting_media_upload')).toBe(true);
  });

  test('mixed-mode campaign renders autonomous rows and holds attachment-required row in awaiting_media_upload', async () => {
    resetStore(['infographic', 'carousel', 'reel']);

    const result = await runCreatorAssetGenerationRuntime({
      campaignId: 'campaign-1',
      companyId: 'company-1',
      userId: 'user-1',
      mode: 'MIXED',
    });

    expect(result).toMatchObject({
      mode: 'MIXED',
      rendered_count: 2,
      awaiting_media_upload_count: 1,
      guidance_ready_count: 1, // legacy alias preserved
      failed_count: 0,
      final_status: 'partially_rendered',
    });
    expect(store.calls.engine).toBe(2);
    expect(store.calls.render).toBe(2);
    expect(store.creatorAssets).toHaveLength(2);
    expect(store.scheduledPosts).toHaveLength(0);
    // Autonomous rows reach render_ready.
    expect(store.dailyPlans.filter((row) => row.content_status === 'render_ready')).toHaveLength(2);
    // Attachment-required row holds in awaiting_media_upload — autonomous rows
    // are NOT downgraded to render_only-globally, NOT blocked, NOT marked
    // guidance_ready as a terminal state.
    expect(store.dailyPlans.filter((row) => row.content_status === 'awaiting_media_upload')).toHaveLength(1);
    expect(store.dailyPlans.some((row) => row.content_status === 'guidance_ready')).toBe(false);
    const reel = store.dailyPlans.find((row) => row.content_type === 'reel')!;
    expect(JSON.parse(reel.content).creator_lifecycle_state).toBe('awaiting_media_upload');
    expect(JSON.parse(reel.content).render_policy.skipped_reason).toBe('attachment_required_format_awaiting_media_upload');
  });

  test('mixed-mode and attachment-required formats no longer trigger campaign-wide scheduling vetoes', () => {
    // Per-row eligibility: attachment-required formats are valid for every
    // outcome (week_plan, daily_plan, schedule, campaign_schedule). The
    // governance validator only blocks on truly UNSUPPORTED formats.
    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'campaign_schedule',
      executionConfig: { campaign_mode: 'creator', content_formats: ['reel'] },
    })).toMatchObject({ ok: true });

    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'schedule',
      executionConfig: { campaign_mode: 'creator', content_formats: ['video'] },
    })).toMatchObject({ ok: true });

    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'schedule',
      executionConfig: { campaign_mode: 'creator', content_formats: ['infographic', 'carousel', 'reel'] },
    })).toMatchObject({ ok: true });

    // Unsupported formats are still rejected.
    expect(validateCreatorScheduleRequest({
      campaignMode: 'creator',
      outcomeView: 'daily_plan',
      executionConfig: { campaign_mode: 'creator', content_formats: ['unknown-format'] },
    })).toMatchObject({
      ok: false,
      unsupportedFormats: ['unknown_format'],
    });

    // resolveCreatorAssetType still rejects attachment-required formats —
    // it's the AUTONOMOUS-render asset-type resolver, and attachment-required
    // formats are explicitly not autonomous-renderable.
    expect(() => deriveCreatorAssetTypeFromIntent({ contentType: 'reel' })).toThrow();
    expect(() => deriveCreatorAssetTypeFromIntent({ contentType: 'unknown-format' })).toThrow(/Unsupported creator content type/);
  });

  test('attachment-required runtime emission persists theme treatment + creator guidance + marketing package', async () => {
    resetStore(['reel']);

    await runCreatorAssetGenerationRuntime({
      campaignId: 'campaign-1',
      companyId: 'company-1',
      userId: 'user-1',
      mode: 'ATTACHMENT_ONLY',
    });

    const reel = store.dailyPlans[0];
    expect(reel.content_status).toBe('awaiting_media_upload');
    const parsed = JSON.parse(reel.content);
    expect(parsed.creator_lifecycle_state).toBe('awaiting_media_upload');
    expect(parsed.theme_treatment?.asset_kind).toBe('theme_treatment');
    expect(parsed.theme_treatment?.scenes?.length).toBeGreaterThan(0);
    expect(parsed.creator_guidance?.production_notes).toMatch(/reel/i);
    expect(Array.isArray(parsed.creator_guidance?.production_checklist)).toBe(true);
    expect(parsed.marketing_package?.caption).toBeTruthy();
    expect(Array.isArray(parsed.marketing_package?.hashtags)).toBe(true);
    expect(parsed.uploaded_media_url).toBeNull();
    // History entry from the FSM
    expect(Array.isArray(parsed.creator_lifecycle_history)).toBe(true);
    expect(parsed.creator_lifecycle_history[0].to).toBe('awaiting_media_upload');
  });

  test('per-row scheduling eligibility transitions awaiting → media_uploaded → ready_for_schedule', async () => {
    const { getRowSchedulingEligibility } = await import('../../../lib/shared/creatorGovernanceRegistry');
    const { applyTransition } = await import('../../../lib/shared/creatorLifecycleStateMachine');

    // Step 1: awaiting_media_upload — cannot schedule yet
    let content: Record<string, unknown> = applyTransition({}, 'awaiting_media_upload').content;
    let elig = getRowSchedulingEligibility({
      content_type: 'reel',
      content_status: 'awaiting_media_upload',
      creator_lifecycle_state: content.creator_lifecycle_state,
      uploaded_media_url: content.uploaded_media_url,
      upload_validation: content.upload_validation,
    });
    expect(elig.lifecycle).toBe('attachment_required');
    expect(elig.can_schedule_now).toBe(false);
    expect(elig.requires_upload).toBe(true);
    expect(elig.reason).toBe('awaiting_media_upload');

    // Step 2: media_uploaded with valid validation — still need ready_for_schedule
    content = applyTransition(content, 'media_uploaded', {
      contentPatch: {
        uploaded_media_url: 'https://cdn.example.test/reel-1.mp4',
        upload_validation: { valid: true, validated_at: 'now', details: {} },
      },
    }).content;
    elig = getRowSchedulingEligibility({
      content_type: 'reel',
      content_status: 'media_uploaded',
      creator_lifecycle_state: content.creator_lifecycle_state,
      uploaded_media_url: content.uploaded_media_url,
      upload_validation: content.upload_validation,
    });
    expect(elig.can_schedule_now).toBe(true);
    expect(elig.requires_upload).toBe(false);

    // Step 3: ready_for_schedule remains schedulable
    content = applyTransition(content, 'ready_for_schedule').content;
    elig = getRowSchedulingEligibility({
      content_type: 'reel',
      content_status: 'ready_for_schedule',
      creator_lifecycle_state: content.creator_lifecycle_state,
      uploaded_media_url: content.uploaded_media_url,
      upload_validation: content.upload_validation,
    });
    expect(elig.can_schedule_now).toBe(true);
    expect(elig.reason).toBe('attachment_uploaded_ready_for_schedule');

    // Step 4: invalid validation → can NOT schedule
    const failedContent: Record<string, unknown> = {
      creator_lifecycle_state: 'upload_failed',
      uploaded_media_url: 'https://cdn.example.test/bad.mp4',
      upload_validation: { valid: false, validated_at: 'now', errors: ['bad mime'], details: {} },
    };
    elig = getRowSchedulingEligibility({
      content_type: 'reel',
      creator_lifecycle_state: failedContent.creator_lifecycle_state,
      uploaded_media_url: failedContent.uploaded_media_url,
      upload_validation: failedContent.upload_validation,
    });
    expect(elig.can_schedule_now).toBe(false);
    expect(elig.reason).toBe('media_upload_validation_pending_or_failed');
  });
});
