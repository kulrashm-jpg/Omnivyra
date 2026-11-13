/**
 * Integration tests for Protected Campaigns & Approval Workflow (Stage 9B).
 * Tests: Protected target, CRITICAL target, Approve flow, Reject flow, Portfolio capacity after approval.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/PortfolioTimelineProjection', () => ({
  calculateEarliestViableStartDate: jest.fn().mockResolvedValue(null),
}));

import { supabase } from '../../db/supabaseClient';
import {
  executeCampaignPreemption,
  executePreemptionFromRequest,
  rejectPreemptionRequest,
  PreemptionValidationError,
} from '../../services/CampaignPreemptionService';
import { evaluatePortfolioConstraints } from '../../services/PortfolioConstraintEvaluator';

// Cross-tenant fix (6f, 2026-11-13): a preemption now REQUIRES companyId and both campaigns canonically owned by it.
// This suite tests preemption RULES, not tenancy (s2PreemptionCrossTenant pins that): it names a test company and
// answers ownership 'owned'.
const PREEMPT_TEST_COMPANY = '9e9e9e9e-0000-4000-8000-000000000001';
jest.mock('../../services/campaignOwnershipService', () => ({
  ...jest.requireActual('../../services/campaignOwnershipService'),
  checkCampaignOwnership: jest.fn(async () => 'owned'),
}));

type ChainResult = { data: any; error: any };

// S2 tenant seam: tenantChildTable verifies the parent campaign with select('company_id').eq('id', ...).limit(...);
// that one read answers with the authorized test company (the campaigns are owned by it - checkCampaignOwnership is
// mocked 'owned' above). Every other select behaves as before.
const tenantParentRead = () => {
  const r = { data: [{ company_id: PREEMPT_TEST_COMPANY }], error: null };
  const p: any = { eq: () => p, limit: () => p, then: (resolve: any) => Promise.resolve(r).then(resolve) };
  return p;
};
// The seam's direct-parent check: tenantTable('campaigns').select('id').eq('company_id', co).eq('id', x).maybeSingle().
// With a company filter, the row exists only for the authorized test company; without one, the original fake answers.
let parentReadFails = false; // simulate a FAILED parent-campaign read (statement timeout)
const tenantScopedIdRead = (base: any) => {
  const filters: Array<[string, unknown]> = [];
  const p: any = Object.create(base);
  p.eq = (k: string, v: unknown) => { filters.push([k, v]); return p; };
  p.maybeSingle = async () => {
    const co = filters.find(([k]) => k === 'company_id');
    if (!co) return base.maybeSingle();
    if (parentReadFails) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const id = filters.find(([k]) => k === 'id');
    return { data: co[1] === PREEMPT_TEST_COMPANY && id ? { id: id[1] } : null, error: null };
  };
  return p;
};
function chain(result: ChainResult) {
  const mock = {
    select: jest.fn(function (this: any, cols?: string) { return cols === 'company_id' ? tenantParentRead() : cols === 'id' ? tenantScopedIdRead(this) : this; }),
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
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

describe('Campaign Preemption Approval Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 — Protected campaign', () => {
    it('returns APPROVAL_REQUIRED, no execution_status change', async () => {
      const initiatorId = 'campaign-high-uuid';
      const targetId = 'campaign-protected-uuid';
      const requestId = 'request-uuid-123';

      let campaignsCallCount = 0;
      let requestsCallCount = 0;
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
          requestsCallCount++;
          return chainArray({
            data: { id: requestId },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await executeCampaignPreemption({
        companyId: PREEMPT_TEST_COMPANY,
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(result).toHaveProperty('requestId', requestId);

      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_requests')).toBe(true);
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_log')).toBe(false);
    });
  });

  describe('Test 2 — CRITICAL target', () => {
    it('returns APPROVAL_REQUIRED when target is CRITICAL (same-rank CRITICAL vs CRITICAL)', async () => {
      const initiatorId = 'campaign-critical-uuid';
      const targetId = 'campaign-critical-target-uuid';
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
        companyId: PREEMPT_TEST_COMPANY,
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(result).toHaveProperty('requestId', requestId);
    });

    it('returns APPROVAL_REQUIRED when target is protected (HIGH initiator preempts protected LOW)', async () => {
      const initiatorId = 'campaign-high-uuid';
      const targetId = 'campaign-protected-low-uuid';
      const requestId = 'request-uuid-789';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({
            data: [
              { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false },
              { id: targetId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: true },
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
        companyId: PREEMPT_TEST_COMPANY,
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: targetId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
      });

      expect(result).toHaveProperty('status', 'APPROVAL_REQUIRED');
      expect(result).toHaveProperty('requestId', requestId);
    });
  });

  describe('Test 3 — Approve flow', () => {
    it('execution_status updated, request marked EXECUTED, log entry exists', async () => {
      const requestId = 'request-approve-uuid';
      const initiatorId = 'campaign-initiator-uuid';
      const targetId = 'campaign-target-uuid';
      const logId = 'log-uuid-approve';

      let reqCalls = 0;
      let campCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          reqCalls++;
          if (reqCalls === 1) {
            const c = chain({ data: null, error: null });
            c.maybeSingle = jest.fn().mockResolvedValue({
              data: { id: requestId, initiator_campaign_id: initiatorId, target_campaign_id: targetId, status: 'PENDING' },
              error: null,
            });
            return c;
          }
          return chain({ data: null, error: null });
        }
        if (table === 'campaigns') {
          campCalls++;
          if (campCalls === 1) {
            return chainArray({
              data: [
                { id: initiatorId, priority_level: 'CRITICAL', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
                { id: targetId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
              ],
              error: null,
            });
          }
          return chain({ data: null, error: null });
        }
        if (table === 'campaign_preemption_log') {
          return chainArray({ data: { id: logId }, error: null });
        }
        return chain({ data: null, error: null });
      });

      const result = await executePreemptionFromRequest(
        requestId,
        'Approved: revenue-critical board commitment for Q4 launch.',
        PREEMPT_TEST_COMPANY,
      );

      expect(result.success).toBe(true);
      expect(result.preemptedCampaignId).toBe(targetId);
      expect(result.preemptedExecutionStatus).toBe('PREEMPTED');
      expect(result.logId).toBe(logId);

      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_preemption_requests')).toBe(true);
    });
  });

  describe('Test 4 — Reject flow', () => {
    it('request marked REJECTED, no execution', async () => {
      const requestId = 'request-reject-uuid';
      const initiatorId = 'campaign-initiator-uuid';
      let reqCalls = 0;

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          reqCalls++;
          const c = chain({ data: null, error: null });
          if (reqCalls === 1) {
            c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: requestId, initiator_campaign_id: initiatorId, status: 'PENDING' }, error: null });
          }
          return c;
        }
        return chain({ data: null, error: null });
      });

      await rejectPreemptionRequest(requestId, PREEMPT_TEST_COMPANY);

      expect(reqCalls).toBeGreaterThanOrEqual(2);
    });

    it('S2 NEGATIVE CONTROL: a company that does not own the initiator campaign is refused; nothing is written', async () => {
      const requestId = 'request-foreign-uuid';
      const OTHER_COMPANY = 'f0000000-0000-4000-8000-0000000000ff';
      const updates: unknown[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'campaign_preemption_requests') {
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: requestId, initiator_campaign_id: 'campaign-initiator-uuid', status: 'PENDING' }, error: null });
          c.update = jest.fn((v: unknown) => { updates.push(v); return c; });
        }
        return c;
      });
      await expect(rejectPreemptionRequest(requestId, OTHER_COMPANY)).rejects.toThrow('Preemption request not found.');
      expect(updates).toEqual([]);
    });

    it('a FAILED parent read is NOT "not found": it surfaces as a retryable error, nothing written (6f review)', async () => {
      const requestId = 'request-unreadable-uuid';
      const updates: unknown[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'campaign_preemption_requests') {
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: requestId, initiator_campaign_id: 'campaign-initiator-uuid', status: 'PENDING' }, error: null });
          c.update = jest.fn((v: unknown) => { updates.push(v); return c; });
        }
        return c;
      });
      parentReadFails = true;
      try {
        const err = await rejectPreemptionRequest(requestId, PREEMPT_TEST_COMPANY).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(PreemptionValidationError); // the route maps that one to a permanent 400
        expect(String((err as Error).message)).toMatch(/^TENANT_PARENT_UNREADABLE/);
        expect(updates).toEqual([]);
      } finally {
        parentReadFails = false;
      }
    });

    it('throws when request is not PENDING', async () => {
      const requestId = 'request-already-executed';

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_preemption_requests') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: requestId, status: 'EXECUTED' }, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await expect(rejectPreemptionRequest(requestId, PREEMPT_TEST_COMPANY)).rejects.toThrow(PreemptionValidationError);
      await expect(rejectPreemptionRequest(requestId, PREEMPT_TEST_COMPANY)).rejects.toThrow('not pending');
    });
  });

  describe('Test 5 — Capacity recalculation after approval (PAUSED exclusion)', () => {
    it('PAUSED campaigns excluded from overlap; no team_overlap constraint', async () => {
      const campaignB = 'campaign-b';
      const campaignA = 'campaign-a';
      const teamId = 'team-1';
      const rangeStart = '2025-03-01';
      const rangeEnd = '2025-03-31';

      let fromCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls++;
        if (table === 'campaign_team_assignment') {
          if (fromCalls === 1) return chain({ data: { team_id: teamId }, error: null });
          return chainArray({
            data: [{ campaign_id: campaignA, weekly_capacity_reserved: 8, start_date: rangeStart, end_date: rangeEnd }],
            error: null,
          });
        }
        if (table === 'team_capacity') {
          return chain({ data: { max_posts_per_week: 10, max_parallel_campaigns: 3 }, error: null });
        }
        if (table === 'campaigns') {
          return chainArray({ data: [{ id: campaignA, execution_status: 'PAUSED' }], error: null });
        }
        return chain({ data: null, error: null });
      });

      const output = await evaluatePortfolioConstraints({
        campaignId: campaignB,
        companyId: 'company-1',
        requestedDurationWeeks: 4,
        requestedPostsPerWeek: 5,
        startDate: rangeStart,
        endDate: rangeEnd,
        existing_content_count: 20,
      });

      const overlapConstraint = output.constraints.find((r) => r.name === 'team_overlap');
      expect(overlapConstraint).toBeUndefined();
    });
  });
});
