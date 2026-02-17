/**
 * Integration tests for Governance Ledger (Stage 31).
 * Tamper-evident hash chain, verification, snapshot restore.
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
import { computeGovernanceEventHash } from '../../governance/GovernanceLedger';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import {
  verifyCampaignLedger,
  verifyCompanyLedger,
} from '../../services/GovernanceLedgerVerificationService';
import { restoreGovernanceSnapshot } from '../../services/GovernanceSnapshotService';
import verifyLedgerHandler from '../../../pages/api/governance/verify-ledger';

type ChainResult = { data: any; error: any };

function chain(result: ChainResult) {
  const mock: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return mock;
}

const companyId = 'company-uuid-456';
const campaignId = 'campaign-uuid-123';
const policyHash = getGovernancePolicyHash();

describe('Governance Ledger', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('computeGovernanceEventHash', () => {
    it('produces deterministic hex string', () => {
      const h1 = computeGovernanceEventHash({
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: { requested_weeks: 12 },
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: null,
      });
      const h2 = computeGovernanceEventHash({
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: { requested_weeks: 12 },
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: null,
      });
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('changes when previousEventHash differs', () => {
      const h1 = computeGovernanceEventHash({
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: {},
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: null,
      });
      const h2 = computeGovernanceEventHash({
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: {},
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: h1,
      });
      expect(h1).not.toBe(h2);
    });
  });

  describe('recordGovernanceEvent stores event_hash', () => {
    it('stores event_hash and previous_event_hash', async () => {
      const inserts: any[] = [];
      let callCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          callCount++;
          const c = chain({ data: null, error: null });
          c.select = jest.fn().mockReturnThis();
          c.eq = jest.fn().mockReturnThis();
          c.order = jest.fn().mockReturnThis();
          c.limit = jest.fn().mockReturnThis();
          c.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
          c.insert = jest.fn().mockImplementation((payload: any) => {
            inserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await recordGovernanceEvent({
        companyId,
        campaignId,
        eventType: 'DURATION_APPROVED',
        eventStatus: 'APPROVED',
        metadata: { requested_weeks: 12 },
        evaluationContext: { requested_weeks: 12 },
      });

      expect(inserts.length).toBeGreaterThan(0);
      expect(inserts[0].event_hash).toBeDefined();
      expect(inserts[0].event_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(inserts[0].previous_event_hash).toBeNull();
    });
  });

  describe('verifyCampaignLedger', () => {
    it('returns valid when chain links correctly', async () => {
      const h0 = computeGovernanceEventHash({
        campaignId,
        eventType: 'E1',
        eventStatus: 'OK',
        metadata: {},
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: null,
      });
      const h1 = computeGovernanceEventHash({
        campaignId,
        eventType: 'E2',
        eventStatus: 'OK',
        metadata: {},
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: h0,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          return chain({
            data: [
              { id: 'ev1', campaign_id: campaignId, event_type: 'E1', event_status: 'OK', metadata: {}, policy_version: '1.0.0', policy_hash: policyHash, event_hash: h0, previous_event_hash: null },
              { id: 'ev2', campaign_id: campaignId, event_type: 'E2', event_status: 'OK', metadata: {}, policy_version: '1.0.0', policy_hash: policyHash, event_hash: h1, previous_event_hash: h0 },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await verifyCampaignLedger(campaignId);
      expect(result.valid).toBe(true);
    });

    it('detects tampered metadata', async () => {
      const h0 = computeGovernanceEventHash({
        campaignId,
        eventType: 'E1',
        eventStatus: 'OK',
        metadata: { original: true },
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: null,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          return chain({
            data: [
              { id: 'ev1', campaign_id: campaignId, event_type: 'E1', event_status: 'OK', metadata: { tampered: true }, policy_version: '1.0.0', policy_hash: policyHash, event_hash: h0, previous_event_hash: null },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await verifyCampaignLedger(campaignId);
      expect(result.valid).toBe(false);
      expect(result.corruptedEventIds).toContain('ev1');
    });

    it('detects broken chain when previous_event_hash mismatch', async () => {
      const h0 = computeGovernanceEventHash({
        campaignId,
        eventType: 'E1',
        eventStatus: 'OK',
        metadata: {},
        policyVersion: '1.0.0',
        policyHash,
        previousEventHash: null,
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          return chain({
            data: [
              { id: 'ev1', campaign_id: campaignId, event_type: 'E1', event_status: 'OK', metadata: {}, policy_version: '1.0.0', policy_hash: policyHash, event_hash: h0, previous_event_hash: null },
              { id: 'ev2', campaign_id: campaignId, event_type: 'E2', event_status: 'OK', metadata: {}, policy_version: '1.0.0', policy_hash: policyHash, event_hash: 'wrong', previous_event_hash: 'deleted-event-hash' },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await verifyCampaignLedger(campaignId);
      expect(result.valid).toBe(false);
    });
  });

  describe('verifyCompanyLedger', () => {
    it('aggregates campaign checks and detects corrupted campaign', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [{ campaign_id: campaignId }], error: null });
        if (table === 'campaign_governance_events') {
          return chain({
            data: [
              { id: 'ev1', campaign_id: campaignId, event_type: 'E1', event_status: 'OK', metadata: { x: 1 }, policy_version: '1.0.0', policy_hash: policyHash, event_hash: 'wrong-hash', previous_event_hash: null },
            ],
            error: null,
          });
        }
        return chain({ data: null, error: null });
      });

      const result = await verifyCompanyLedger(companyId);
      expect(result.valid).toBe(false);
      expect(result.corruptedCampaigns).toContain(campaignId);
    });
  });

  describe('Ledger verification does not emit events', () => {
    it('verifyCampaignLedger does not insert into campaign_governance_events', async () => {
      const insertCalls: string[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_governance_events') {
          const c = chain({ data: [], error: null });
          (c as any).insert = jest.fn().mockImplementation(() => {
            insertCalls.push('campaign_governance_events');
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await verifyCampaignLedger(campaignId);
      expect(insertCalls).not.toContain('campaign_governance_events');
    });
  });

  describe('Snapshot restore preserves ledger chain', () => {
    it('restored events have valid event_hash and previous_event_hash', async () => {
      const eventInserts: any[] = [];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'governance_snapshots') {
          const c = chain({ data: null, error: null });
          c.eq = jest.fn().mockReturnThis();
          c.single = jest.fn().mockResolvedValue({
            data: {
              id: 'snap-1',
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
          c.insert = jest.fn().mockImplementation((rows: any[]) => {
            eventInserts.push(...(Array.isArray(rows) ? rows : [rows]));
            return Promise.resolve({ data: null, error: null });
          });
          return c;
        }
        return chain({ data: null, error: null });
      });

      await restoreGovernanceSnapshot('snap-1');

      // Restore inserts 2 snapshot events then recordGovernanceEvent adds GOVERNANCE_SNAPSHOT_RESTORED
      const restored = eventInserts.filter((e: any) => e.event_type === 'E1' || e.event_type === 'E2');
      expect(restored.length).toBe(2);
      expect(restored[0].event_hash).toBeDefined();
      expect(restored[0].previous_event_hash).toBeNull();
      expect(restored[1].event_hash).toBeDefined();
      expect(restored[1].previous_event_hash).toBe(restored[0].event_hash);
    });
  });

  describe('verify-ledger API', () => {
    it('returns valid and corruptedCampaigns', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaign_versions') return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      });

      const req: any = { method: 'GET', query: { companyId } };
      const res: any = {
        statusCode: 200,
        setHeader: jest.fn(),
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(obj: any) {
          this.body = obj;
        },
      };

      await verifyLedgerHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ valid: true, corruptedCampaigns: [] });
    });
  });
});
