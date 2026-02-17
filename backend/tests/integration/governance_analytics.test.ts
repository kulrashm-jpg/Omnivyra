/**
 * Integration tests for Governance Analytics (Stage 22).
 * Campaign-level, company-level analytics and event severity classification.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import {
  getCampaignGovernanceAnalytics,
  getCompanyGovernanceAnalytics,
} from '../../services/GovernanceAnalyticsService';
import { classifyGovernanceEventSeverity } from '../../services/GovernanceExplanationService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
}

const campaignId = 'campaign-uuid-123';
const companyId = 'company-uuid-456';

describe('Governance Analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('Campaign-level — No events → zeros', () => {
    it('returns zeros when campaign has no governance events', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.campaignId).toBe(campaignId);
      expect(analytics!.executionState).toBe('ACTIVE');
      expect(analytics!.totalEvents).toBe(0);
      expect(analytics!.negotiationCount).toBe(0);
      expect(analytics!.rejectionCount).toBe(0);
      expect(analytics!.preemptionCount).toBe(0);
      expect(analytics!.freezeBlocks).toBe(0);
      expect(analytics!.schedulerRuns).toBe(0);
      expect(analytics!.totalScheduledPosts).toBe(0);
      expect(analytics!.totalPublishedPosts).toBe(0);
      expect(analytics!.policyVersion).toBe('1.0.0');
      expect(analytics!.policyHash).toBe('');
      expect(analytics!.replayCoverageRatio).toBe(0);
      expect(analytics!.driftCount).toBe(0);
    });
  });

  describe('Campaign-level — Negotiation events counted', () => {
    it('counts DURATION_NEGOTIATE and DURATION_NEGOTIATED', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') return chain({
          data: [
            { event_type: 'DURATION_NEGOTIATE', event_status: 'NEGOTIATE', metadata: {}, created_at: new Date().toISOString() },
            { event_type: 'DURATION_NEGOTIATED', event_status: 'NEGOTIATE', metadata: {}, created_at: new Date().toISOString() },
          ],
          error: null,
        });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.totalEvents).toBe(2);
      expect(analytics!.negotiationCount).toBe(2);
    });
  });

  describe('Campaign-level — Completion detected', () => {
    it('detects CAMPAIGN_COMPLETED and sets completionTimestamp', async () => {
      const completedAt = '2025-02-15T12:00:00Z';
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'COMPLETED' }, error: null });
        if (table === 'campaign_governance_events') return chain({
          data: [
            { event_type: 'CAMPAIGN_COMPLETED', event_status: 'OK', metadata: { completedAt }, created_at: completedAt },
          ],
          error: null,
        });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.completionTimestamp).toBe(completedAt);
      expect(analytics!.executionState).toBe('COMPLETED');
    });
  });

  describe('Campaign-level — Published post count correct', () => {
    it('counts published posts in scheduled_posts', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({
          data: [
            { id: 'p1', status: 'published' },
            { id: 'p2', status: 'PUBLISHED' },
            { id: 'p3', status: 'scheduled' },
          ],
          error: null,
        });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.totalScheduledPosts).toBe(3);
      expect(analytics!.totalPublishedPosts).toBe(2);
    });
  });

  describe('Campaign-level — Campaign not found', () => {
    it('returns null when campaign does not exist', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: null, error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).toBeNull();
    });
  });

  describe('Company-level — Multiple campaigns aggregated', () => {
    it('aggregates counts by execution_status', async () => {
      const campaignIds = ['c1', 'c2', 'c3'];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: campaignIds.map((id) => ({ campaign_id: id })), error: null });
        if (table === 'campaigns') return chain({
          data: [
            { id: 'c1', execution_status: 'ACTIVE' },
            { id: 'c2', execution_status: 'COMPLETED' },
            { id: 'c3', execution_status: 'PREEMPTED' },
          ],
          error: null,
        });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.companyId).toBe(companyId);
      expect(analytics.totalCampaigns).toBe(3);
      expect(analytics.activeCampaigns).toBe(1);
      expect(analytics.completedCampaigns).toBe(1);
      expect(analytics.preemptedCampaigns).toBe(1);
    });
  });

  describe('Company-level — Constraint frequency counts correct', () => {
    it('counts event types in constraintFrequency', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'c1', execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events') return chain({
          data: [
            { event_type: 'DURATION_REJECTED' },
            { event_type: 'DURATION_REJECTED' },
            { event_type: 'DURATION_NEGOTIATE' },
          ],
          error: null,
        });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.constraintFrequency['DURATION_REJECTED']).toBe(2);
      expect(analytics.constraintFrequency['DURATION_NEGOTIATE']).toBe(1);
    });
  });

  describe('Company-level — Average negotiation computed', () => {
    it('computes average negotiations per campaign', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }, { campaign_id: 'c2' }], error: null });
        if (table === 'campaigns') return chain({
          data: [
            { id: 'c1', execution_status: 'ACTIVE' },
            { id: 'c2', execution_status: 'ACTIVE' },
          ],
          error: null,
        });
        if (table === 'campaign_governance_events') return chain({
          data: [
            { event_type: 'DURATION_NEGOTIATE' },
            { event_type: 'DURATION_NEGOTIATE' },
            { event_type: 'DURATION_NEGOTIATED' },
          ],
          error: null,
        });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.totalCampaigns).toBe(2);
      expect(analytics.averageNegotiationsPerCampaign).toBe(1.5);
    });
  });

  describe('Company-level — No campaigns', () => {
    it('returns zeros when company has no campaigns', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCompanyGovernanceAnalytics(companyId);

      expect(analytics.companyId).toBe(companyId);
      expect(analytics.totalCampaigns).toBe(0);
      expect(analytics.activeCampaigns).toBe(0);
      expect(analytics.completedCampaigns).toBe(0);
      expect(analytics.preemptedCampaigns).toBe(0);
      expect(analytics.averageNegotiationsPerCampaign).toBe(0);
      expect(analytics.constraintFrequency).toEqual({});
    });
  });
});

describe('Event severity classification', () => {
  it('DURATION_REJECTED → CRITICAL', () => {
    expect(classifyGovernanceEventSeverity('DURATION_REJECTED')).toBe('CRITICAL');
    expect(classifyGovernanceEventSeverity('duration_rejected')).toBe('CRITICAL');
  });

  it('CONTENT_COLLISION_DETECTED, EXECUTION_WINDOW_FROZEN, CAMPAIGN_MUTATION_BLOCKED_FINALIZED → CRITICAL', () => {
    expect(classifyGovernanceEventSeverity('CONTENT_COLLISION_DETECTED')).toBe('CRITICAL');
    expect(classifyGovernanceEventSeverity('EXECUTION_WINDOW_FROZEN')).toBe('CRITICAL');
    expect(classifyGovernanceEventSeverity('CAMPAIGN_MUTATION_BLOCKED_FINALIZED')).toBe('CRITICAL');
  });

  it('DURATION_NEGOTIATE → WARNING', () => {
    expect(classifyGovernanceEventSeverity('DURATION_NEGOTIATE')).toBe('WARNING');
  });

  it('CONTENT_CAPACITY_LIMITED, SHIFT_START_DATE_SUGGESTED, SCHEDULER_LOCK_BLOCKED → WARNING', () => {
    expect(classifyGovernanceEventSeverity('CONTENT_CAPACITY_LIMITED')).toBe('WARNING');
    expect(classifyGovernanceEventSeverity('SHIFT_START_DATE_SUGGESTED')).toBe('WARNING');
    expect(classifyGovernanceEventSeverity('SCHEDULER_LOCK_BLOCKED')).toBe('WARNING');
  });

  it('SCHEDULE_COMPLETED → INFO', () => {
    expect(classifyGovernanceEventSeverity('SCHEDULE_COMPLETED')).toBe('INFO');
  });

  it('unknown event types → INFO', () => {
    expect(classifyGovernanceEventSeverity('UNKNOWN_EVENT')).toBe('INFO');
    expect(classifyGovernanceEventSeverity('')).toBe('INFO');
  });
});
