/**
 * B4.1 — Campaign → canonical content bridge, BLOCK-SCHEDULER path.
 *
 * `processBlockSchedule` is THE live campaign text scheduler. This file proves
 * its half of the bridge: the flag boundary, the campaign/company the artifact
 * is anchored to, and — the part that fails silently when wrong — that the
 * canonical columns are read from where `buildItemFromEnriched` actually puts
 * them (objective/audience under `intent`, brand voice under the writer brief's
 * `narrativeStyle`), not off the item root.
 *
 * Harness mirrors boltScheduleBlockProcessorCharacterization. `createContent`
 * is mocked, so the persisted row shape is observable without a database.
 */

type Row = Record<string, unknown>;

const scheduledPostInserts: Row[] = [];
let insertCounter = 0;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'scheduled_posts') {
        return {
          insert: () => {
            insertCounter += 1;
            scheduledPostInserts.push({});
            return { select: () => ({ maybeSingle: async () => ({ data: { id: `sp-${insertCounter}` }, error: null }) }) };
          },
        };
      }
      if (table === 'daily_content_plans') {
        return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
      }
      if (table === 'blogs') return { insert: async () => ({ error: null }) };
      if (table === 'campaigns') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { company_id: 'co-1' } }) }) }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  },
}));

jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: jest.fn(async () => undefined),
}));

jest.mock('../../services/contentGenerationPipeline', () => ({
  generateMasterContentFromIntent: jest.fn(async () => ({
    id: 'master-gen',
    generated_at: '2026-07-12T00:00:00.000Z',
    content: 'Generated master body with a hook and a CTA.',
    generation_status: 'generated',
    generation_source: 'ai',
  })),
  buildPlatformVariantsFromMaster: jest.fn(async () => ([
    { platform: 'linkedin', content_type: 'post', generated_content: 'LinkedIn-native variant body.', generation_status: 'generated' },
  ])),
}));

jest.mock('../../services/creator/governanceItemEnricher', () => ({
  enrichItemWithGovernance: jest.fn(async (item: unknown) => item),
}));

jest.mock('../../services/campaign/plannerMetrics', () => ({
  emitPlannerDrop: jest.fn(),
  emitLifecycleTransition: jest.fn(),
}));

jest.mock('../../services/content/contentService', () => ({
  createContent: jest.fn(),
}));

import { processBlockSchedule } from '../../services/boltScheduleBlockProcessor';
import { generateMasterContentFromIntent } from '../../services/contentGenerationPipeline';
import { createContent } from '../../services/content/contentService';

const mockedMaster = generateMasterContentFromIntent as jest.Mock;
const mockedCreateContent = createContent as jest.MockedFunction<typeof createContent>;

const MASTER_TEXT = 'Generated master body with a hook and a CTA.';
const CAMPAIGN = { start_date: '2099-01-04', user_id: 'user-1', company_id: 'co-1' };
const ACCOUNTS = new Map([['linkedin', 'acct-li'], ['x', 'acct-x'], ['facebook', 'acct-fb']]);
const normalize = (p: string) => (['linkedin', 'x', 'facebook'].includes(p) ? p : null);
const PRIOR = process.env.CANONICAL_PERSISTENCE_ENABLED;

const row = (): Row => ({
  id: 'row-1',
  campaign_id: 'camp-1',
  week_number: 3,
  day_of_week: 'Tuesday',
  date: '2099-01-05', // far future → the schedule floor never rewrites it
  platform: 'linkedin',
  content_type: 'post',
  title: 'Signal over noise',
  topic: 'Signal over noise',
  scheduled_time: '09:00',
  content: JSON.stringify({
    execution_id: 'ex-1',
    topic: 'Signal over noise',
    dailyObjective: 'Explain why noisy dashboards hide the real signal',
    whoAreWeWritingFor: 'RevOps leads at Series B companies',
    narrativeStyle: 'Direct, evidence-first, no hype',
  }),
});

const run = () => processBlockSchedule('camp-1', [row()] as never, CAMPAIGN, ACCOUNTS, normalize, {});

beforeEach(() => {
  jest.clearAllMocks();
  scheduledPostInserts.length = 0;
  insertCounter = 0;
  process.env.CANONICAL_PERSISTENCE_ENABLED = 'true';
  mockedCreateContent.mockResolvedValue({ id: 'content-1' } as never);
});

afterAll(() => {
  if (PRIOR === undefined) delete process.env.CANONICAL_PERSISTENCE_ENABLED;
  else process.env.CANONICAL_PERSISTENCE_ENABLED = PRIOR;
});

describe('B4.1 — processBlockSchedule mints canonical content', () => {
  test('flag OFF ⇒ no canonical write, and the campaign still schedules', async () => {
    process.env.CANONICAL_PERSISTENCE_ENABLED = 'false';

    const result = await run();

    expect(mockedCreateContent).not.toHaveBeenCalled();
    expect(mockedMaster).toHaveBeenCalledTimes(1);
    expect(result.scheduled_count).toBe(1);
  });

  test('flag ON ⇒ exactly one canonical row carrying this campaign and company', async () => {
    const result = await run();

    expect(result.scheduled_count).toBe(1);
    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    const created = mockedCreateContent.mock.calls[0]![0];
    expect(created.campaignId).toBe('camp-1');
    expect(created.companyId).toBe('co-1');
    expect(created.contentType).toBe('post');
    expect(created.body).toBe(MASTER_TEXT);
    expect(created.lifecycleStatus).toBe('generated');
  });

  test('the brief fields are read from where the item actually carries them', async () => {
    await run();

    const created = mockedCreateContent.mock.calls[0]![0];
    expect(created.topic).toBe('Signal over noise');
    expect(created.title).toBe('Signal over noise');
    expect(created.objective).toBe('Explain why noisy dashboards hide the real signal');
    expect(created.audience).toBe('RevOps leads at Series B companies');
    expect(created.tone).toBe('Direct, evidence-first, no hype');
  });

  test('the source metadata names this path and its schedule coordinates', async () => {
    await run();

    expect(mockedCreateContent.mock.calls[0]![0].sourceMetadata).toEqual({
      source: 'boltScheduleBlockProcessor',
      campaign_id: 'camp-1',
      week_number: 3,
      day_of_week: 'Tuesday',
    });
  });

  test('ONE canonical row per accepted master, not one per platform', async () => {
    // The same card fanned out to three platforms. The bridge sits at the CARD's
    // accepted master, upstream of platform expansion, so the artifact count must
    // track cards — not the 11-platform registry.
    const sibling = (id: string, platform: string, day: string, date: string): Row => ({
      ...row(), id, platform, day_of_week: day, date,
    });
    const rows = [
      sibling('row-li', 'linkedin', 'Tuesday', '2099-01-05'),
      sibling('row-x', 'x', 'Tuesday', '2099-01-05'),
      sibling('row-fb', 'facebook', 'Tuesday', '2099-01-05'),
    ];

    await processBlockSchedule('camp-1', rows as never, CAMPAIGN, ACCOUNTS, normalize, {});

    // One master generated for the card ⇒ exactly one canonical artifact.
    expect(mockedMaster).toHaveBeenCalledTimes(1);
    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(mockedCreateContent.mock.calls[0]![0].campaignId).toBe('camp-1');
  });

  test('the company is the SERVER-resolved one, never a value carried on the row', async () => {
    // A plan row whose content JSON claims a different tenant. BOLT resolves the
    // company from the campaign server-side; if the bridge ever read the row's
    // own claim, this would mint a canonical artifact under the attacker's
    // company_id. CAMPAIGN.company_id ('co-1') must win.
    const spoofed: Row = {
      ...row(),
      content: JSON.stringify({
        execution_id: 'ex-1',
        topic: 'Signal over noise',
        company_id: 'attacker-co',
        companyId: 'attacker-co',
      }),
    };

    await processBlockSchedule('camp-1', [spoofed] as never, CAMPAIGN, ACCOUNTS, normalize, {});

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    const created = mockedCreateContent.mock.calls[0]![0];
    expect(created.companyId).toBe('co-1');
    expect(created.companyId).not.toBe('attacker-co');
  });

  test('a failing canonical write degrades to no artifact, never to a failed schedule', async () => {
    mockedCreateContent.mockRejectedValue(new Error('canonical insert exploded'));

    const result = await run();

    expect(mockedCreateContent).toHaveBeenCalledTimes(1);
    expect(result.scheduled_count).toBe(1);
  });
});
