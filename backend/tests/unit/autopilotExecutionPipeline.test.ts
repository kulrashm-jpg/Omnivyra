jest.mock('../../services/aiGateway', () => ({
  generateCampaignPlan: jest.fn(),
}));

import { runAutopilotForWeek } from '../../services/autopilotExecutionPipeline';
import { generateCampaignPlan } from '../../services/aiGateway';

const mockedGenerateCampaignPlan = generateCampaignPlan as jest.MockedFunction<typeof generateCampaignPlan>;

describe('autopilotExecutionPipeline', () => {
  beforeEach(() => {
    mockedGenerateCampaignPlan.mockReset();
    mockedGenerateCampaignPlan.mockResolvedValue({
      output: 'AI output',
      metadata: {
        provider: 'direct-openai',
        model: 'gpt-4o-mini',
        token_usage: null,
        reasoning_trace_id: 'autopilot-test',
      },
    });
  });

  it('autopilot schedules ready items', async () => {
    const week = {
      week: 1,
      daily_execution_items: [
        {
          execution_id: 'wk1-exec-1',
          platform: 'linkedin',
          content_type: 'post',
          status: 'draft',
          master_content: {
            id: 'master-1',
            generated_at: '2026-01-01T00:00:00.000Z',
            content: 'Master body',
            generation_status: 'generated',
            generation_source: 'ai',
          },
          platform_variants: [
            {
              platform: 'linkedin',
              content_type: 'post',
              generated_content: 'Variant body',
              generation_status: 'generated',
              locked_variant: false,
            },
          ],
        },
      ],
    };

    const result = await runAutopilotForWeek(week, { timezone: 'UTC' });
    const item = result.week.daily_execution_items[0];
    expect(item.status).toBe('scheduled');
    expect(item.schedule_source).toBe('autopilot');
    expect(item.scheduled_time).toBeTruthy();
    expect(result.summary.scheduled_items).toBe(1);
  });

  it('skips media-missing items', async () => {
    const week = {
      week: 1,
      daily_execution_items: [
        {
          execution_id: 'wk1-exec-2',
          platform: 'youtube',
          content_type: 'video',
          status: 'draft',
          media_status: 'missing',
          master_content: {
            id: 'master-2',
            generated_at: '2026-01-01T00:00:00.000Z',
            content: '[MEDIA BLUEPRINT]\nTopic: Demo\nObjective: Explain\nCore message: Value',
            generation_status: 'generated',
            generation_source: 'ai',
          },
          platform_variants: [
            {
              platform: 'youtube',
              content_type: 'video',
              generated_content: '[PLATFORM MEDIA BLUEPRINT]\nUses shared media asset.\nWaiting for media link.',
              generation_status: 'generated',
              locked_variant: false,
              requires_media: true,
            },
          ],
        },
      ],
    };

    const result = await runAutopilotForWeek(week, { timezone: 'UTC' });
    const item = result.week.daily_execution_items[0];
    expect(item.status).toBe('draft');
    expect(result.summary.scheduled_items).toBe(0);
    expect(result.summary.skipped_missing_media).toBe(1);
  });

  it('preserves locked variants', async () => {
    const week = {
      week: 1,
      daily_execution_items: [
        {
          execution_id: 'wk1-exec-3',
          platform: 'x',
          content_type: 'thread',
          status: 'draft',
          master_content: {
            id: 'master-3',
            generated_at: '2026-01-01T00:00:00.000Z',
            content: 'Master body',
            generation_status: 'generated',
            generation_source: 'ai',
          },
          platform_variants: [
            {
              platform: 'x',
              content_type: 'thread',
              generated_content: 'LOCKED CONTENT',
              generation_status: 'generated',
              locked_variant: true,
            },
          ],
        },
      ],
    };

    const result = await runAutopilotForWeek(week, { timezone: 'UTC' });
    const variant = result.week.daily_execution_items[0].platform_variants[0];
    expect(variant.generated_content).toBe('LOCKED CONTENT');
    expect(result.summary.skipped_locked).toBeGreaterThan(0);
  });

  it('keeps existing schedule unchanged', async () => {
    const week = {
      week: 1,
      daily_execution_items: [
        {
          execution_id: 'wk1-exec-4',
          platform: 'facebook',
          content_type: 'post',
          status: 'draft',
          scheduled_time: '11:30',
          master_content: {
            id: 'master-4',
            generated_at: '2026-01-01T00:00:00.000Z',
            content: 'Master body',
            generation_status: 'generated',
            generation_source: 'ai',
          },
          platform_variants: [
            {
              platform: 'facebook',
              content_type: 'post',
              generated_content: 'Variant body',
              generation_status: 'generated',
              locked_variant: false,
            },
          ],
        },
      ],
    };

    const result = await runAutopilotForWeek(week, { timezone: 'UTC' });
    const item = result.week.daily_execution_items[0];
    expect(item.scheduled_time).toBe('11:30');
    expect(item.status).toBe('scheduled');
  });
});

