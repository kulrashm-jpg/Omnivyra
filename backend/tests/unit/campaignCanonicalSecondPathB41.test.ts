/**
 * B4.1 — Campaign → canonical content bridge, SECOND campaign generation path.
 *
 * `campaignCanonicalIntegrationB41` proves the bridge itself (the guard hook,
 * the campaign round-trip, tenant isolation). This file proves the OTHER live
 * campaign generator — `generateContentForDailyPlans`, reachable through
 * /api/campaigns/[id]/repurpose-and-schedule and the structuredPlanScheduler
 * exec paths — is actually wired to it. Without this the two campaign paths
 * silently disagree: one mints canonical artifacts, the other keeps recording
 * content_memory.content_id = null.
 *
 * `createContent` is mocked, so the persisted row shape is directly observable
 * without a database. NOTHING here touches production.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/executionPlannerPersistence', () => ({
  updateActivity: jest.fn(),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(),
  buildPlatformVariantsFromMaster: jest.fn(),
}));

jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import {
  generateMasterContentFromIntent,
  buildPlatformVariantsFromMaster,
} from '../../services/contentGenerationPipeline';
import { createContent } from '../../services/content/contentService';
import { generateContentForDailyPlans } from '../../services/boltContentGenerationForSchedule';

const mockedSupabase = supabase as unknown as { from: jest.Mock };
const mockedMaster = generateMasterContentFromIntent as jest.MockedFunction<typeof generateMasterContentFromIntent>;
const mockedVariants = buildPlatformVariantsFromMaster as jest.MockedFunction<typeof buildPlatformVariantsFromMaster>;
const mockedCreateContent = createContent as jest.MockedFunction<typeof createContent>;

const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;
const MASTER_TEXT = 'Fresh master content with a clear hook and body.';

/** One non-adopted row, so the group takes the generate → guard → bridge lane. */
function plan() {
  return {
    id: 'plan-1',
    campaign_id: 'campaign-1',
    week_number: 3,
    day_of_week: 'Tuesday',
    date: '2099-04-06',
    platform: 'linkedin',
    content_type: 'post',
    title: 'Signal over noise',
    topic: 'Signal over noise',
    scheduled_time: '09:00',
    content: JSON.stringify({
      topic: 'Signal over noise',
      dailyObjective: 'Explain why noisy dashboards hide the real signal',
      whoAreWeWritingFor: 'RevOps leads at Series B companies',
      narrativeStyle: 'Direct, evidence-first, no hype',
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';

  mockedSupabase.from.mockImplementation((table: string) => {
    if (table === 'campaigns') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { company_id: 'company-1', user_id: 'user-1' } }),
      };
    }
    if (table === 'blogs') return { insert: jest.fn().mockResolvedValue({ error: null }) };
    throw new Error(`Unexpected table: ${table}`);
  });

  mockedMaster.mockResolvedValue({
    id: 'master-1',
    generated_at: '2026-04-04T00:00:00.000Z',
    content: MASTER_TEXT,
    generation_status: 'generated',
    generation_source: 'ai',
  } as never);

  mockedVariants.mockResolvedValue([
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
  ] as never);

  mockedCreateContent.mockResolvedValue({ id: 'content-1' } as never);
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

describe('B4.1 — repurpose/scheduler path mints canonical content', () => {
  it('flag OFF ⇒ no canonical write, and the campaign result is unchanged', async () => {
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';

    const result = await generateContentForDailyPlans('campaign-1', [plan()] as never);

    expect(mockedCreateContent).not.toHaveBeenCalled();
    expect(mockedMaster).toHaveBeenCalledTimes(1);
    expect(result.get('plan-1')).toBe('**Hook**\n\nParagraph one.\n\nCTA line.');
  });

  it('flag ON ⇒ exactly one canonical row carrying this campaign and company', async () => {
    await generateContentForDailyPlans('campaign-1', [plan()] as never);

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    const row = mockedCreateContent.mock.calls[0]![0];
    expect(row.campaignId).toBe('campaign-1');
    // The company is the one resolved server-side from the campaign row, never
    // anything carried on the plan payload.
    expect(row.companyId).toBe('company-1');
    expect(row.contentType).toBe('post');
    expect(row.body).toBe(MASTER_TEXT);
    expect(row.lifecycleStatus).toBe('generated');
  });

  it('the brief fields are read from where the item actually carries them', async () => {
    await generateContentForDailyPlans('campaign-1', [plan()] as never);

    const row = mockedCreateContent.mock.calls[0]![0];
    expect(row.topic).toBe('Signal over noise');
    expect(row.title).toBe('Signal over noise');
    // objective/audience live under item.intent; brand voice under the writer
    // brief's narrativeStyle. Reading them off the item root persists null.
    expect(row.objective).toBe('Explain why noisy dashboards hide the real signal');
    expect(row.audience).toBe('RevOps leads at Series B companies');
    expect(row.tone).toBe('Direct, evidence-first, no hype');
  });

  it('the source metadata names this path and its schedule coordinates', async () => {
    await generateContentForDailyPlans('campaign-1', [plan()] as never);

    expect(mockedCreateContent.mock.calls[0]![0].sourceMetadata).toEqual({
      source: 'boltContentGenerationForSchedule',
      campaign_id: 'campaign-1',
      week_number: 3,
      day_of_week: 'Tuesday',
    });
  });

  it('a failing canonical write degrades to no artifact, never to a failed campaign', async () => {
    mockedCreateContent.mockRejectedValue(new Error('canonical insert exploded'));

    const result = await generateContentForDailyPlans('campaign-1', [plan()] as never);

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(result.get('plan-1')).toBe('**Hook**\n\nParagraph one.\n\nCTA line.');
  });

  it('adopted workspace copy is not re-minted — no generation, no artifact', async () => {
    const adopted = {
      ...plan(),
      content: JSON.stringify({
        execution_id: 'ex-a',
        topic: 'Signal over noise',
        draft_content: {
          body: 'APPROVED workspace body.',
          source: 'manual',
          manually_edited: true,
          updated_at: '2026-07-12T09:00:00.000Z',
        },
        content_planning_status: 'approved',
      }),
    };

    const result = await generateContentForDailyPlans('campaign-1', [adopted] as never);

    expect(mockedMaster).not.toHaveBeenCalled();
    expect(mockedCreateContent).not.toHaveBeenCalled();
    expect(result.get('plan-1')).toBe('APPROVED workspace body.');
  });
});
