/**
 * Execution Engine validation tests.
 *
 * Test 1 - AI Generation: 7 rows with generation_source = AI
 * Test 2 - Blueprint Generation: 7 rows with generation_source = blueprint
 * Test 3 - Board updateActivity: row updated without deleting week
 * Test 4 - Execution Lock: WEEK_EXECUTION_LOCKED when status = executing
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type DailyPlanRow = Record<string, any>;

const TEST_CAMPAIGN_ID = '00000000-0000-0000-0000-000000000001';
const TEST_WEEK = 99;

const dailyContentPlans: DailyPlanRow[] = [];
const campaigns = new Map<string, Record<string, any>>([
  [
    TEST_CAMPAIGN_ID,
    {
      id: TEST_CAMPAIGN_ID,
      name: 'Test Campaign',
      start_date: '2025-01-01',
      description: 'Test description',
      target_audience: 'Founders',
      company_id: '11111111-1111-4111-8111-111111111111',
      brand_voice: 'Direct',
      objective: 'Awareness',
    },
  ],
]);

function createQuery(table: string) {
  let filters: Array<(row: Record<string, any>) => boolean> = [];
  let operation: 'select' | 'delete' | 'insert' | 'update' = 'select';
  let updatePayload: Record<string, any> | null = null;
  let insertPayload: any = null;
  let selectSingle = false;

  const getRows = () => {
    if (table === 'daily_content_plans') return dailyContentPlans;
    if (table === 'campaigns') return Array.from(campaigns.values());
    return [];
  };

  const applyFilters = () => getRows().filter((row) => filters.every((fn) => fn(row)));

  const exec = async () => {
    const rows = applyFilters();

    if (operation === 'delete') {
      const source = getRows();
      for (let i = source.length - 1; i >= 0; i -= 1) {
        if (filters.every((fn) => fn(source[i]))) {
          source.splice(i, 1);
        }
      }
      return { data: selectSingle ? rows[0] ?? null : rows, error: null, count: rows.length };
    }

    if (operation === 'update') {
      rows.forEach((row) => Object.assign(row, updatePayload ?? {}));
      return { data: selectSingle ? rows[0] ?? null : rows, error: null, count: rows.length };
    }

    if (operation === 'insert') {
      const source = getRows();
      const payloads = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
      const inserted = payloads.map((payload, index) => {
        const row = {
          id: payload.id ?? `plan-${source.length + index + 1}`,
          ...payload,
        };
        source.push(row);
        return row;
      });
      return {
        data: selectSingle ? inserted[0] ?? null : inserted,
        error: null,
        count: inserted.length,
      };
    }

    return {
      data: selectSingle ? rows[0] ?? null : rows,
      error: null,
      count: rows.length,
    };
  };

  const builder: any = {
    select: (_fields?: string) => builder,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return builder;
    },
    neq: (field: string, value: unknown) => {
      filters.push((row) => row[field] !== value);
      return builder;
    },
    in: (field: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[field]));
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    delete: () => {
      operation = 'delete';
      return builder;
    },
    update: (payload: Record<string, any>) => {
      operation = 'update';
      updatePayload = payload;
      return builder;
    },
    insert: (payload: any) => {
      operation = 'insert';
      insertPayload = payload;
      return builder;
    },
    single: async () => {
      selectSingle = true;
      return exec();
    },
    maybeSingle: async () => {
      selectSingle = true;
      return exec();
    },
    then: (resolve: (value: any) => any, reject?: (reason: any) => any) => exec().then(resolve, reject),
  };

  return builder;
}

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => createQuery(table)),
  },
}));

jest.mock('../../services/dailyPlanAiGenerator', () => ({
  generateDailyPlansWithAI: jest.fn(async () => [
    { dayOfWeek: 'Monday', platform: 'linkedin', contentType: 'post', title: 'AI Monday' },
    { dayOfWeek: 'Tuesday', platform: 'instagram', contentType: 'post', title: 'AI Tuesday' },
    { dayOfWeek: 'Wednesday', platform: 'x', contentType: 'post', title: 'AI Wednesday' },
    { dayOfWeek: 'Thursday', platform: 'linkedin', contentType: 'carousel', title: 'AI Thursday' },
    { dayOfWeek: 'Friday', platform: 'instagram', contentType: 'reel', title: 'AI Friday' },
    { dayOfWeek: 'Saturday', platform: 'x', contentType: 'thread', title: 'AI Saturday' },
    { dayOfWeek: 'Sunday', platform: 'linkedin', contentType: 'article', title: 'AI Sunday' },
  ]),
}));

jest.mock('../../services/campaignPlanningInputsService', () => ({
  getCampaignPlanningInputs: jest.fn(async () => null),
}));

jest.mock('../../services/campaignBlueprintService', () => ({
  getUnifiedCampaignBlueprint: jest.fn(async () => ({ weeks: [] })),
}));

jest.mock('../../../pages/api/campaigns/generate-weekly-structure', () => ({
  generateWeeklyStructure: jest.fn(async () => ({ dailyPlan: [] })),
}));

describe('ExecutionPlannerService', () => {
  beforeEach(() => {
    dailyContentPlans.length = 0;
    jest.resetModules();
  });

  it('generateFromAI inserts 7 rows with generation_source=AI', async () => {
    const { generateFromAI, getDailyPlans } = await import('../../services/executionPlannerService');

    const { rowsInserted } = await generateFromAI(TEST_CAMPAIGN_ID, TEST_WEEK);
    expect(rowsInserted).toBe(7);

    const plans = await getDailyPlans(TEST_CAMPAIGN_ID);
    const weekPlans = plans.filter((p: any) => Number(p.week_number) === TEST_WEEK);
    expect(weekPlans.length).toBe(7);
    weekPlans.forEach((p: any) => {
      expect(p.generation_source).toBe('AI');
    });
  });

  it('saveWeekPlans with source=blueprint sets generation_source', async () => {
    const { saveWeekPlans, getDailyPlans } = await import('../../services/executionPlannerService');

    const plans = [
      {
        campaign_id: TEST_CAMPAIGN_ID,
        week_number: TEST_WEEK + 1,
        day_of_week: 'Monday',
        date: '2025-01-01',
        platform: 'linkedin',
        content_type: 'post',
        title: 'Test',
        content: '{}',
      },
    ];

    await saveWeekPlans(TEST_CAMPAIGN_ID, TEST_WEEK + 1, plans as any, 'blueprint');
    const all = await getDailyPlans(TEST_CAMPAIGN_ID);
    const weekPlans = all.filter((p: any) => Number(p.week_number) === TEST_WEEK + 1);
    expect(weekPlans.length).toBeGreaterThanOrEqual(1);
    expect(weekPlans[0]?.generation_source).toBe('blueprint');
  });

  it('updateActivity updates single row without deleting week', async () => {
    const { saveWeekPlans, updateActivity, getDailyPlans } = await import('../../services/executionPlannerService');

    await saveWeekPlans(
      TEST_CAMPAIGN_ID,
      TEST_WEEK,
      [
        {
          campaign_id: TEST_CAMPAIGN_ID,
          week_number: TEST_WEEK,
          day_of_week: 'Monday',
          date: '2025-01-01',
          platform: 'linkedin',
          content_type: 'post',
          title: 'Original',
          content: '{}',
        },
      ] as any,
      'manual'
    );

    const plans = await getDailyPlans(TEST_CAMPAIGN_ID);
    const first = plans[0] as { id?: string };
    expect(first?.id).toBeTruthy();

    await updateActivity(first.id!, { title: 'Updated by board' }, 'board');
    const after = await getDailyPlans(TEST_CAMPAIGN_ID);
    const found = after.find((p: any) => p.id === first.id);
    expect(found?.title).toBe('Updated by board');
  });

  it('rejects regeneration when week has status=executing unless forceOverride', async () => {
    const { saveWeekPlans, WEEK_EXECUTION_LOCKED } = await import('../../services/executionPlannerService');

    const lockWeek = TEST_WEEK + 2;
    const lockPlans = [
      {
        campaign_id: TEST_CAMPAIGN_ID,
        week_number: lockWeek,
        day_of_week: 'Monday',
        date: '2025-01-01',
        platform: 'linkedin',
        content_type: 'post',
        title: 'Locked',
        content: '{}',
        status: 'executing',
      },
    ];

    await saveWeekPlans(TEST_CAMPAIGN_ID, lockWeek, lockPlans as any, 'manual');

    await expect(
      saveWeekPlans(TEST_CAMPAIGN_ID, lockWeek, [{ ...lockPlans[0], title: 'New' }] as any, 'AI')
    ).rejects.toMatchObject({ code: WEEK_EXECUTION_LOCKED });

    await expect(
      saveWeekPlans(
        TEST_CAMPAIGN_ID,
        lockWeek,
        [{ ...lockPlans[0], title: 'Forced' }] as any,
        'AI',
        { forceOverride: true }
      )
    ).resolves.toMatchObject({ rowsInserted: 1 });
  });
});
