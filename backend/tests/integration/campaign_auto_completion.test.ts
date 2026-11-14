/**
 * Auto Completion Trigger Integration Tests.
 * When all scheduled posts are published and no future posts exist,
 * execution_status transitions to COMPLETED and CAMPAIGN_COMPLETED is emitted.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { checkAndCompleteCampaignIfEligible } from '../../services/CampaignCompletionService';
import { recordGovernanceEvent, recordCampaignCompletedEvent } from '../../services/GovernanceEventService';
import { supabase } from '../../db/supabaseClient';

const CAMPAIGN_ID = 'campaign-auto-123';
// S2: a real (uuid) company on the campaign row - the seam derives the tenant from campaigns.company_id
const COMPANY_ID = 'c0a17000-0000-4000-8000-000000000456';

// S2: the seam calls update(payload, options) and adds .eq('company_id', ...) after the caller's .eq('id', ...).
// Record the payload the assertions are about; keep the filter chain awaitable ({ error: null }) at any depth.
function seamUpdate(spy: jest.Mock, payload: unknown) {
  spy(payload);
  const q: any = { eq: () => q, then: (ok: any, ko: any) => Promise.resolve({ error: null }).then(ok, ko) };
  return q;
}

function chain(result: { data: any; error: any }) {
  const q: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockImplementation(() => Promise.resolve(result)),
    update: jest.fn((payload: unknown) => seamUpdate(jest.fn(), payload)),
  };
  q.then = (resolve: any) => Promise.resolve(result).then(resolve);
  return q;
}

jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
  recordCampaignCompletedEvent: jest.fn().mockResolvedValue(undefined),
}));

describe('Campaign Auto Completion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
    (recordCampaignCompletedEvent as jest.Mock).mockResolvedValue(undefined);
  });

  it('all posts published → campaign becomes COMPLETED', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const campaignsUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        let callCount = 0;
        const c: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          // S2: the seam calls update(payload, options); record the payload the assertions are about.
          update: (payload: unknown) => seamUpdate(campaignsUpdate, payload),
        };
        c.maybeSingle = jest.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            data: callCount <= 2 ? { id: CAMPAIGN_ID, company_id: COMPANY_ID, execution_status: 'ACTIVE' } : null,
            error: null,
          });
        });
        return c;
      }
      if (table === 'scheduled_posts') {
        return chain({
          data: [
            { id: 'p1', status: 'published', scheduled_for: pastDate },
            { id: 'p2', status: 'published', scheduled_for: pastDate },
          ],
          error: null,
        });
      }
      if (table === 'campaign_versions') {
        return chain({ data: { company_id: COMPANY_ID }, error: null });
      }
      return chain({ data: null, error: null });
    });

    await checkAndCompleteCampaignIfEligible(CAMPAIGN_ID);

    expect(campaignsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        execution_status: 'COMPLETED',
      })
    );
    expect(recordGovernanceEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'EXECUTION_STATE_TRANSITION',
        metadata: expect.objectContaining({ from: 'ACTIVE', to: 'COMPLETED' }),
      })
    );
    expect(recordCampaignCompletedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: CAMPAIGN_ID,
        totalScheduledPosts: 2,
      })
    );
  });

  it('some unpublished → no completion', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return chain({ data: { id: CAMPAIGN_ID, company_id: COMPANY_ID, execution_status: 'ACTIVE' }, error: null });
      }
      if (table === 'scheduled_posts') {
        return chain({
          data: [
            { id: 'p1', status: 'published', scheduled_for: pastDate },
            { id: 'p2', status: 'scheduled', scheduled_for: pastDate },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    const campaignsUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        const c: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          // S2: the seam calls update(payload, options); record the payload the assertions are about.
          update: (payload: unknown) => seamUpdate(campaignsUpdate, payload),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: CAMPAIGN_ID, company_id: COMPANY_ID, execution_status: 'ACTIVE' }, error: null }),
        };
        return c;
      }
      if (table === 'scheduled_posts') {
        return chain({
          data: [
            { id: 'p1', status: 'published', scheduled_for: pastDate },
            { id: 'p2', status: 'scheduled', scheduled_for: pastDate },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    await checkAndCompleteCampaignIfEligible(CAMPAIGN_ID);

    expect(campaignsUpdate).not.toHaveBeenCalled();
    expect(recordCampaignCompletedEvent).not.toHaveBeenCalled();
  });

  it('future scheduled posts exist → no completion', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        const c: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          update: jest.fn((payload: unknown) => seamUpdate(jest.fn(), payload)),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: CAMPAIGN_ID, company_id: COMPANY_ID, execution_status: 'ACTIVE' }, error: null }),
        };
        return c;
      }
      if (table === 'scheduled_posts') {
        return chain({
          data: [
            { id: 'p1', status: 'published', scheduled_for: futureDate },
            { id: 'p2', status: 'published', scheduled_for: futureDate },
          ],
          error: null,
        });
      }
      return chain({ data: null, error: null });
    });

    await checkAndCompleteCampaignIfEligible(CAMPAIGN_ID);

    const updateCalls = (supabase.from as jest.Mock).mock.results
      .filter((r: any) => r.value?.update)
      .map((r: any) => r.value.update?.mock?.calls);
    const didUpdateCampaign = updateCalls.some((calls: any) => calls?.length > 0);
    expect(didUpdateCampaign).toBe(false);
    expect(recordCampaignCompletedEvent).not.toHaveBeenCalled();
  });

  it('COMPLETED does not re-transition', async () => {
    const campaignsUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        const c: any = chain({ data: { id: CAMPAIGN_ID, company_id: COMPANY_ID, execution_status: 'COMPLETED' }, error: null });
        c.update = (payload: unknown) => seamUpdate(campaignsUpdate, payload); // S2: the seam passes update(payload, options)
        return c;
      }
      return chain({ data: null, error: null });
    });

    await checkAndCompleteCampaignIfEligible(CAMPAIGN_ID);

    expect(campaignsUpdate).not.toHaveBeenCalled();
    expect(recordCampaignCompletedEvent).not.toHaveBeenCalled();
  });

  it('emits CAMPAIGN_COMPLETED once when eligible', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        const c: any = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          update: jest.fn((payload: unknown) => seamUpdate(jest.fn(), payload)),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: CAMPAIGN_ID, company_id: COMPANY_ID, execution_status: 'ACTIVE' }, error: null }),
        };
        return c;
      }
      if (table === 'scheduled_posts') {
        return chain({
          data: [{ id: 'p1', status: 'published', scheduled_for: pastDate }],
          error: null,
        });
      }
      if (table === 'campaign_versions') {
        return chain({ data: { company_id: COMPANY_ID }, error: null });
      }
      return chain({ data: null, error: null });
    });

    await checkAndCompleteCampaignIfEligible(CAMPAIGN_ID);

    expect(recordCampaignCompletedEvent).toHaveBeenCalledTimes(1);
    expect(recordCampaignCompletedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        campaignId: CAMPAIGN_ID,
        totalScheduledPosts: 1,
      })
    );
  });
});
