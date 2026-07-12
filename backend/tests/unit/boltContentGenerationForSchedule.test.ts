jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.mock('../../services/executionPlannerPersistence', () => ({
  updateActivity: jest.fn(),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(),
  buildPlatformVariantsFromMaster: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { updateActivity } from '../../services/executionPlannerPersistence';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';
import { generateContentForDailyPlans } from '../../services/boltContentGenerationForSchedule';

const mockedSupabase = supabase as unknown as {
  from: jest.Mock;
};
const mockedUpdateActivity = updateActivity as jest.MockedFunction<typeof updateActivity>;
const mockedGenerateMasterContentFromIntent = generateMasterContentFromIntent as jest.MockedFunction<typeof generateMasterContentFromIntent>;
const mockedBuildPlatformVariantsFromMaster = buildPlatformVariantsFromMaster as jest.MockedFunction<typeof buildPlatformVariantsFromMaster>;

describe('boltContentGenerationForSchedule', () => {
  beforeEach(() => {
    mockedSupabase.from.mockReset();
    mockedUpdateActivity.mockReset();
    mockedGenerateMasterContentFromIntent.mockReset();
    mockedBuildPlatformVariantsFromMaster.mockReset();

    mockedSupabase.from.mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { company_id: 'company-1', user_id: 'user-1' },
          }),
        };
      }
      if (table === 'blogs') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    mockedGenerateMasterContentFromIntent.mockResolvedValue({
      id: 'master-1',
      generated_at: '2026-04-04T00:00:00.000Z',
      content: 'Fresh master content with a clear hook and body.',
      generation_status: 'generated',
      generation_source: 'ai',
    } as any);

    mockedBuildPlatformVariantsFromMaster.mockResolvedValue([
      {
        platform: 'linkedin',
        content_type: 'post',
        generated_content: '**Hook**\n\nParagraph one.\n\nCTA line.',
        generation_status: 'generated',
        locked_variant: false,
        adapted_from_master: true,
        adaptation_style: 'platform_specific',
        requires_media: false,
      },
    ] as any);
  });

  it('regenerates content when existing generated_content is only a generic placeholder', async () => {
    const dailyPlans = [
      {
        id: 'plan-1',
        campaign_id: 'campaign-1',
        week_number: 1,
        day_of_week: 'Monday',
        date: '2026-04-06',
        platform: 'linkedin',
        content_type: 'post',
        title: 'Brand Awareness',
        topic: 'Brand Awareness',
        scheduled_time: '09:00',
        content: JSON.stringify({
          topic: 'Brand Awareness',
          generated_content: 'Content for "Brand Awareness" — linkedin post',
        }),
      },
    ];

    const result = await generateContentForDailyPlans('campaign-1', dailyPlans as any);

    expect(mockedGenerateMasterContentFromIntent).toHaveBeenCalledTimes(1);
    expect(mockedBuildPlatformVariantsFromMaster).toHaveBeenCalledTimes(1);
    expect(result.get('plan-1')).toBe('**Hook**\n\nParagraph one.\n\nCTA line.');
    expect(mockedUpdateActivity).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({
        content: expect.stringContaining('"content_status":"finalized"'),
      }),
      'board'
    );
    expect(mockedUpdateActivity).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({
        content: expect.stringContaining('"platform_variants"'),
      }),
      'board'
    );
  });

  // ── R3-P2 — Content Workspace adoption (two-phase lane) ──────────────────
  describe('R3-P2 workspace adoption', () => {
    const plan = (id: string, content: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
      id,
      campaign_id: 'campaign-1',
      week_number: 1,
      day_of_week: 'Monday',
      date: '2099-01-05',
      platform: 'linkedin',
      content_type: 'post',
      title: `Topic ${id}`,
      topic: `Topic ${id}`,
      scheduled_time: '09:00',
      content: JSON.stringify(content),
      ...over,
    });
    const BODY = 'APPROVED workspace body for the two-phase lane.';

    it('approved workspace content is adopted verbatim with ZERO LLM calls', async () => {
      const result = await generateContentForDailyPlans('campaign-1', [
        plan('plan-a', {
          execution_id: 'ex-a',
          draft_content: { body: BODY, source: 'manual', manually_edited: true, updated_at: '2026-07-12T09:00:00.000Z' },
          content_planning_status: 'approved',
        }),
      ] as any);

      expect(mockedGenerateMasterContentFromIntent).not.toHaveBeenCalled();
      expect(mockedBuildPlatformVariantsFromMaster).not.toHaveBeenCalled();
      expect(result.get('plan-a')).toBe(BODY);

      const updateCall = mockedUpdateActivity.mock.calls.find((c) => c[0] === 'plan-a');
      const envelope = JSON.parse(String((updateCall?.[1] as { content: string }).content));
      expect(envelope.generated_content).toBe(BODY);
      expect(envelope.content_source).toBe('workspace');
      expect(envelope.content_source_tier).toBe('approved');
      // Planner-owned fields preserved verbatim — execution never rewrites them
      expect(envelope.draft_content.body).toBe(BODY);
      expect(envelope.draft_content.manually_edited).toBe(true);
      expect(envelope.content_planning_status).toBe('approved');
    });

    it('draft workspace content follows the existing generation policy', async () => {
      const result = await generateContentForDailyPlans('campaign-1', [
        plan('plan-d', {
          execution_id: 'ex-d',
          draft_content: { body: 'Draft body', source: 'ai', updated_at: '2026-07-12T09:00:00.000Z' },
          content_planning_status: 'draft',
        }),
      ] as any);

      expect(mockedGenerateMasterContentFromIntent).toHaveBeenCalledTimes(1);
      expect(mockedBuildPlatformVariantsFromMaster).toHaveBeenCalledTimes(1);
      expect(result.get('plan-d')).toBe('**Hook**\n\nParagraph one.\n\nCTA line.');
      const updateCall = mockedUpdateActivity.mock.calls.find((c) => c[0] === 'plan-d');
      const envelope = JSON.parse(String((updateCall?.[1] as { content: string }).content));
      expect(envelope.content_source).toBeUndefined();
      expect(envelope.draft_content.body).toBe('Draft body');
      expect(envelope.content_planning_status).toBe('draft');
    });

    it('review content NEVER adopts — planning state only, generation runs (R3-P2.1)', async () => {
      const result = await generateContentForDailyPlans('campaign-1', [
        plan('plan-r', {
          execution_id: 'ex-r',
          draft_content: { body: 'Reviewed body', source: 'ai', updated_at: '2026-07-12T09:00:00.000Z' },
          content_planning_status: 'review',
        }),
      ] as any);
      // The reviewed body is NOT the resolved content; the generation path ran
      expect(result.get('plan-r')).toBe('**Hook**\n\nParagraph one.\n\nCTA line.');
      expect(mockedGenerateMasterContentFromIntent).toHaveBeenCalledTimes(1);
      expect(mockedBuildPlatformVariantsFromMaster).toHaveBeenCalledTimes(1);
      // Planner-owned review state preserved; no adoption marker
      const updateCall = mockedUpdateActivity.mock.calls.find((c) => c[0] === 'plan-r');
      const envelope = JSON.parse(String((updateCall?.[1] as { content: string }).content));
      expect(envelope.draft_content.body).toBe('Reviewed body');
      expect(envelope.content_planning_status).toBe('review');
      expect(envelope.content_source).toBeUndefined();
    });
  });
});
