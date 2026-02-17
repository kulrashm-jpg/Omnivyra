/**
 * Stage 17 — Campaign Execution State Machine Enforcement Integration Tests.
 * Tests: allowed transitions, rejected transitions, EXECUTION_STATE_TRANSITION event.
 */

import {
  assertValidExecutionTransition,
  InvalidExecutionTransitionError,
  ALLOWED_EXECUTION_TRANSITIONS,
} from '../../governance/ExecutionStateMachine';

jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn().mockResolvedValue({ userId: 'user-1' }),
}));

import { supabase } from '../../db/supabaseClient';
import { recordGovernanceEvent } from '../../services/GovernanceEventService';
import { executeCampaignPreemption } from '../../services/CampaignPreemptionService';
import { createApiRequestMock } from '../utils/createApiRequestMock';
import { createMockRes } from '../utils/setupApiTest';
import executePreemptionHandler from '../../../pages/api/campaigns/execute-preemption';

function chain(result: { data: any; error: any }) {
  const updateChain = { eq: jest.fn().mockResolvedValue({ data: null, error: null }) };
  const q = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue(result) }) }),
    maybeSingle: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnValue(updateChain),
  };
  (q as any).then = (resolve: any) => Promise.resolve(result).then(resolve);
  return q;
}

function chainArray(result: { data: any; error: any }) {
  const q = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue(result) }),
    }),
    maybeSingle: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
    update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: null }) }),
  };
  (q as any).then = (resolve: any) => Promise.resolve(result).then(resolve);
  return q;
}

describe('Campaign Execution State Machine', () => {
  describe('assertValidExecutionTransition — allowed transitions', () => {
    it('DRAFT → PRE_PLANNING allowed', () => {
      expect(() => assertValidExecutionTransition('DRAFT', 'PRE_PLANNING')).not.toThrow();
    });

    it('PRE_PLANNING → INVALIDATED allowed', () => {
      expect(() => assertValidExecutionTransition('PRE_PLANNING', 'INVALIDATED')).not.toThrow();
    });

    it('INVALIDATED → ACTIVE allowed', () => {
      expect(() => assertValidExecutionTransition('INVALIDATED', 'ACTIVE')).not.toThrow();
    });

    it('ACTIVE → PAUSED allowed', () => {
      expect(() => assertValidExecutionTransition('ACTIVE', 'PAUSED')).not.toThrow();
    });

    it('ACTIVE → COMPLETED allowed', () => {
      expect(() => assertValidExecutionTransition('ACTIVE', 'COMPLETED')).not.toThrow();
    });

    it('ACTIVE → PREEMPTED allowed', () => {
      expect(() => assertValidExecutionTransition('ACTIVE', 'PREEMPTED')).not.toThrow();
    });

    it('PAUSED → ACTIVE allowed', () => {
      expect(() => assertValidExecutionTransition('PAUSED', 'ACTIVE')).not.toThrow();
    });

    it('PAUSED → PREEMPTED allowed', () => {
      expect(() => assertValidExecutionTransition('PAUSED', 'PREEMPTED')).not.toThrow();
    });
  });

  describe('assertValidExecutionTransition — rejected transitions', () => {
    it('ACTIVE → DRAFT rejected', () => {
      expect(() => assertValidExecutionTransition('ACTIVE', 'DRAFT')).toThrow(
        InvalidExecutionTransitionError
      );
    });

    it('COMPLETED → ACTIVE rejected', () => {
      expect(() => assertValidExecutionTransition('COMPLETED', 'ACTIVE')).toThrow(
        InvalidExecutionTransitionError
      );
    });

    it('PREEMPTED → ACTIVE rejected', () => {
      expect(() => assertValidExecutionTransition('PREEMPTED', 'ACTIVE')).toThrow(
        InvalidExecutionTransitionError
      );
    });

    it('DRAFT → ACTIVE rejected', () => {
      expect(() => assertValidExecutionTransition('DRAFT', 'ACTIVE')).toThrow(
        InvalidExecutionTransitionError
      );
    });

    it('PREEMPTED → PAUSED rejected', () => {
      expect(() => assertValidExecutionTransition('PREEMPTED', 'PAUSED')).toThrow(
        InvalidExecutionTransitionError
      );
    });
  });

  describe('InvalidExecutionTransitionError', () => {
    it('has code INVALID_EXECUTION_TRANSITION', () => {
      try {
        assertValidExecutionTransition('COMPLETED', 'ACTIVE');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidExecutionTransitionError);
        expect((err as InvalidExecutionTransitionError).code).toBe('INVALID_EXECUTION_TRANSITION');
        expect((err as InvalidExecutionTransitionError).from).toBe('COMPLETED');
        expect((err as InvalidExecutionTransitionError).to).toBe('ACTIVE');
      }
    });
  });

  describe('ALLOWED_EXECUTION_TRANSITIONS', () => {
    it('COMPLETED has empty allowed list', () => {
      expect(ALLOWED_EXECUTION_TRANSITIONS['COMPLETED']).toEqual([]);
    });

    it('PREEMPTED has empty allowed list', () => {
      expect(ALLOWED_EXECUTION_TRANSITIONS['PREEMPTED']).toEqual([]);
    });

    it('ACTIVE allows PAUSED, COMPLETED, PREEMPTED', () => {
      const allowed = ALLOWED_EXECUTION_TRANSITIONS['ACTIVE'];
      expect(allowed).toContain('PAUSED');
      expect(allowed).toContain('COMPLETED');
      expect(allowed).toContain('PREEMPTED');
      expect(allowed).toHaveLength(3);
    });
  });

  describe('Preemption flow — EXECUTION_STATE_TRANSITION event', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
    });

    it('EXECUTION_STATE_TRANSITION emitted when ACTIVE → PREEMPTED', async () => {
      const initiatorId = 'init-uuid';
      const preemptedId = 'preempt-uuid';
      const campaignsData = [
        { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
        { id: preemptedId, priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
      ];
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          return chainArray({ data: campaignsData, error: null });
        }
        if (table === 'campaign_preemption_log') {
          const logChain = chainArray({
            data: { id: 'log-1', justification: 'Justification here.' },
            error: null,
          });
          (logChain as any).insert = jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { id: 'log-1', justification: 'x' }, error: null }),
            }),
          });
          return logChain;
        }
        return chain({ data: null, error: null });
      });

      await executeCampaignPreemption({
        initiatorCampaignId: initiatorId,
        preemptedCampaignId: preemptedId,
        justification: 'Revenue-critical board commitment for Q4 launch.',
        companyId: 'company-123',
      });

      const transitionCalls = (recordGovernanceEvent as jest.Mock).mock.calls.filter(
        (c: any[]) => c[0]?.eventType === 'EXECUTION_STATE_TRANSITION'
      );
      expect(transitionCalls.length).toBeGreaterThan(0);
      expect(transitionCalls[0][0].metadata).toMatchObject({
        campaignId: preemptedId,
        from: 'ACTIVE',
        to: 'PREEMPTED',
      });
    });
  });

  describe('execute-preemption API — invalid transition returns 409', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (recordGovernanceEvent as jest.Mock).mockResolvedValue(undefined);
    });

    it('COMPLETED campaign → preemption returns 409 INVALID_EXECUTION_TRANSITION', async () => {
      const initiatorId = 'init-uuid';
      const preemptedId = 'preempt-uuid';
      const initiatorCampaign = { id: initiatorId, execution_status: 'ACTIVE' };
      const campaignsData = [
        { id: initiatorId, priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
        { id: preemptedId, priority_level: 'LOW', execution_status: 'COMPLETED', blueprint_status: 'ACTIVE', is_protected: false, last_preempted_at: null },
      ];
      let campaignsCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'campaigns') {
          campaignsCallCount++;
          if (campaignsCallCount === 1) {
            return chain({ data: initiatorCampaign, error: null });
          }
          if (campaignsCallCount <= 3) {
            return chainArray({ data: campaignsData, error: null });
          }
          return chain({ data: null, error: null });
        }
        return chain({ data: null, error: null });
      });

      const req = createApiRequestMock({
        method: 'POST',
        body: {
          initiatorCampaignId: initiatorId,
          preemptedCampaignId: preemptedId,
          companyId: 'company-123',
          justification: 'Revenue-critical board commitment for Q4 launch.',
        },
      });
      const res = createMockRes();

      await executePreemptionHandler(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body).toMatchObject({
        code: 'INVALID_EXECUTION_TRANSITION',
        message: 'Illegal execution state transition',
      });
    });
  });
});
