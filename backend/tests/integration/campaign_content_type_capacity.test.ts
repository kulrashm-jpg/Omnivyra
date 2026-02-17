/**
 * Content-Type Capacity Awareness — Integration Tests.
 * Tests: video-heavy NEGOTIATE, zero video REJECTED, sufficient APPROVED,
 * ADJUST_CONTENT_MIX trade-off, evaluation order, governance event.
 */

import { evaluateCampaignDuration } from '../../services/HorizonConstraintEvaluator';
import { GOVERNANCE_EVALUATION_ORDER } from '../../governance/GovernanceContract';

jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(new Date('2026-04-01')),
}));

const recordGovernanceEvent = jest.requireMock('../../services/GovernanceEventService')
  .recordGovernanceEvent as jest.Mock;

const COMPANY_ID = 'company-123';
const CAMPAIGN_ID = 'campaign-456';

describe('Content-Type Capacity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordGovernanceEvent.mockResolvedValue(undefined);
  });

  describe('1. Video-heavy campaign with insufficient videos → NEGOTIATE', () => {
    it('returns NEGOTIATE when video assets are insufficient for requested duration', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 8,
        existing_content_count: 20,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        contentAssetsByType: { video: 4, post: 16 },
        expectedContentMix: { video: 2, post: 3 },
      });

      expect(result.status).toBe('NEGOTIATE');
      const contentTypeConstraint = result.limiting_constraints?.find(
        (c) => c.name === 'content_type_capacity'
      );
      expect(contentTypeConstraint).toBeDefined();
      expect(contentTypeConstraint?.status).toBe('LIMITING');
      expect(contentTypeConstraint?.max_weeks_allowed).toBe(2);
      expect(contentTypeConstraint?.missing_type).toBe('video');
      expect(result.max_weeks_allowed).toBe(2);
    });
  });

  describe('2. Zero video assets → REJECTED', () => {
    it('returns REJECTED when required video assets are zero', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 6,
        existing_content_count: 18,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        contentAssetsByType: { post: 18 },
        expectedContentMix: { video: 2, post: 3 },
      });

      expect(result.status).toBe('REJECTED');
      const contentTypeConstraint = result.blocking_constraints?.find(
        (c) => c.name === 'content_type_capacity'
      );
      expect(contentTypeConstraint).toBeDefined();
      expect(contentTypeConstraint?.status).toBe('BLOCKING');
      expect(contentTypeConstraint?.max_weeks_allowed).toBe(0);
      expect(contentTypeConstraint?.missing_type).toBe('video');
    });
  });

  describe('3. Sufficient mix → APPROVED', () => {
    it('returns APPROVED when content-type mix is sufficient', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 4,
        existing_content_count: 25,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        contentAssetsByType: { video: 10, post: 15 },
        expectedContentMix: { video: 2, post: 3 },
      });

      expect(result.status).toBe('APPROVED');
      const contentTypeConstraint = result.limiting_constraints?.find(
        (c) => c.name === 'content_type_capacity'
      );
      expect(contentTypeConstraint).toBeUndefined();
    });
  });

  describe('4. Trade-off includes ADJUST_CONTENT_MIX', () => {
    it('includes ADJUST_CONTENT_MIX when content_type_capacity is limiting', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 8,
        existing_content_count: 25,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        contentAssetsByType: { video: 6, post: 19 },
        expectedContentMix: { video: 2, post: 3 },
      });

      expect(result.status).toBe('NEGOTIATE');
      expect(result.tradeOffOptions).toBeDefined();
      const adjustMix = result.tradeOffOptions?.find((o) => o.type === 'ADJUST_CONTENT_MIX');
      expect(adjustMix).toBeDefined();
      expect(adjustMix?.reasoning).toContain('Adjust weekly content mix');
    });
  });

  describe('5. Evaluation order snapshot updated', () => {
    it('GOVERNANCE_EVALUATION_ORDER includes CONTENT_TYPE_CAPACITY after INVENTORY', () => {
      const order = [...GOVERNANCE_EVALUATION_ORDER];
      const invIdx = order.indexOf('INVENTORY');
      const ctIdx = order.indexOf('CONTENT_TYPE_CAPACITY');
      expect(invIdx).toBeGreaterThanOrEqual(0);
      expect(ctIdx).toBeGreaterThanOrEqual(0);
      expect(ctIdx).toBe(invIdx + 1);
    });
  });

  describe('6. Governance event recorded', () => {
    it('CONTENT_CAPACITY_LIMITED emitted when content_type_capacity participates in NEGOTIATE', async () => {
      await evaluateCampaignDuration({
        requested_weeks: 8,
        existing_content_count: 25,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        contentAssetsByType: { video: 6, post: 19 },
        expectedContentMix: { video: 2, post: 3 },
      });

      const contentCapacityCalls = recordGovernanceEvent.mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'CONTENT_CAPACITY_LIMITED'
      );
      expect(contentCapacityCalls.length).toBeGreaterThan(0);
      expect(contentCapacityCalls[0][0]).toMatchObject({
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        eventType: 'CONTENT_CAPACITY_LIMITED',
        metadata: expect.objectContaining({
          missing_type: 'video',
          max_weeks_allowed: 3,
        }),
      });
    });

    it('CONTENT_CAPACITY_LIMITED emitted when content_type_capacity participates in REJECTED', async () => {
      await evaluateCampaignDuration({
        requested_weeks: 6,
        existing_content_count: 18,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        contentAssetsByType: { post: 18 },
        expectedContentMix: { video: 2, post: 3 },
      });

      const contentCapacityCalls = recordGovernanceEvent.mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'CONTENT_CAPACITY_LIMITED'
      );
      expect(contentCapacityCalls.length).toBeGreaterThan(0);
      expect(contentCapacityCalls[0][0]).toMatchObject({
        eventType: 'CONTENT_CAPACITY_LIMITED',
        eventStatus: 'REJECTED',
        metadata: expect.objectContaining({
          missing_type: 'video',
          max_weeks_allowed: 0,
        }),
      });
    });
  });

  describe('7. Constraint skipped when no mix defined', () => {
    it('APPROVED when expectedContentMix is not provided', async () => {
      const result = await evaluateCampaignDuration({
        requested_weeks: 4,
        existing_content_count: 20,
        expected_posts_per_week: 5,
        team_posts_per_week_capacity: 20,
        total_budget: 10000,
        cost_per_week: 500,
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
      });

      expect(result.status).toBe('APPROVED');
      const blockingContentType = (result.blocking_constraints ?? []).find(
        (c) => c.name === 'content_type_capacity'
      );
      const limitingContentType = (result.limiting_constraints ?? []).find(
        (c) => c.name === 'content_type_capacity'
      );
      expect(blockingContentType).toBeUndefined();
      expect(limitingContentType).toBeUndefined();
    });
  });
});
