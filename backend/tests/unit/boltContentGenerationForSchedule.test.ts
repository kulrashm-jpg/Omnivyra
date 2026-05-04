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

import { createServiceRoleMigrationProxy } from '../../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
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
});
