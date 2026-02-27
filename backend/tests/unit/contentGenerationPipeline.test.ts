jest.mock('../../services/aiGateway', () => ({
  generateCampaignPlan: jest.fn(),
}));

import {
  attachGenerationPipelineToDailyItems,
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  generatePlatformVariantFromMaster,
  isMediaDependentContentType,
  resolveMediaStatus,
} from '../../services/contentGenerationPipeline';
import { generateCampaignPlan } from '../../services/aiGateway';

const mockedGenerateCampaignPlan = generateCampaignPlan as jest.MockedFunction<typeof generateCampaignPlan>;

describe('contentGenerationPipeline', () => {
  beforeEach(() => {
    mockedGenerateCampaignPlan.mockReset();
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'Default mocked AI output.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'test-trace-default',
      },
    });
  });

  it('text content produces AI-generated master content', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'This is AI generated universal master content.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'test-trace',
      },
    });
    const master = await generateMasterContentFromIntent({
      execution_id: 'wk1-exec-1',
      topic: 'Customer onboarding',
      intent: { objective: 'Increase activation', outcome_promise: 'Faster time-to-value' },
      writer_content_brief: { whatShouldReaderLearn: 'How to onboard quickly' },
    });

    expect(master.id).toBe('master-wk1-exec-1');
    expect(master.generation_status).toBe('generated');
    expect(master.generation_source).toBe('ai');
    expect(master.content).toBe('This is AI generated universal master content.');
    expect(mockedGenerateCampaignPlan).toHaveBeenCalledTimes(1);
  });

  it('generates platform variant from master with max length enforcement', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'LinkedIn adaptation output that is intentionally longer than forty characters.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'test-trace-variant',
      },
    });
    const variant = await generatePlatformVariantFromMaster(
      {
        id: 'master-x',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: '[MASTER CONTENT PLACEHOLDER]\nTopic: T\nObjective: O\nCore message: C',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      'linkedin',
      { content_type: 'post', max_length: 40 }
    );
    expect(variant.platform).toBe('linkedin');
    expect(variant.content_type).toBe('post');
    expect(variant.generation_status).toBe('generated');
    expect(variant.adapted_from_master).toBe(true);
    expect(variant.adaptation_style).toBe('platform_specific');
    expect(variant.generated_content.length).toBeLessThanOrEqual(40);
  });

  it('builds variants from active targets and preserves locked variants', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'LinkedIn adapted content body.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'test-trace-locked',
      },
    });
    const variants = await buildPlatformVariantsFromMaster({
      execution_id: 'wk2-exec-1',
      platform: 'linkedin',
      content_type: 'post',
      master_content: {
        id: 'master-wk2-exec-1',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: '[MASTER CONTENT PLACEHOLDER]\nTopic: A\nObjective: B\nCore message: C',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      active_platform_targets: [
        { platform: 'linkedin', content_type: 'post' },
        { platform: 'x', content_type: 'thread' },
      ],
      platform_variants: [
        {
          platform: 'x',
          content_type: 'thread',
          generated_content: 'LOCKED EXISTING VARIANT',
          generation_status: 'generated',
          locked_variant: true,
        },
      ],
    });

    expect(variants.length).toBeGreaterThanOrEqual(2);
    const xVariant = variants.find((v) => v.platform === 'x' && v.content_type === 'thread');
    expect(xVariant?.generated_content).toBe('LOCKED EXISTING VARIANT');
    expect(mockedGenerateCampaignPlan).toHaveBeenCalledTimes(1);
  });

  it('attaches master first and uses planned targets fallback when active missing', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'AI master body for planned targets fallback.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'test-trace',
      },
    });
    const weeks = [
      {
        week: 1,
        daily_execution_items: [
          {
            execution_id: 'wk1-exec-9',
            platform: 'linkedin',
            content_type: 'post',
            intent: { objective: 'Educate audience' },
            writer_content_brief: { whatProblemAreWeAddressing: 'Low awareness' },
            planned_platform_targets: [{ platform: 'instagram', content_type: 'reel' }],
          },
        ],
      },
    ];
    const out = await attachGenerationPipelineToDailyItems(weeks);
    const item = out[0].daily_execution_items[0];
    expect(item.master_content).toBeTruthy();
    expect(item.master_content.generation_status).toBe('generated');
    expect(Array.isArray(item.platform_variants)).toBe(true);
    expect(item.platform_variants[0].platform).toBe('instagram');
  });

  it('does not overwrite existing master content (variants may still adapt)', async () => {
    const weeks = [
      {
        week: 1,
        daily_execution_items: [
          {
            execution_id: 'wk1-exec-10',
            platform: 'linkedin',
            content_type: 'post',
            master_content: {
              id: 'master-existing',
              generated_at: '2025-01-01T00:00:00.000Z',
              content: 'EXISTING MASTER',
              generation_status: 'generated',
              generation_source: 'ai',
            },
            active_platform_targets: [{ platform: 'linkedin', content_type: 'post' }],
          },
        ],
      },
    ];
    const out = await attachGenerationPipelineToDailyItems(weeks);
    const item = out[0].daily_execution_items[0];
    expect(item.master_content.id).toBe('master-existing');
    expect(item.master_content.content).toBe('EXISTING MASTER');
    expect(mockedGenerateCampaignPlan).toHaveBeenCalledTimes(1);
  });

  it('detects media-dependent content types case-insensitively', () => {
    expect(isMediaDependentContentType('video')).toBe(true);
    expect(isMediaDependentContentType('REEL')).toBe(true);
    expect(isMediaDependentContentType('slides')).toBe(true);
    expect(isMediaDependentContentType('post')).toBe(false);
  });

  it('media content remains blueprint and does not call AI', async () => {
    const master = await generateMasterContentFromIntent({
      execution_id: 'wk3-exec-2',
      content_type: 'video',
      topic: 'Product demo',
      intent: { objective: 'Show product value' },
      writer_content_brief: { whatProblemAreWeAddressing: 'Feature confusion' },
    });
    expect(master.content).toContain('[MEDIA BLUEPRINT]');
    expect(master.content_type_mode).toBe('media_blueprint');
    expect(master.required_media).toBe(true);
    expect(master.media_status).toBe('missing');
    expect(mockedGenerateCampaignPlan).not.toHaveBeenCalled();
  });

  it('generates platform media blueprint variant for media-dependent target', async () => {
    const variant = await generatePlatformVariantFromMaster(
      {
        id: 'master-video',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: '[MEDIA BLUEPRINT]\nTopic: Demo\nObjective: O\nCore message: C',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      'instagram',
      { content_type: 'reel' }
    );
    expect(variant.generated_content).toContain('[PLATFORM MEDIA BLUEPRINT]');
    expect(variant.generated_content).toContain('Waiting for media link.');
    expect(variant.requires_media).toBe(true);
    expect(mockedGenerateCampaignPlan).not.toHaveBeenCalled();
  });

  it('resolves media status as ready when valid media asset exists', () => {
    const status = resolveMediaStatus({
      execution_id: 'wk4-exec-1',
      content_type: 'short',
      media_assets: [{ type: 'video', source_url: 'https://cdn.example.com/v1.mp4', status: 'attached' }],
    });
    expect(status).toBe('ready');
  });

  it('attaches missing media status for media-dependent item without assets', async () => {
    const weeks = [
      {
        week: 1,
        daily_execution_items: [
          {
            execution_id: 'wk5-exec-1',
            platform: 'youtube',
            content_type: 'video',
            intent: { objective: 'Educate' },
            writer_content_brief: { whatProblemAreWeAddressing: 'Awareness gap' },
            active_platform_targets: [{ platform: 'youtube', content_type: 'video' }],
          },
        ],
      },
    ];
    const out = await attachGenerationPipelineToDailyItems(weeks);
    const item = out[0].daily_execution_items[0];
    expect(item.media_status).toBe('missing');
    expect(item.master_content?.media_status).toBe('missing');
    expect(item.platform_variants?.[0]?.requires_media).toBe(true);
  });

  it('failed generation fallback path returns deterministic failed payload', async () => {
    mockedGenerateCampaignPlan.mockRejectedValue(new Error('gateway unavailable'));
    const master = await generateMasterContentFromIntent({
      execution_id: 'wk9-exec-2',
      content_type: 'post',
      topic: 'Retention strategy',
      intent: { objective: 'Increase retention' },
      writer_content_brief: { whatProblemAreWeAddressing: 'Low repeat usage' },
    });
    expect(master.generation_status).toBe('failed');
    expect(master.content).toContain('[MASTER GENERATION FAILED — deterministic fallback]');
    expect(master.content).toContain('Topic: Retention strategy');
  });

  it('variant adapts differently per platform (mocked outputs)', async () => {
    mockedGenerateCampaignPlan
      .mockResolvedValueOnce({
        output: 'LinkedIn specific adapted copy.',
        metadata: {
          provider: 'direct-openai',
          model: 'gpt-4o-mini',
          token_usage: null,
          reasoning_trace_id: 'trace-li',
        },
      })
      .mockResolvedValueOnce({
        output: 'X concise adapted copy.',
        metadata: {
          provider: 'direct-openai',
          model: 'gpt-4o-mini',
          token_usage: null,
          reasoning_trace_id: 'trace-x',
        },
      });

    const master = {
      id: 'master-a',
      generated_at: '2026-01-01T00:00:00.000Z',
      content: 'Universal master body.',
      generation_status: 'generated' as const,
      generation_source: 'ai' as const,
    };
    const linkedInVariant = await generatePlatformVariantFromMaster(master, 'linkedin', { content_type: 'post' });
    const xVariant = await generatePlatformVariantFromMaster(master, 'x', { content_type: 'thread' });

    expect(linkedInVariant.generated_content).toBe('LinkedIn specific adapted copy.');
    expect(xVariant.generated_content).toBe('X concise adapted copy.');
  });

  it('locked variant is not regenerated even if generated', async () => {
    const variants = await buildPlatformVariantsFromMaster({
      execution_id: 'wk8-exec-2',
      content_type: 'post',
      master_content: {
        id: 'master-wk8-exec-2',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: 'Master body',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      active_platform_targets: [{ platform: 'linkedin', content_type: 'post' }],
      platform_variants: [
        {
          platform: 'linkedin',
          content_type: 'post',
          generated_content: 'LOCKED CONTENT',
          generation_status: 'generated',
          locked_variant: true,
        },
      ],
    });
    expect(variants[0]?.generated_content).toBe('LOCKED CONTENT');
    expect(mockedGenerateCampaignPlan).not.toHaveBeenCalled();
  });

  it('variant adaptation fallback keeps previous deterministic variant when AI fails', async () => {
    mockedGenerateCampaignPlan.mockRejectedValue(new Error('variant adapt fail'));
    const variants = await buildPlatformVariantsFromMaster({
      execution_id: 'wk8-exec-3',
      content_type: 'post',
      master_content: {
        id: 'master-wk8-exec-3',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: 'Master body',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      active_platform_targets: [{ platform: 'facebook', content_type: 'post' }],
      platform_variants: [
        {
          platform: 'facebook',
          content_type: 'post',
          generated_content: '[FACEBOOK POST VARIANT]\nLegacy deterministic output.',
          generation_status: 'generated',
          locked_variant: false,
        },
      ],
    });
    expect(variants[0]?.generated_content).toContain('Legacy deterministic output.');
  });

  it('decision_trace exists for generated master', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'Master body with strategy context.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'trace-master',
      },
    });
    const master = await generateMasterContentFromIntent({
      execution_id: 'wk11-exec-1',
      topic: 'Trust building',
      intent: {
        objective: 'Build trust',
        pain_point: 'Low confidence',
        outcome_promise: 'Higher confidence',
      },
      writer_content_brief: {
        messagingAngle: 'Authority with clarity',
        narrativeStyle: 'Professional',
      },
      narrative_role: 'authority',
      progression_step: 2,
    } as any);
    expect(master.decision_trace).toBeTruthy();
    expect(master.decision_trace?.objective).toBe('Build trust');
    expect(master.decision_trace?.pain_point).toBe('Low confidence');
    expect(master.decision_trace?.tone_used).toBe('Professional');
    expect(master.decision_trace?.narrative_role).toBe('authority');
  });

  it('adaptation_trace exists for generated variant', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'LinkedIn adapted variant body.',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'trace-variant',
      },
    });
    const variant = await generatePlatformVariantFromMaster(
      {
        id: 'master-12',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: 'Master source content.',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      'linkedin',
      { content_type: 'post', max_length: 3000, writer_content_brief: { format_requirements: { format_family: 'long_text' } } }
    );
    expect(variant.adaptation_trace).toBeTruthy();
    expect(variant.adaptation_trace?.platform).toBe('linkedin');
    expect(variant.adaptation_trace?.character_limit_used).toBe(3000);
    expect(variant.adaptation_trace?.format_family).toBe('long_text');
    expect(variant.adaptation_trace?.media_constraints_applied).toBe(false);
  });

  it('traces are deterministic for same inputs', async () => {
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'Deterministic body',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'trace-deterministic',
      },
    });
    const masterA = await generateMasterContentFromIntent({
      execution_id: 'wk13-exec-1',
      topic: 'Consistency',
      intent: { objective: 'Consistency objective' },
      writer_content_brief: { narrativeStyle: 'Neutral' },
      narrative_role: 'support',
      progression_step: 1,
    } as any);
    const masterB = await generateMasterContentFromIntent({
      execution_id: 'wk13-exec-1',
      topic: 'Consistency',
      intent: { objective: 'Consistency objective' },
      writer_content_brief: { narrativeStyle: 'Neutral' },
      narrative_role: 'support',
      progression_step: 1,
    } as any);
    expect(masterA.decision_trace).toEqual(masterB.decision_trace);

    const variantA = await generatePlatformVariantFromMaster(
      {
        id: 'master-13',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: 'Master content',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      'x',
      { content_type: 'thread', max_length: 280 }
    );
    const variantB = await generatePlatformVariantFromMaster(
      {
        id: 'master-13',
        generated_at: '2026-01-01T00:00:00.000Z',
        content: 'Master content',
        generation_status: 'generated',
        generation_source: 'ai',
      },
      'x',
      { content_type: 'thread', max_length: 280 }
    );
    expect(variantA.adaptation_trace).toEqual(variantB.adaptation_trace);
  });
});
