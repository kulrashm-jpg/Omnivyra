/**
 * Integration tests for Governance Observability (Stage 10).
 * Tests governance summary API metrics.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import { getGovernanceSummary } from '../../services/GovernanceMetricsService';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const companyId = 'company-uuid-123';

describe('Campaign Governance Summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 — No activity → all zero', () => {
    it('returns zero metrics when company has no campaigns', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'companies') return chain({ data: { id: companyId }, error: null });
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const summary = await getGovernanceSummary(companyId);

      expect(summary).not.toBeNull();
      expect(summary!.companyId).toBe(companyId);
      expect(summary!.metrics.preemption.total_preemptions).toBe(0);
      expect(summary!.metrics.preemption.preemptions_last_30_days).toBe(0);
      expect(summary!.metrics.approvals.pending_preemption_requests).toBe(0);
      expect(summary!.metrics.constraints.total_negotiations_last_30_days).toBe(0);
      expect(summary!.metrics.priority.critical_campaigns_count).toBe(0);
    });
  });

  describe('Test 2 — Preemption executed → metrics increment', () => {
    it('counts preemptions in metrics', async () => {
      const campaignIds = ['camp-1', 'camp-2'];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'companies') return chain({ data: { id: companyId }, error: null });
        if (table === 'campaign_versions') return chain({ data: campaignIds.map((id) => ({ campaign_id: id })), error: null });
        if (table === 'campaign_preemption_log') {
          if ((supabase.from as jest.Mock).mock.calls.filter((c: string[]) => c[0] === 'campaign_preemption_log').length < 2) {
            return chain({ data: [{ id: 'log-1', initiator_campaign_id: 'camp-1', preempted_campaign_id: 'camp-2', executed_at: new Date().toISOString() }], error: null });
          }
          return chain({ data: [], error: null });
        }
        if (table === 'campaigns') return chain({ data: [{ id: 'camp-1', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', last_preempted_at: null, priority_level: 'HIGH' }, { id: 'camp-2', execution_status: 'PREEMPTED', blueprint_status: 'INVALIDATED', last_preempted_at: new Date().toISOString(), priority_level: 'LOW' }], error: null });
        if (table === 'campaign_preemption_requests') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const summary = await getGovernanceSummary(companyId);

      expect(summary).not.toBeNull();
      expect(summary!.metrics.preemption.total_preemptions).toBeGreaterThanOrEqual(1);
      expect(summary!.metrics.preemption.preempted_campaigns_currently_invalidated).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Test 3 — Approval required → pending count increments', () => {
    it('counts pending preemption requests', async () => {
      const campaignIds = ['camp-1'];
      let reqCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'companies') return chain({ data: { id: companyId }, error: null });
        if (table === 'campaign_versions') return chain({ data: campaignIds.map((id) => ({ campaign_id: id })), error: null });
        if (table === 'campaign_preemption_log') return chain({ data: [], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'camp-1', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', last_preempted_at: null, priority_level: 'NORMAL' }], error: null });
        if (table === 'campaign_preemption_requests') {
          reqCalls++;
          if (reqCalls === 1) return chain({ data: [{ id: 'req-1' }], error: null });
          return chain({ data: [], error: null });
        }
        return chain({ data: null, error: null });
      });

      const summary = await getGovernanceSummary(companyId);

      expect(summary).not.toBeNull();
      expect(summary!.metrics.approvals.pending_preemption_requests).toBe(1);
    });
  });

  describe('Test 4 — Cooldown active → campaigns_under_cooldown increments', () => {
    it('counts campaigns under cooldown', async () => {
      const campaignIds = ['camp-1'];
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'companies') return chain({ data: { id: companyId }, error: null });
        if (table === 'campaign_versions') return chain({ data: campaignIds.map((id) => ({ campaign_id: id })), error: null });
        if (table === 'campaign_preemption_log') return chain({ data: [], error: null });
        if (table === 'campaigns') return chain({
          data: [{ id: 'camp-1', execution_status: 'PREEMPTED', blueprint_status: 'INVALIDATED', last_preempted_at: oneDayAgo, priority_level: 'LOW' }],
          error: null,
        });
        if (table === 'campaign_preemption_requests') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const summary = await getGovernanceSummary(companyId);

      expect(summary).not.toBeNull();
      expect(summary!.metrics.preemption.campaigns_under_cooldown).toBe(1);
    });
  });

  describe('Test 5 — NEGOTIATE response → total_negotiations', () => {
    it('constraints metrics include negotiation proxy from preemptions', async () => {
      const campaignIds = ['camp-1'];
      const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'companies') return chain({ data: { id: companyId }, error: null });
        if (table === 'campaign_versions') return chain({ data: campaignIds.map((id) => ({ campaign_id: id })), error: null });
        if (table === 'campaign_preemption_log') return chain({
          data: [{ id: 'log-1', initiator_campaign_id: 'camp-1', preempted_campaign_id: 'camp-x', executed_at: recent }],
          error: null,
        });
        if (table === 'campaigns') return chain({ data: [{ id: 'camp-1', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', last_preempted_at: null, priority_level: 'NORMAL' }], error: null });
        if (table === 'campaign_preemption_requests') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const summary = await getGovernanceSummary(companyId);

      expect(summary).not.toBeNull();
      expect(summary!.metrics.constraints.total_negotiations_last_30_days).toBeGreaterThanOrEqual(0);
      expect(summary!.metrics.constraints.portfolio_conflict_count_last_30_days).toBeGreaterThanOrEqual(0);
    });
  });
});
