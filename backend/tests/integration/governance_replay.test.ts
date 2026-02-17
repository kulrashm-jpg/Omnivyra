/**
 * Integration tests for Governance Replay (Stage 24).
 * Deterministic replay, verification, no side effects.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));

import { supabase } from '../../db/supabaseClient';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import {
  replayGovernanceEvent,
  ReplayNotSupportedError,
} from '../../services/GovernanceReplayService';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const link = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return link;
}

const eventId = 'event-uuid-123';
const campaignId = 'campaign-uuid-456';
const companyId = 'company-uuid-789';

describe('Governance Replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('APPROVED event → replay returns MATCH', () => {
    it('status matches when replay returns APPROVED', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_APPROVED',
            event_status: 'APPROVED',
            metadata: {
              requested_weeks: 12,
              evaluation_context: { requested_weeks: 12, constraint_count: 0 },
            },
            policy_version: '1.0.0',
            policy_hash: getGovernancePolicyHash(),
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      const result = await replayGovernanceEvent(eventId);

      expect(result.originalEventType).toBe('DURATION_APPROVED');
      expect(result.originalStatus).toBe('APPROVED');
      expect(result.replayedStatus).toBe('APPROVED');
      expect(result.statusMatch).toBe(true);
      expect(runPrePlanning).toHaveBeenCalledWith(
        expect.objectContaining({ suppressEvents: true })
      );
    });
  });

  describe('NEGOTIATE event → MATCH', () => {
    it('status matches when replay returns NEGOTIATE', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_NEGOTIATE',
            event_status: 'NEGOTIATE',
            metadata: {
              requested_weeks: 20,
              evaluation_context: { requested_weeks: 20, constraint_count: 2 },
            },
            policy_version: '1.0.0',
            policy_hash: getGovernancePolicyHash(),
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'NEGOTIATE' });

      const result = await replayGovernanceEvent(eventId);

      expect(result.statusMatch).toBe(true);
      expect(result.replayedStatus).toBe('NEGOTIATE');
    });
  });

  describe('REJECTED event → MATCH', () => {
    it('status matches when replay returns REJECTED', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_REJECTED',
            event_status: 'REJECTED',
            metadata: {
              requested_weeks: 12,
              evaluation_context: { requested_weeks: 12, constraint_count: 3 },
            },
            policy_version: '1.0.0',
            policy_hash: getGovernancePolicyHash(),
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'REJECTED' });

      const result = await replayGovernanceEvent(eventId);

      expect(result.statusMatch).toBe(true);
    });
  });

  describe('Tampered event metadata → DRIFT_DETECTED', () => {
    it('statusMatch false when replay returns different status', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_APPROVED',
            event_status: 'APPROVED',
            metadata: {
              requested_weeks: 12,
              evaluation_context: { requested_weeks: 12 },
            },
            policy_version: '1.0.0',
            policy_hash: getGovernancePolicyHash(),
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'NEGOTIATE' });

      const result = await replayGovernanceEvent(eventId);

      expect(result.statusMatch).toBe(false);
      expect(result.mismatchReason).toBe('STATUS_DRIFT');
    });
  });

  describe('policy hash mismatch → throws', () => {
    it('throws with POLICY_HASH_MISMATCH when stored hash differs', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_APPROVED',
            event_status: 'APPROVED',
            metadata: {
              requested_weeks: 12,
              evaluation_context: { requested_weeks: 12 },
            },
            policy_version: '1.0.0',
            policy_hash: 'different_hash_value_12345',
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      await expect(replayGovernanceEvent(eventId)).rejects.toMatchObject({
        code: 'POLICY_HASH_MISMATCH',
      });
    });
  });

  describe('event without evaluation_context → 422', () => {
    it('throws ReplayNotSupportedError when no evaluation_context', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_APPROVED',
            event_status: 'APPROVED',
            metadata: { requested_weeks: 12 },
            policy_version: '1.0.0',
            policy_hash: getGovernancePolicyHash(),
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      await expect(replayGovernanceEvent(eventId)).rejects.toThrow(ReplayNotSupportedError);
      await expect(replayGovernanceEvent(eventId)).rejects.toMatchObject({
        code: 'REPLAY_NOT_SUPPORTED',
      });
    });
  });

  describe('replay does not emit new governance events', () => {
    it('runPrePlanning called with suppressEvents: true', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') return chain({
          data: {
            id: eventId,
            company_id: companyId,
            campaign_id: campaignId,
            event_type: 'DURATION_APPROVED',
            event_status: 'APPROVED',
            metadata: {
              requested_weeks: 12,
              evaluation_context: { requested_weeks: 12 },
            },
            policy_version: '1.0.0',
            policy_hash: getGovernancePolicyHash(),
          },
          error: null,
        });
        return chain({ data: null, error: null });
      });

      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      await replayGovernanceEvent(eventId);

      expect(runPrePlanning).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId,
          campaignId,
          requested_weeks: 12,
          suppressEvents: true,
        })
      );
    });
  });

  describe('analytics replayIntegrity field', () => {
    it('returns VERIFIED when replay matches', async () => {
      const mockEvent = {
        id: eventId,
        company_id: companyId,
        campaign_id: campaignId,
        event_type: 'DURATION_APPROVED',
        event_status: 'APPROVED',
        metadata: {
          requested_weeks: 12,
          evaluation_context: { requested_weeks: 12 },
        },
        policy_version: '1.0.0',
        policy_hash: getGovernancePolicyHash(),
      };

      let governanceEventsCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') {
          governanceEventsCallCount++;
          const isReplayCall = governanceEventsCallCount > 1;
          return chain({
            data: isReplayCall ? mockEvent : [mockEvent],
            error: null,
          });
        }
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'APPROVED' });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.replayIntegrity).toBe('VERIFIED');
    });

    it('returns NOT_REPLAYABLE when no evaluation_context', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        if (table === 'campaign_governance_events') return chain({
          data: [{
            id: eventId,
            event_type: 'SCHEDULE_STARTED',
            metadata: {},
            policy_version: '1.0.0',
            policy_hash: '',
          }],
          error: null,
        });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.replayIntegrity).toBe('NOT_REPLAYABLE');
    });
  });

  describe('event not found', () => {
    it('throws when event does not exist', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => chain({ data: null, error: null }));

      await expect(replayGovernanceEvent('nonexistent-id')).rejects.toThrow(ReplayNotSupportedError);
    });
  });
});
