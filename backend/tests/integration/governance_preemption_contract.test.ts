/**
 * Governance Contract — Preemption Rules.
 * Verifies: equal priority, lower preempt higher, protected, CRITICAL vs CRITICAL, cooldown.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import { executeCampaignPreemption, PreemptionValidationError } from '../../services/CampaignPreemptionService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

function chainArray(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const VALID_JUSTIFICATION = 'Revenue-critical board commitment for Q4 launch.';

describe('Governance Contract — Preemption Rules', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. Equal priority → cannot preempt', async () => {
    const initiatorId = 'campaign-a-uuid';
    const preemptedId = 'campaign-b-uuid';

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: initiatorId, priority_level: 'NORMAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            { id: preemptedId, priority_level: 'NORMAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    await expect(
      executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        justification: VALID_JUSTIFICATION,
      })
    ).rejects.toThrow(PreemptionValidationError);

    await expect(
      executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        justification: VALID_JUSTIFICATION,
      })
    ).rejects.toThrow(/equal priority|cannot preempt/i);
  });

  it('2. Lower priority cannot preempt higher', async () => {
    const initiatorId = 'campaign-low-uuid';
    const preemptedId = 'campaign-high-uuid';

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: initiatorId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            { id: preemptedId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    await expect(
      executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        justification: VALID_JUSTIFICATION,
      })
    ).rejects.toThrow('Initiator priority must be higher');
  });

  it('3. Protected target → requires approval', async () => {
    const initiatorId = 'campaign-high-uuid';
    const targetId = 'campaign-protected-uuid';
    const requestId = 'request-uuid-123';

    let campaignsCallCount = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        campaignsCallCount++;
        if (campaignsCallCount === 1) {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
              { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: true },
            ],
            error: null,
          });
        }
      }
      if (table === 'campaign_preemption_requests') {
        return chainArray({ data: { id: requestId }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await executeCampaignPreemption({
      initiatorCampaignId: initiatorId,
      preemptedCampaignId: targetId,
      justification: VALID_JUSTIFICATION,
    });

    expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
    expect(result).toHaveProperty('requestId', requestId);
  });

  it('4. CRITICAL vs CRITICAL → requires approval', async () => {
    const initiatorId = 'campaign-critical-1';
    const targetId = 'campaign-critical-2';
    const requestId = 'request-uuid-456';

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: initiatorId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
            { id: targetId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
          ],
          error: null,
        });
      }
      if (table === 'campaign_preemption_requests') {
        return chainArray({ data: { id: requestId }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await executeCampaignPreemption({
      initiatorCampaignId: initiatorId,
      preemptedCampaignId: targetId,
      justification: VALID_JUSTIFICATION,
    });

    expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
    expect(result).toHaveProperty('requestId', requestId);
  });

  it('5. Cooldown active → reject unless initiator CRITICAL', async () => {
    const initiatorId = 'campaign-high-uuid';
    const targetId = 'campaign-low-uuid';
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chainArray({
          data: [
            { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
            { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: oneHourAgo },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    await expect(
      executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: VALID_JUSTIFICATION,
      })
    ).rejects.toThrow('Preemption cooldown active');

    const criticalInitiatorId = 'campaign-critical-uuid';
    let campaignsCallCount = 0;
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        campaignsCallCount++;
        return chainArray({
          data:
            campaignsCallCount <= 2
              ? [
                  { id: criticalInitiatorId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
                  { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: oneHourAgo },
                ]
              : [],
          error: null,
        });
      }
      if (table === 'campaign_preemption_log') {
        return chainArray({ data: { id: 'log-id', justification: VALID_JUSTIFICATION }, error: null });
      }
      return chain({ data: null, error: null });
    });

    const result = await executeCampaignPreemption({
      initiatorCampaignId: criticalInitiatorId,
      preemptedCampaignId: targetId,
      justification: VALID_JUSTIFICATION,
    });

    expect('success' in result && result.success).toBe(true);
  });
});
