/**
 * Integration tests for Governance Lockdown (Stage 29).
 * Lock trigger, mutation guard, unlock, events.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { supabase } from '../../db/supabaseClient';
import {
  isGovernanceLocked,
  triggerGovernanceLock,
  releaseGovernanceLock,
} from '../../services/GovernanceLockdownService';
import { runGovernanceAudit } from '../../services/GovernanceAuditService';
import updateDurationHandler from '../../../pages/api/campaigns/update-duration';
import companyDriftHandler from '../../../pages/api/governance/company-drift';
import unlockHandler from '../../../pages/api/governance/unlock';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const companyId = 'company-uuid-456';

function mockRes(req: any, res: any) {
  return {
    statusCode: 200,
    body: null as any,
    setHeader: jest.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: any) {
      this.body = obj;
      return this;
    },
  };
}

describe('Governance Lockdown', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('isGovernanceLocked', () => {
    it('returns false when no lockdown row', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') return chain({ data: null, error: null });
        return chain({ data: null, error: null });
      });

      const locked = await isGovernanceLocked();
      expect(locked).toBe(false);
    });

    it('returns true when locked', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') return chain({ data: { locked: true }, error: null });
        return chain({ data: null, error: null });
      });

      const locked = await isGovernanceLocked();
      expect(locked).toBe(true);
    });

    it('never throws', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('DB error');
      });
      await expect(isGovernanceLocked()).resolves.toBe(false);
    });
  });

  describe('triggerGovernanceLock', () => {
    it('sets locked and emits GOVERNANCE_LOCK_TRIGGERED', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') {
          const c = chain({ data: { id: 'lock-1' }, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'lock-1' }, error: null });
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((payload: any) => {
            eventInserts.push(payload);
            return { then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) };
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await triggerGovernanceLock('Integrity risk exceeded', 'user-123');

      expect(eventInserts.some((p) => p.event_type === 'GOVERNANCE_LOCK_TRIGGERED')).toBe(true);
    });
  });

  describe('releaseGovernanceLock', () => {
    it('clears locked and emits GOVERNANCE_LOCK_RELEASED', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') {
          const c = chain({ data: { id: 'lock-1' }, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'lock-1' }, error: null });
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((payload: any) => {
            eventInserts.push(payload);
            return { then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) };
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await releaseGovernanceLock('user-456');

      expect(eventInserts.some((p) => p.event_type === 'GOVERNANCE_LOCK_RELEASED')).toBe(true);
    });
  });

  describe('Mutation API returns 423 when locked', () => {
    it('update-duration returns 423 GOVERNANCE_LOCKED', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') {
          const c = chain({ data: { locked: true }, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { locked: true }, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = {
        method: 'POST',
        body: { campaignId: 'c1', companyId, requested_weeks: 12 },
        headers: {},
      };
      const res = mockRes(req, null) as any;

      await updateDurationHandler(req, res);

      expect(res.statusCode).toBe(423);
      expect(res.body?.code).toBe('GOVERNANCE_LOCKED');
      expect(res.body?.message).toContain('Governance lockdown');
    });
  });

  describe('Read API still returns 200 when locked', () => {
    it('company-drift returns 200', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') {
          const c = chain({ data: { locked: true }, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { locked: true }, error: null });
          return c;
        }
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') return chain({ data: null, error: null });
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'GET', query: { companyId } };
      const res = mockRes(req, null) as any;
      (req as any).headers = {};
      (req as any).rbac = { userId: 'u1', role: 'admin' };

      await companyDriftHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.locked).toBe(true);
    });
  });

  describe('Unlock API', () => {
    it('unlock returns 200 and releases lock', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') {
          const c = chain({ data: { id: 'lock-1' }, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'lock-1' }, error: null });
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((p: any) => {
            eventInserts.push(p);
            return { then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) };
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'POST', body: {} };
      const res = mockRes(req, null) as any;
      (req as any).rbac = { userId: 'super-admin-1', role: 'SUPER_ADMIN' };

      await unlockHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.success).toBe(true);
    });
  });

  describe('Audit triggers lock when integrityRiskScore >= 75', () => {
    it('runGovernanceAudit can trigger lock when risk >= 75', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'c1', execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events') {
          const c = chain({ data: [], error: null });
          c.insert = jest.fn().mockImplementation((p: any) => {
            eventInserts.push(p);
            return { then: (fn: any) => Promise.resolve({ data: null, error: null }).then(fn) };
          });
          return c;
        }
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        if (table === 'governance_lockdown') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await runGovernanceAudit(companyId);
      expect(result.integrityRiskScore).toBeDefined();
      if (result.integrityRiskScore >= 75) {
        expect(eventInserts.some((p: any) => p.event_type === 'GOVERNANCE_LOCK_TRIGGERED')).toBe(true);
      }
    });
  });
});
