/**
 * Integration tests for Governance Performance Guardrails (Stage 33).
 * Rate limiting, concurrency locks, backpressure. No business logic changes.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../governance/GovernancePolicyRegistry', () => ({
  assertPolicySignatureUnchanged: jest.fn(),
}));
jest.mock('../../services/GovernanceReplayService', () => ({
  replayGovernanceEvent: jest.fn().mockResolvedValue({ statusMatch: true }),
}));
jest.mock('../../services/GovernanceAuditService', () => ({
  runGovernanceAudit: jest.fn().mockImplementation(() =>
    new Promise((r) => setTimeout(() => r({ auditStatus: 'OK' }), 20))
  ),
}));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: any) => h }));

import { supabase } from '../../db/supabaseClient';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import {
  tryConsumeProjectionToken,
  tryConsumeReplayToken,
  tryAcquireRestoreLock,
  releaseRestoreLock,
  tryAcquireRebuildLock,
  releaseRebuildLock,
  projectionDropsPerCompany,
  replayLimitedPerCompany,
  snapshotRestoreBlockedCount,
  projectionRebuildBlockedCount,
} from '../../services/GovernanceRateLimiter';
import { restoreGovernanceSnapshot, SnapshotRestoreInProgressError } from '../../services/GovernanceSnapshotService';
import { runAllCompanyAudits } from '../../jobs/governanceAuditJob';
import { rebuildGovernanceProjection } from '../../services/GovernanceProjectionService';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';
import replayEventHandler from '../../../pages/api/governance/replay-event';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const companyId = 'company-guard-1';
const campaignId = 'campaign-guard-1';
const policyHash = getGovernancePolicyHash();

describe('Governance Performance Guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    projectionDropsPerCompany.clear();
    replayLimitedPerCompany.clear();
    snapshotRestoreBlockedCount.clear();
    projectionRebuildBlockedCount.clear();
  });

  describe('Projection rate limiting', () => {
    it('projection rate limiting does not block event write', async () => {
      const eventInserts: any[] = [];
      let projUpdateCalls = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((p: any) => {
            eventInserts.push(p);
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        if (table === 'governance_projections') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.upsert = jest.fn().mockImplementation(() => {
            projUpdateCalls++;
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        if (table === 'campaigns') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { execution_status: 'DRAFT' }, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      for (let i = 0; i < 5; i++) {
        await recordGovernanceEvent({
          companyId,
          campaignId,
          eventType: 'DURATION_APPROVED',
          eventStatus: 'APPROVED',
          metadata: {},
          evaluationContext: { requested_weeks: 12 },
        });
      }

      await new Promise((r) => setImmediate(r));

      expect(eventInserts.length).toBe(5);
    });

    it('tryConsumeProjectionToken returns false when limit exceeded', () => {
      const tokenCompanyId = 'company-token-test-fresh';
      for (let i = 0; i < 100; i++) {
        expect(tryConsumeProjectionToken(tokenCompanyId)).toBe(true);
      }
      expect(tryConsumeProjectionToken(tokenCompanyId)).toBe(false);
    });
  });

  describe('Replay rate limiter', () => {
    it('tryConsumeReplayToken returns false when 20 per minute exceeded', () => {
      const replayCompanyId = 'company-replay-test-fresh';
      for (let i = 0; i < 20; i++) {
        expect(tryConsumeReplayToken(replayCompanyId)).toBe(true);
      }
      expect(tryConsumeReplayToken(replayCompanyId)).toBe(false);
    });

    it('replay-event API returns 429 when rate limit exceeded', async () => {
      const replayCompanyId = 'company-replay-api-429';
      for (let i = 0; i < 20; i++) {
        tryConsumeReplayToken(replayCompanyId);
      }

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          return chain({
            data: { id: 'evt-1', company_id: replayCompanyId },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const req: any = {
        method: 'GET',
        query: { eventId: 'evt-1', companyId: replayCompanyId },
        rbac: { userId: 'user-1' },
      };
      const res: any = {
        statusCode: 200,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(obj: any) {
          this.body = obj;
        },
      };

      await replayEventHandler(req, res);

      expect(res.statusCode).toBe(429);
      expect(res.body?.code).toBe('REPLAY_RATE_LIMITED');
    });
  });

  describe('Snapshot restore concurrency lock', () => {
    it('concurrent restore returns 409 SNAPSHOT_RESTORE_IN_PROGRESS', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-guard-1',
              company_id: companyId,
              policy_hash: policyHash,
              snapshot_data: {
                governance_lockdown: [],
                governance_audit_runs: [],
                campaign_governance_events: [],
                summary: { eventCount: 0, auditCount: 0, policyHash },
              },
            },
            error: null,
          });
          return c;
        }
        if (table === 'governance_lockdown') return chain({ data: null, error: null });
        if (table === 'governance_audit_runs') {
          const c = chain({ data: null, error: null });
          c.delete = jest.fn().mockReturnThis();
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.delete = jest.fn().mockReturnThis();
          c.in = jest.fn().mockReturnThis();
          c.insert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      const p1 = restoreGovernanceSnapshot('snap-guard-1');
      const p2 = restoreGovernanceSnapshot('snap-guard-1');

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(SnapshotRestoreInProgressError);
      expect((err as Error).code).toBe('SNAPSHOT_RESTORE_IN_PROGRESS');
    });
  });

  describe('Audit job overlap guard', () => {
    it('second call skips when first is still running', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') {
          return chain({ data: [{ company_id: companyId }], error: null });
        }
        return chain({ data: null, error: null });
      });

      const runGovernanceAudit = require('../../services/GovernanceAuditService').runGovernanceAudit;
      const firstPromise = runAllCompanyAudits();
      const secondPromise = runAllCompanyAudits();

      await Promise.all([firstPromise, secondPromise]);

      expect(runGovernanceAudit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Projection rebuild concurrency guard', () => {
    it('concurrent rebuild of same campaign returns silently for second', async () => {
      let rebuildCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        }
        if (table === 'campaign_versions') {
          return chain({ data: { company_id: companyId }, error: null });
        }
        if (table === 'governance_projections') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.upsert = jest.fn().mockImplementation(() => {
            rebuildCount++;
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        if (table === 'campaign_governance_events') {
          return chain({ data: [], error: null });
        }
        return chain({ data: null, error: null });
      });

      const [r1, r2] = await Promise.all([
        rebuildGovernanceProjection(campaignId),
        rebuildGovernanceProjection(campaignId),
      ]);

      expect(r1).toBeUndefined();
      expect(r2).toBeUndefined();
      expect(projectionRebuildBlockedCount.get(companyId) ?? 0).toBeGreaterThanOrEqual(1);
    });
  });

  describe('No business logic changes', () => {
    it('event write still succeeds with valid payload', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((p: any) => {
            eventInserts.push(p);
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        if (table === 'governance_projections') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.upsert = jest.fn().mockResolvedValue({ data: null, error: null });
          return c;
        }
        if (table === 'campaigns') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { execution_status: 'DRAFT' }, error: null });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: {},
        evaluationContext: { requested_weeks: 12 },
      });

      expect(eventInserts.length).toBe(1);
      expect(eventInserts[0].event_type).toBe('DURATION_APPROVED');
      expect(eventInserts[0].event_hash).toBeDefined();
    });
  });
});
