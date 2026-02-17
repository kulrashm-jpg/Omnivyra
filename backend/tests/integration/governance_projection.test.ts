/**
 * Integration tests for Governance Read Model (Stage 32).
 * Projection update on event write, counters, rebuild, analytics, snapshot restore.
 */

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../governance/GovernancePolicyRegistry', () => ({
  assertPolicySignatureUnchanged: jest.fn(),
  getCurrentPolicyVersion: jest.fn().mockReturnValue('1.0.0'),
}));
jest.mock('../../services/GovernanceReplayService', () => ({
  replayGovernanceEvent: jest.fn().mockResolvedValue({ statusMatch: true }),
}));

import { supabase } from '../../db/supabaseClient';
import {
  updateGovernanceProjectionFromEvent,
  rebuildGovernanceProjection,
  getProjectionStatus,
  GovernanceEventRow,
} from '../../services/GovernanceProjectionService';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { getCampaignGovernanceAnalytics } from '../../services/GovernanceAnalyticsService';
import { restoreGovernanceSnapshot } from '../../services/GovernanceSnapshotService';
import { getGovernancePolicyHash } from '../../governance/GovernancePolicy';

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

const companyId = 'company-proj-1';
const campaignId = 'campaign-proj-1';
const policyHash = getGovernancePolicyHash();

describe('Governance Projection', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('updateGovernanceProjectionFromEvent', () => {
    it('upserts projection and increments counters', async () => {
      const upsertPayloads: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'governance_projections') {
          c.maybeSingle = jest.fn()
            .mockResolvedValueOnce({ data: null, error: null })
            .mockResolvedValue({ data: null, error: null });
          c.upsert = jest.fn().mockImplementation((payload: any) => {
            upsertPayloads.push(payload);
            return Promise.resolve({ data: null, error: null });
          });
        }
        if (table === 'campaigns') {
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { execution_status: 'DRAFT' }, error: null });
        }
        return c;
      });

      await updateGovernanceProjectionFromEvent({
        campaign_id: campaignId,
        company_id: companyId,
        event_type: 'DURATION_NEGOTIATE',
        event_status: 'NEGOTIATED',
        policy_version: '1.0.0',
        policy_hash: policyHash,
        created_at: '2025-01-01T00:00:00Z',
      } as GovernanceEventRow);

      expect(upsertPayloads.length).toBeGreaterThanOrEqual(1);
      const p = upsertPayloads[upsertPayloads.length - 1];
      expect(p.total_events).toBe(1);
      expect(p.negotiation_count).toBe(1);
      expect(p.policy_version).toBe('1.0.0');
      expect(p.policy_hash).toBe(policyHash);
    });

    it('increments counters correctly for multiple event types', async () => {
      let existing: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'governance_projections') {
          c.maybeSingle = jest.fn().mockImplementation(() =>
            Promise.resolve({ data: existing, error: null })
          );
          c.upsert = jest.fn().mockImplementation((payload: any) => {
            existing = { ...payload };
            return Promise.resolve({ data: null, error: null });
          });
        }
        if (table === 'campaigns') {
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { execution_status: 'ACTIVE' }, error: null });
        }
        return c;
      });

      await updateGovernanceProjectionFromEvent({
        campaign_id: campaignId,
        company_id: companyId,
        event_type: 'DURATION_NEGOTIATE',
        event_status: 'NEGOTIATED',
        created_at: '2025-01-01T00:00:00Z',
      } as GovernanceEventRow);
      expect(existing.negotiation_count).toBe(1);

      await updateGovernanceProjectionFromEvent({
        campaign_id: campaignId,
        company_id: companyId,
        event_type: 'PREEMPTION_EXECUTED',
        event_status: 'EXECUTED',
        created_at: '2025-01-01T00:01:00Z',
      } as GovernanceEventRow);
      expect(existing.preemption_count).toBe(1);
      expect(existing.total_events).toBe(2);
    });

    it('updates execution_status on EXECUTION_STATE_TRANSITION', async () => {
      let upsertPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const c = chain({ data: null, error: null });
        if (table === 'governance_projections') {
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { execution_status: 'DRAFT' }, error: null });
          c.upsert = jest.fn().mockImplementation((p: any) => {
            upsertPayload = p;
            return Promise.resolve({ data: null, error: null });
          });
        }
        if (table === 'campaigns') {
          c.maybeSingle = jest.fn().mockResolvedValue({ data: { execution_status: 'DRAFT' }, error: null });
        }
        return c;
      });

      await updateGovernanceProjectionFromEvent({
        campaign_id: campaignId,
        company_id: companyId,
        event_type: 'EXECUTION_STATE_TRANSITION',
        event_status: 'TRANSITIONED',
        metadata: { to: 'ACTIVE' },
        created_at: '2025-01-01T00:00:00Z',
      } as GovernanceEventRow);

      expect(upsertPayload.execution_status).toBe('ACTIVE');
    });
  });

  describe('recordGovernanceEvent updates projection', () => {
    it('event insert triggers projection update', async () => {
      const eventInserts: any[] = [];
      const projUpserts: any[] = [];
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
          c.upsert = jest.fn().mockImplementation((p: any) => {
            projUpserts.push(p);
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

      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: {},
        evaluationContext: { requested_weeks: 12 },
      });

      await new Promise((r) => setImmediate(r));

      expect(eventInserts.length).toBe(1);
      expect(projUpserts.length).toBeGreaterThanOrEqual(1);
    });

    it('projection failure does not block event insertion', async () => {
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
          c.maybeSingle = jest.fn().mockRejectedValue(new Error('proj fetch fail'));
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
    });
  });

  describe('rebuildGovernanceProjection', () => {
    it('recomputes projection from events', async () => {
      let finalPayload: any = null;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        }
        if (table === 'campaign_versions') {
          return chain({ data: { company_id: companyId }, error: null });
        }
        if (table === 'governance_projections') {
          const c = chain({ data: null, error: null });
          c.upsert = jest.fn().mockImplementation((p: any) => {
            finalPayload = p;
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        if (table === 'campaign_governance_events') {
          const c = chain({ data: null, error: null });
          c.order = jest.fn().mockReturnThis();
          c.then = (resolve: any) =>
            Promise.resolve({
              data: [
                { event_type: 'DURATION_NEGOTIATE', metadata: {}, created_at: '2025-01-01T00:00:00Z', policy_version: '1.0.0', policy_hash: 'abc' },
                { event_type: 'PREEMPTION_EXECUTED', metadata: {}, created_at: '2025-01-01T00:01:00Z', policy_version: '1.0.0', policy_hash: 'abc' },
              ],
              error: null,
            }).then(resolve);
          return c;
        }
        return chain({ data: null, error: null });
      });

      await rebuildGovernanceProjection(campaignId);

      expect(finalPayload).not.toBeNull();
      expect(finalPayload.total_events).toBe(2);
      expect(finalPayload.negotiation_count).toBe(1);
      expect(finalPayload.preemption_count).toBe(1);
      expect(finalPayload.rebuilding_since).toBeNull();
    });
  });

  describe('getProjectionStatus', () => {
    it('returns ACTIVE when projection exists without rebuilding_since', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_projections') {
          return chain({ data: { rebuilding_since: null }, error: null });
        }
        return chain({ data: null, error: null });
      });
      const status = await getProjectionStatus(campaignId);
      expect(status).toBe('ACTIVE');
    });

    it('returns REBUILDING when rebuilding_since is set', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_projections') {
          return chain({ data: { rebuilding_since: '2025-01-01T00:00:00Z' }, error: null });
        }
        return chain({ data: null, error: null });
      });
      const status = await getProjectionStatus(campaignId);
      expect(status).toBe('REBUILDING');
    });

    it('returns MISSING when no projection', async () => {
      (supabase.from as jest.Mock).mockImplementation(() =>
        chain({ data: null, error: null })
      );
      const status = await getProjectionStatus(campaignId);
      expect(status).toBe('MISSING');
    });
  });

  describe('Analytics reads projection', () => {
    it('getCampaignGovernanceAnalytics uses projection data when present', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        }
        if (table === 'governance_projections') {
          const projData = {
            execution_status: 'ACTIVE',
            total_events: 5,
            negotiation_count: 2,
            rejection_count: 0,
            preemption_count: 1,
            freeze_blocks: 0,
            scheduler_runs: 1,
            policy_version: '1.0.0',
            policy_hash: policyHash,
            replay_coverage_ratio: 0.8,
            drift_detected: false,
            rebuilding_since: null,
          };
          const c = chain({ data: projData, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: projData, error: null });
          return c;
        }
        if (table === 'campaign_governance_events') {
          return chain({ data: [], error: null });
        }
        if (table === 'scheduled_posts') {
          return chain({ data: [], error: null });
        }
        return chain({ data: null, error: null });
      });

      const analytics = await getCampaignGovernanceAnalytics(campaignId);

      expect(analytics).not.toBeNull();
      expect(analytics!.totalEvents).toBe(5);
      expect(analytics!.negotiationCount).toBe(2);
      expect(analytics!.preemptionCount).toBe(1);
      expect(analytics!.policyVersion).toBe('1.0.0');
      expect(analytics!.projectionStatus).toBeDefined();
    });
  });

  describe('Snapshot restore triggers projection rebuild', () => {
    it('restore calls rebuildGovernanceProjection for each campaign', async () => {
      const projUpsertsWithRebuilding: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-proj-1',
              company_id: companyId,
              policy_hash: policyHash,
              snapshot_data: {
                governance_lockdown: [],
                governance_audit_runs: [],
                campaign_governance_events: [
                  { company_id: companyId, campaign_id: campaignId, event_type: 'E1', event_status: 'OK', metadata: {}, policy_version: '1.0.0', policy_hash: policyHash, created_at: '2025-01-01T00:00:00Z' },
                  { company_id: companyId, campaign_id: campaignId, event_type: 'E2', event_status: 'OK', metadata: {}, policy_version: '1.0.0', policy_hash: policyHash, created_at: '2025-01-01T00:01:00Z' },
                ],
                summary: { eventCount: 2, auditCount: 0, policyHash },
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
        if (table === 'governance_projections') {
          const c = chain({ data: null, error: null });
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.upsert = jest.fn().mockImplementation((p: any) => {
            if (p.rebuilding_since != null) projUpsertsWithRebuilding.push(p);
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        if (table === 'campaigns') {
          return chain({ data: { id: campaignId, execution_status: 'ACTIVE' }, error: null });
        }
        if (table === 'campaign_versions') {
          return chain({ data: { company_id: companyId }, error: null });
        }
        return chain({ data: null, error: null });
      });

      await restoreGovernanceSnapshot('snap-proj-1');

      expect(projUpsertsWithRebuilding.length).toBeGreaterThanOrEqual(1);
      expect(projUpsertsWithRebuilding.some((p: any) => p.campaign_id === campaignId)).toBe(true);
    });
  });
});
