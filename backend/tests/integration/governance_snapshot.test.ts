/**
 * Integration tests for Governance Snapshot (Stage 30).
 * Snapshot, restore, verify. Recovery-only, read-mostly.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { supabase } from '../../db/supabaseClient';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import {
  createGovernanceSnapshot,
  restoreGovernanceSnapshot,
  verifySnapshotIntegrity,
  SnapshotPolicyMismatchError,
  type GovernanceSnapshotResult,
} from '../../services/GovernanceSnapshotService';
import snapshotHandler from '../../../pages/api/governance/snapshot';
import restoreSnapshotHandler from '../../../pages/api/governance/restore-snapshot';
import verifySnapshotHandler from '../../../pages/api/governance/verify-snapshot';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
    insert: jest.fn().mockResolvedValue({ data: { id: 'snap-1' }, error: null }),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const companyId = 'company-uuid-456';
const campaignId = 'campaign-uuid-123';
const policyHash = getGovernancePolicyHash();

function mockRes() {
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

describe('Governance Snapshot', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('createGovernanceSnapshot', () => {
    it('creates FULL snapshot with GovernanceSnapshotResult structure', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: campaignId }], error: null });
        if (table === 'governance_lockdown') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') return chain({ data: [], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'snap-full-1' }, error: null }),
            }),
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await createGovernanceSnapshot({
        companyId,
        snapshotType: 'FULL',
        userId: 'user-1',
      });

      expect(result).toMatchObject({
        snapshotId: 'snap-full-1',
        companyId,
        snapshotType: 'FULL',
        policyVersion: '1.0.0',
        policyHash,
      });
      expect(result.snapshotId).toBeDefined();
    });

    it('creates CAMPAIGN snapshot when campaignId provided', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_lockdown') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') return chain({ data: [], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [{ id: 'e1', campaign_id: campaignId }], error: null });
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'snap-campaign-1' }, error: null }),
            }),
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await createGovernanceSnapshot({
        companyId,
        campaignId,
        snapshotType: 'CAMPAIGN',
      });

      expect(result.snapshotType).toBe('CAMPAIGN');
      expect(result.snapshotId).toBe('snap-campaign-1');
    });
  });

  describe('restoreGovernanceSnapshot', () => {
    it('restores when policy hash matches', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-1',
              company_id: companyId,
              snapshot_type: 'FULL',
              policy_hash: policyHash,
              snapshot_data: {
                governance_lockdown: [{ id: 'lock-1', locked: false }],
                governance_audit_runs: [],
                campaign_governance_events: [],
                summary: { eventCount: 0, auditCount: 0, policyHash },
              },
            },
            error: null,
          });
          return c;
        }
        if (table === 'governance_lockdown') return chain({ data: { id: 'lock-1' }, error: null });
        if (table === 'governance_audit_runs') return chain({ data: null, error: null });
        if (table === 'campaign_governance_events') return chain({ data: null, error: null });
        if (table === 'campaign_governance_events') return chain({ data: null, error: null });
        return chain({ data: null, error: null });
      });

      const mockFrom = supabase.from as jest.Mock;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-1',
              company_id: companyId,
              snapshot_type: 'FULL',
              policy_hash: policyHash,
              snapshot_data: {
                governance_lockdown: [{ id: 'lock-1', locked: false }],
                governance_audit_runs: [],
                campaign_governance_events: [],
                summary: { eventCount: 0, auditCount: 0, policyHash },
              },
            },
            error: null,
          });
          return c;
        }
        if (table === 'governance_lockdown') return chain({ data: { id: 'lock-1' }, error: null });
        if (table === 'governance_audit_runs') return chain({ data: null, error: null });
        if (table === 'campaign_governance_events') return chain({ data: null, error: null });
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((p: any) => {
            eventInserts.push(p);
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await restoreGovernanceSnapshot('snap-1');
      expect(result.restored).toBe(true);
    });

    it('throws SnapshotPolicyMismatchError when policy hash mismatches', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-1',
              company_id: companyId,
              snapshot_type: 'FULL',
              policy_hash: 'wrong-hash-123',
              snapshot_data: { governance_lockdown: [], governance_audit_runs: [], campaign_governance_events: [], summary: { eventCount: 0, auditCount: 0, policyHash: 'wrong' } },
            },
            error: null,
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await expect(restoreGovernanceSnapshot('snap-1')).rejects.toThrow(SnapshotPolicyMismatchError);
    });
  });

  describe('verifySnapshotIntegrity', () => {
    it('returns valid when snapshot is consistent', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              snapshot_data: {
                campaign_governance_events: [{ id: 'e1' }],
                governance_audit_runs: [{ id: 'a1' }],
                summary: { eventCount: 1, auditCount: 1, policyHash },
              },
              policy_hash: policyHash,
            },
            error: null,
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await verifySnapshotIntegrity('snap-1');
      expect(result.valid).toBe(true);
      expect(result.mismatchFields).toBeUndefined();
    });

    it('detects tampered data when eventCount mismatches', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              snapshot_data: {
                campaign_governance_events: [{ id: 'e1' }, { id: 'e2' }],
                governance_audit_runs: [],
                summary: { eventCount: 1, auditCount: 0, policyHash },
              },
              policy_hash: policyHash,
            },
            error: null,
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const result = await verifySnapshotIntegrity('snap-1');
      expect(result.valid).toBe(false);
      expect(result.mismatchFields).toContain('eventCount');
    });

    it('never throws', async () => {
      (supabase.from as jest.Mock).mockImplementation(() => {
        throw new Error('DB error');
      });
      const result = await verifySnapshotIntegrity('snap-1');
      expect(result.valid).toBe(false);
    });
  });

  describe('Snapshot API', () => {
    it('POST snapshot returns snapshotId', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_lockdown') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') return chain({ data: [], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'snap-api-1' }, error: null }),
            }),
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'POST', body: { companyId, snapshotType: 'FULL' }, rbac: { userId: 'admin' } };
      const res = mockRes() as any;

      await snapshotHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.snapshotId).toBeDefined();
    });
  });

  describe('Restore API', () => {
    it('returns 409 when policy mismatch', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-1',
              company_id: companyId,
              policy_hash: 'wrong-hash',
              snapshot_data: {},
            },
            error: null,
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'POST', body: { snapshotId: 'snap-1' } };
      const res = mockRes() as any;

      await restoreSnapshotHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body?.code).toBe('SnapshotPolicyMismatch');
    });

    it('returns 404 when snapshot not found', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'POST', body: { snapshotId: 'nonexistent' } };
      const res = mockRes() as any;

      await restoreSnapshotHandler(req, res);

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Verify API', () => {
    it('returns integrity result', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              snapshot_data: { campaign_governance_events: [], governance_audit_runs: [], summary: { eventCount: 0, auditCount: 0, policyHash } },
              policy_hash: policyHash,
            },
            error: null,
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'GET', query: { snapshotId: 'snap-1' } };
      const res = mockRes() as any;

      await verifySnapshotHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.valid).toBe(true);
    });
  });

  describe('Snapshot does not affect scheduler or execution state', () => {
    it('createGovernanceSnapshot does not mutate campaigns', async () => {
      const updateCalls: string[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          const c = chain({ data: null, error: null });
          c.update = jest.fn().mockImplementation(() => {
            updateCalls.push('campaigns');
            return { then: (fn: any) => Promise.resolve({}).then(fn) };
          });
          return c;
        }
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        if (table === 'governance_lockdown') return chain({ data: [], error: null });
        if (table === 'governance_audit_runs') return chain({ data: [], error: null });
        if (table === 'campaign_governance_events') return chain({ data: [], error: null });
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.insert = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'snap-1' }, error: null }),
            }),
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await createGovernanceSnapshot({ companyId, snapshotType: 'FULL' });
      expect(updateCalls).not.toContain('campaigns');
    });
  });
});
