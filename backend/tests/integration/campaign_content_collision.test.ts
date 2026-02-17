/**
 * Content Collision Guard — Integration Tests.
 * Tests: overlapping campaigns sharing assets → NEGOTIATE, 50%+ collision → REJECTED,
 * no overlap → APPROVED, ADJUST_CONTENT_SELECTION trade-off, evaluation order, governance event.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { GOVERNANCE_EVALUATION_ORDER } from '../../governance/GovernanceContract';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';

const recordGovernanceEventMock = recordGovernanceEvent as jest.Mock;

const COMPANY_ID = 'company-123';
const CAMPAIGN_ID = 'campaign-456';
const OTHER_CAMPAIGN_ID = 'campaign-789';
const START = '2026-01-15';
const END = '2026-04-15';

function chain(result: { data: any; error: any }) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function chainArray(result: { data: any; error: any }) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    then: (resolve: (v: typeof result) => void) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

describe('Content Collision Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordGovernanceEventMock.mockResolvedValue(undefined);
  });

  it('Two overlapping campaigns sharing assets → NEGOTIATE', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaign_versions') {
        return chainArray({
          data: [{ campaign_id: CAMPAIGN_ID }, { campaign_id: OTHER_CAMPAIGN_ID }],
          error: null,
        });
      }
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: OTHER_CAMPAIGN_ID, start_date: '2026-01-01', end_date: '2026-03-31', execution_status: 'ACTIVE' },
          ],
          error: null,
        });
      }
      if (table === 'content_assets') {
        return chainArray({
          data: [{ asset_id: 'asset-1', campaign_id: OTHER_CAMPAIGN_ID }],
          error: null,
        });
      }
      if (table === 'campaign_team_assignment') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await evaluateCampaignDuration({
      requested_weeks: 8,
      existing_content_count: 40,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      startDate: START,
      endDate: END,
      requestedPostsPerWeek: 5,
      plannedAssetIds: ['asset-1', 'asset-2'],
    });

    expect(result.status).toBe('NEGOTIATE');
    const collision = result.limiting_constraints?.find((c) => c.name === 'content_collision');
    expect(collision).toBeDefined();
    expect(collision?.status).toBe('LIMITING');
    expect(collision?.collidingCampaignIds).toContain(OTHER_CAMPAIGN_ID);
    expect(collision?.collidingAssetIds).toContain('asset-1');
  });

  it('50%+ collision → REJECTED', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaign_versions') {
        return chainArray({ data: [{ campaign_id: CAMPAIGN_ID }, { campaign_id: OTHER_CAMPAIGN_ID }], error: null });
      }
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: OTHER_CAMPAIGN_ID, start_date: '2026-01-01', end_date: '2026-03-31', execution_status: 'ACTIVE' },
          ],
          error: null,
        });
      }
      if (table === 'content_assets') {
        return chainArray({
          data: [
            { asset_id: 'asset-1', campaign_id: OTHER_CAMPAIGN_ID },
            { asset_id: 'asset-2', campaign_id: OTHER_CAMPAIGN_ID },
          ],
          error: null,
        });
      }
      if (table === 'campaign_team_assignment') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await evaluateCampaignDuration({
      requested_weeks: 8,
      existing_content_count: 40,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      startDate: START,
      endDate: END,
      requestedPostsPerWeek: 5,
      plannedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
    });

    expect(result.status).toBe('REJECTED');
    const collision = result.blocking_constraints?.find((c) => c.name === 'content_collision');
    expect(collision).toBeDefined();
    expect(collision?.status).toBe('BLOCKING');
    expect(collision?.collidingAssetIds?.length).toBeGreaterThanOrEqual(2);
  });

  it('No overlap → APPROVED', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaign_versions') {
        return chainArray({ data: [{ campaign_id: CAMPAIGN_ID }], error: null });
      }
      if (table === 'campaign_team_assignment') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await evaluateCampaignDuration({
      requested_weeks: 4,
      existing_content_count: 25,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      startDate: START,
      endDate: END,
      requestedPostsPerWeek: 5,
      plannedAssetIds: ['asset-1', 'asset-2'],
    });

    expect(result.status).toBe('APPROVED');
    const collisionBlocking = result.blocking_constraints?.find((c) => c.name === 'content_collision');
    const collisionLimiting = result.limiting_constraints?.find((c) => c.name === 'content_collision');
    expect(collisionBlocking).toBeUndefined();
    expect(collisionLimiting).toBeUndefined();
  });

  it('Trade-off includes ADJUST_CONTENT_SELECTION', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaign_versions') {
        return chainArray({ data: [{ campaign_id: CAMPAIGN_ID }, { campaign_id: OTHER_CAMPAIGN_ID }], error: null });
      }
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: OTHER_CAMPAIGN_ID, start_date: '2026-01-01', end_date: '2026-03-31', execution_status: 'ACTIVE' },
          ],
          error: null,
        });
      }
      if (table === 'content_assets') {
        return chainArray({
          data: [{ asset_id: 'asset-1', campaign_id: OTHER_CAMPAIGN_ID }],
          error: null,
        });
      }
      if (table === 'campaign_team_assignment') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await evaluateCampaignDuration({
      requested_weeks: 8,
      existing_content_count: 40,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      startDate: START,
      endDate: END,
      requestedPostsPerWeek: 5,
      plannedAssetIds: ['asset-1', 'asset-2'],
    });

    expect(result.status).toBe('NEGOTIATE');
    expect(result.tradeOffOptions).toBeDefined();
    const adjust = result.tradeOffOptions?.find((o) => o.type === 'ADJUST_CONTENT_SELECTION');
    expect(adjust).toBeDefined();
    expect(adjust?.reasoning).toContain('different content assets');
  });

  it('GOVERNANCE_EVALUATION_ORDER includes CONTENT_COLLISION after CONTENT_TYPE_CAPACITY', () => {
    const order = [...GOVERNANCE_EVALUATION_ORDER];
    const ctIdx = order.indexOf('CONTENT_TYPE_CAPACITY');
    const ccIdx = order.indexOf('CONTENT_COLLISION');
    expect(ctIdx).toBeGreaterThanOrEqual(0);
    expect(ccIdx).toBeGreaterThanOrEqual(0);
    expect(ccIdx).toBe(ctIdx + 1);
  });

  it('CONTENT_COLLISION_DETECTED emitted when content_collision affects NEGOTIATE', async () => {
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaign_versions') {
        return chainArray({ data: [{ campaign_id: CAMPAIGN_ID }, { campaign_id: OTHER_CAMPAIGN_ID }], error: null });
      }
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: OTHER_CAMPAIGN_ID, start_date: '2026-01-01', end_date: '2026-03-31', execution_status: 'ACTIVE' },
          ],
          error: null,
        });
      }
      if (table === 'content_assets') {
        return chainArray({
          data: [{ asset_id: 'asset-1', campaign_id: OTHER_CAMPAIGN_ID }],
          error: null,
        });
      }
      if (table === 'campaign_team_assignment') {
        return chain({ data: null, error: null });
      }
      return chain({ data: null, error: null });
    });

    await evaluateCampaignDuration({
      requested_weeks: 8,
      existing_content_count: 40,
      expected_posts_per_week: 5,
      team_posts_per_week_capacity: 20,
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      startDate: START,
      endDate: END,
      requestedPostsPerWeek: 5,
      plannedAssetIds: ['asset-1', 'asset-2'],
    });

    const collisionCalls = recordGovernanceEventMock.mock.calls.filter(
      (c: any[]) => c[0]?.eventType === 'CONTENT_COLLISION_DETECTED'
    );
    expect(collisionCalls.length).toBeGreaterThan(0);
    expect(collisionCalls[0][0]).toMatchObject({
      companyId: COMPANY_ID,
      campaignId: CAMPAIGN_ID,
      eventType: 'CONTENT_COLLISION_DETECTED',
      metadata: expect.objectContaining({
        collidingCampaignIds: expect.any(Array),
        collidingAssetIds: expect.any(Array),
        severity: 'LIMITING',
      }),
    });
  });
});
