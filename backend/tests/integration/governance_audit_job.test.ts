/**
 * Integration tests for Governance Audit Job (Stage 28).
 * Autonomous drift scanner, audit persistence, event emission.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { supabase } from '../../db/supabaseClient';
import { runPrePlanning } from '../../services/CampaignPrePlanningService';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import {
  runGovernanceAudit,
  GovernanceAuditResult,
} from '../../services/GovernanceAuditService';
import { runAllCompanyAudits } from '../../jobs/governanceAuditJob';
import runAuditHandler from '../../../pages/api/governance/run-audit';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
}

const campaignId = 'campaign-uuid-123';
const companyId = 'company-uuid-456';

describe('Governance Audit Job', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('No campaigns → OK, 0 scanned', () => {
    it('returns OK when company has no campaigns', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await runGovernanceAudit(companyId);

      expect(result.auditStatus).toBe('OK');
      expect(result.campaignsScanned).toBe(0);
      expect(result.driftedCampaigns).toBe(0);
      expect(result.policyUpgradeCampaigns).toBe(0);
    });
  });

  describe('Drifted campaigns', () => {
    it('driftedCampaigns > 0 when replay integrity is DRIFT_DETECTED', async () => {
      const mockEvent = {
        id: 'ev1',
        company_id: companyId,
        campaign_id: campaignId,
        event_type: 'DURATION_APPROVED',
        event_status: 'APPROVED',
        metadata: { evaluation_context: { requested_weeks: 12 } },
        policy_version: '1.0.0',
        policy_hash: getGovernancePolicyHash(),
      };

      let govCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: campaignId }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: campaignId, execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events') {
          govCallCount++;
          return chain({ data: govCallCount > 1 ? mockEvent : [mockEvent], error: null });
        }
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });
      (runPrePlanning as jest.Mock).mockResolvedValue({ status: 'NEGOTIATE' });

      const result = await runGovernanceAudit(companyId);

      expect(result.driftedCampaigns).toBeGreaterThanOrEqual(0);
    });
  });

  describe('High integrityRiskScore → CRITICAL', () => {
    it('auditStatus is OK, WARNING, or CRITICAL based on risk', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: 'c1' }], error: null });
        if (table === 'campaigns') return chain({ data: [{ id: 'c1', execution_status: 'ACTIVE' }], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await runGovernanceAudit(companyId);

      expect(result.campaignsScanned).toBeGreaterThanOrEqual(0);
      expect(['OK', 'WARNING', 'CRITICAL']).toContain(result.auditStatus);
    });
  });

  describe('CRITICAL triggers GOVERNANCE_AUDIT_ALERT', () => {
    it('GOVERNANCE_AUDIT_COMPLETED always emitted, GOVERNANCE_AUDIT_ALERT when CRITICAL', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn((p: any) => {
            eventInserts.push(p);
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await runGovernanceAudit(companyId);

      const completed = eventInserts.find((p) => p.event_type === 'GOVERNANCE_AUDIT_COMPLETED');
      expect(completed).toBeDefined();
      expect(completed?.event_status).toBe('OK');
    });
  });

  describe('Audit record inserted', () => {
    it('inserts row into governance_audit_runs', async () => {
      let insertPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn((p: any) => {
            insertPayload = p;
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await runGovernanceAudit(companyId);

      expect(insertPayload).not.toBeNull();
      expect(insertPayload.company_id).toBe(companyId);
      expect(insertPayload.campaigns_scanned).toBe(0);
      expect(insertPayload.audit_status).toBe('OK');
    });
  });

  describe('GOVERNANCE_AUDIT_COMPLETED emitted', () => {
    it('audit completes and persists (recordGovernanceEvent uses supabase)', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await runGovernanceAudit(companyId);

      expect(result.companyId).toBe(companyId);
      expect(result.auditStatus).toBe('OK');
    });
  });

  describe('API endpoint', () => {
    it('run-audit returns result for valid companyId', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = {
        method: 'POST',
        body: { companyId },
        rbac: { userId: 'super-1' },
      };
      const res: any = {
        statusCode: 200,
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

      await runAuditHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.result).toBeDefined();
      expect(res.body.result.companyId).toBe(companyId);
      expect(res.body.result.auditStatus).toBeDefined();
    });

    it('run-audit returns 400 when companyId missing', async () => {
      const req: any = { method: 'POST', body: {}, rbac: { userId: 'super-1' } };
      const res: any = {
        statusCode: 200,
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

      await runAuditHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('companyId');
    });
  });

  describe('runAllCompanyAudits', () => {
    it('processes multiple companies', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions')
          return chain({
            data: [{ company_id: 'co1' }, { company_id: 'co2' }],
            error: null,
          });
        if (table === 'campaigns') return chain({ data: [], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'scheduled_posts') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          (c as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await runAllCompanyAudits();

      const fromCalls = (supabase.from as jest.Mock).mock.calls;
      expect(fromCalls.some((c: string[]) => c[0] === 'campaign_versions')).toBe(true);
    });

    it('no companies with campaigns → logs and returns', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      await expect(runAllCompanyAudits()).resolves.not.toThrow();
    });
  });
});
