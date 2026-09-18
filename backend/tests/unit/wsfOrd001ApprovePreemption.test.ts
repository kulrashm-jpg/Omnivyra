/**
 * WSF-ORD-001 — pages/api/campaigns/approve-preemption.ts
 *
 * THE DEFECT: the route's only guard call (enforceCompanyAccess) sat BELOW the
 * finalization check. So an ANONYMOUS caller holding a preemption request id
 * could:
 *   - probe which request ids / campaign ids exist (two distinct 404s), and
 *   - when the initiator campaign was finalized, drive recordGovernanceEvent
 *     into inserting a governance event + upserting the governance projection
 *     under a `companyId` it supplied itself.
 *
 * The fix authenticates + binds the company before ANY lookup, and binds the
 * initiator campaign before the finalization check.
 *
 * Only the database, the identity provider and the paid/heavy services are
 * faked; resolveUserContext → enforceCompanyAccess → TenantGuard →
 * campaignOwnershipService all run for real.
 */
import { seed, invoke, writeCalls, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B, UNKNOWN_ID } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

const mockRecordGovernanceEvent = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/GovernanceEventService', () => ({
  recordGovernanceEvent: (...a: unknown[]) => mockRecordGovernanceEvent(...a),
}));

const mockExecutePreemption = jest.fn(async (..._a: unknown[]) => ({
  preemptedCampaignId: 'camp-preempted',
  preemptedExecutionStatus: 'PREEMPTED',
  preemptedBlueprintStatus: 'ARCHIVED',
  logId: 'log-1',
  justification: 'x',
}));
jest.mock('../../services/CampaignPreemptionService', () => ({
  executePreemptionFromRequest: (...a: unknown[]) => mockExecutePreemption(...a),
  PreemptionValidationError: class PreemptionValidationError extends Error {},
}));

const mockRunPrePlanning = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: (...a: unknown[]) => mockRunPrePlanning(...a),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const approvePreemption = require('../../../pages/api/campaigns/approve-preemption').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const REQ_A = 'preq-a-0000-0000-0000-00000000000a';
const REQ_B = 'preq-b-0000-0000-0000-00000000000b';
const JUSTIFICATION = 'A sufficiently long justification for the preemption.';

function world(finalized: boolean) {
  seed({
    campaign_preemption_requests: [
      { id: REQ_A, initiator_campaign_id: CAMPAIGN_A, status: 'PENDING' },
      { id: REQ_B, initiator_campaign_id: CAMPAIGN_B, status: 'PENDING' },
    ],
  });
  if (finalized) {
    // Drive the CampaignFinalizedError branch — the one that WRITES.
    for (const row of require('../helpers/routeAuthHarness').rows('campaigns')) {
      row.execution_status = 'COMPLETED';
    }
  }
}

beforeEach(() => {
  mockRecordGovernanceEvent.mockClear();
  mockExecutePreemption.mockClear();
  mockRunPrePlanning.mockClear();
});

const body = (requestId: string, companyId: string) => ({ requestId, companyId, justification: JUSTIFICATION });

describe('WSF-ORD-001 — campaigns/approve-preemption ordering', () => {
  describe('anonymous caller', () => {
    it('THE EXPLOIT: anonymous + finalized initiator wrote a governance event — now 401, no governance write', async () => {
      world(true);
      const r = await invoke(approvePreemption, { method: 'POST', as: null, body: body(REQ_A, CO_A) });
      expect(r.status).toBe(401);
      expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
      expect(writeCalls()).toHaveLength(0);
      expect(mockExecutePreemption).not.toHaveBeenCalled();
    });

    it('cannot use the 404s as an existence oracle: a real and an unknown request id answer identically', async () => {
      world(false);
      const real = await invoke(approvePreemption, { method: 'POST', as: null, body: body(REQ_A, CO_A) });
      const fake = await invoke(approvePreemption, { method: 'POST', as: null, body: body(UNKNOWN_ID, CO_A) });
      expect(real.status).toBe(401);
      expect(fake.status).toBe(401);
      expect(real.body).toEqual(fake.body);
    });
  });

  describe('authenticated, wrong tenant', () => {
    it('member of A naming company B → 403, no governance write, no preemption', async () => {
      world(true);
      const r = await invoke(approvePreemption, { method: 'POST', as: 'A', body: body(REQ_B, CO_B) });
      expect(r.status).toBe(403);
      expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
      expect(mockExecutePreemption).not.toHaveBeenCalled();
    });

    it("member of A pairing its OWN company with B's preemption request → 404 (campaign binding), no governance write", async () => {
      world(true);
      const r = await invoke(approvePreemption, { method: 'POST', as: 'A', body: body(REQ_B, CO_A) });
      expect(r.status).toBe(404);
      expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
      expect(mockExecutePreemption).not.toHaveBeenCalled();
    });
  });

  describe('authorized caller — behaviour preserved', () => {
    it('finalized initiator still records the BLOCKED governance event and answers 409', async () => {
      world(true);
      const r = await invoke(approvePreemption, { method: 'POST', as: 'A', body: body(REQ_A, CO_A) });
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ code: 'CAMPAIGN_FINALIZED' });
      expect(mockRecordGovernanceEvent).toHaveBeenCalledTimes(1);
      expect(mockRecordGovernanceEvent).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: CO_A, campaignId: CAMPAIGN_A, eventStatus: 'BLOCKED' }),
      );
      expect(mockExecutePreemption).not.toHaveBeenCalled();
    });

    it('non-finalized initiator still executes the preemption and answers 200', async () => {
      world(false);
      const r = await invoke(approvePreemption, { method: 'POST', as: 'A', body: body(REQ_A, CO_A) });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'EXECUTED' });
      expect(mockExecutePreemption).toHaveBeenCalledWith(REQ_A, JUSTIFICATION.trim(), CO_A);
    });

    it('an unknown request id for an authorized company still answers 404', async () => {
      world(false);
      const r = await invoke(approvePreemption, { method: 'POST', as: 'A', body: body(UNKNOWN_ID, CO_A) });
      expect(r.status).toBe(404);
      expect(mockExecutePreemption).not.toHaveBeenCalled();
    });
  });
});
