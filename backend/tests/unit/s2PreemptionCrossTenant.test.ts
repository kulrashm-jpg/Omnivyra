/**
 * CROSS-TENANT FIX - campaign preemption (6f, 2026-11-13; e9: BLOCKING).
 *
 * THE DEFECT: POST /api/campaigns/execute-preemption bound ONLY the initiator campaign to the caller's company;
 * preemptedCampaignId came from the body unchecked, and CampaignPreemptionService loaded both campaigns by id with
 * no company check. So any member of A could preempt company B's campaign (execution_status PREEMPTED, blueprint
 * INVALIDATED, last_preempted_at) and record governance events for it under A - or, for a protected / CRITICAL
 * target, create an approval request naming it, which approve-preemption then executed.
 *
 * THE FIX: the routes bind BOTH campaigns; the service refuses unless BOTH are canonically owned by companyId
 * (now REQUIRED), before any read, write or event - in executeCampaignPreemption (which also gates
 * createApprovalRequest) and again at approval (executePreemptionFromRequest), since a request row may predate the fix.
 *
 * Only the database, identity, governance-event sink and pre-planning are faked; enforceCompanyAccess ->
 * TenantGuard -> campaignOwnershipService run for real. The approve route's cross-company request row is pinned in
 * wsfOrd001ApprovePreemption.
 */
import { seed, invoke, rows, failTable, CO_A, CO_B, CAMPAIGN_A, CAMPAIGN_B } from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
const mockRecordGovernanceEvent = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../services/GovernanceEventService', () => ({ recordGovernanceEvent: (...a: unknown[]) => mockRecordGovernanceEvent(...a) }));
jest.mock('../../services/GovernanceLockdownService', () => ({ isGovernanceLocked: async () => false }));
jest.mock('../../services/CampaignPrePlanningService', () => ({ runPrePlanning: async () => ({ ok: true }) }));

import {
  executeCampaignPreemption, executePreemptionFromRequest, PreemptionOwnershipError,
} from '../../services/CampaignPreemptionService';
/* eslint-disable @typescript-eslint/no-var-requires */
const executeRoute = require('../../../pages/api/campaigns/execute-preemption').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const CAMPAIGN_A2 = 'camp-a2-0-0000-0000-0000000000a2';
const CAMPAIGN_B2 = 'camp-b2-0-0000-0000-0000000000b2';
const REQ_X = 'preq-x-0000-0000-0000-00000000000c';
const JUST = 'A sufficiently long justification for the preemption.';

function world() {
  seed({
    campaigns: [
      { id: CAMPAIGN_A2, company_id: CO_A, name: 'Campaign A2', status: 'planning', priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: 4 },
      { id: CAMPAIGN_B2, company_id: CO_B, name: 'Campaign B2', status: 'planning', priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' },
    ],
    campaign_versions: [
      { campaign_id: CAMPAIGN_A2, company_id: CO_A, version: 1, created_at: '2026-01-01', campaign_snapshot: {} },
      { campaign_id: CAMPAIGN_B2, company_id: CO_B, version: 1, created_at: '2026-01-01', campaign_snapshot: {} },
    ],
    // A request row from BEFORE the fix: A's initiator, B's campaign as the target.
    campaign_preemption_requests: [{ id: REQ_X, initiator_campaign_id: CAMPAIGN_A, target_campaign_id: CAMPAIGN_B, status: 'PENDING' }],
  });
  for (const c of rows('campaigns')) {
    if (c.id === CAMPAIGN_A) Object.assign(c, { priority_level: 'HIGH', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE', duration_weeks: 4 });
    if (c.id === CAMPAIGN_B) Object.assign(c, { priority_level: 'LOW', execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' });
  }
}
const campaign = (id: string) => rows('campaigns').find((c) => c.id === id);
const untouched = (id: string) => expect(campaign(id)).toMatchObject({ execution_status: 'ACTIVE', blueprint_status: 'ACTIVE' });

beforeEach(() => { world(); mockRecordGovernanceEvent.mockClear(); });

describe('service: both campaigns must be owned by companyId', () => {
  it('CONTROL: A preempts its OWN lower campaign', async () => {
    const r = await executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: CAMPAIGN_A2, justification: JUST, companyId: CO_A });
    expect(r).toMatchObject({ preemptedCampaignId: CAMPAIGN_A2, preemptedExecutionStatus: 'PREEMPTED' });
    expect(campaign(CAMPAIGN_A2)).toMatchObject({ execution_status: 'PREEMPTED', blueprint_status: 'INVALIDATED' });
  });

  it("A naming B's campaign as the target: refused (not_owned); B unchanged; no governance event", async () => {
    await expect(executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: CAMPAIGN_B, justification: JUST, companyId: CO_A }))
      .rejects.toMatchObject({ name: 'PreemptionOwnershipError', kind: 'not_owned' });
    untouched(CAMPAIGN_B);
    expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
  });

  it("A naming B's campaign as the INITIATOR (its own as target): refused; nothing written", async () => {
    await expect(executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_B, preemptedCampaignId: CAMPAIGN_A2, justification: JUST, companyId: CO_A }))
      .rejects.toBeInstanceOf(PreemptionOwnershipError);
    untouched(CAMPAIGN_A2);
    expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
  });

  it('a protected / CRITICAL target of ANOTHER company: no approval request is created', async () => {
    for (const c of rows('campaigns')) if (c.id === CAMPAIGN_B) c.priority_level = 'CRITICAL';
    const before = rows('campaign_preemption_requests').length;
    await expect(executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: CAMPAIGN_B, justification: JUST, companyId: CO_A }))
      .rejects.toBeInstanceOf(PreemptionOwnershipError);
    expect(rows('campaign_preemption_requests')).toHaveLength(before);
  });

  it("a target that exists NOWHERE is refused on ownership ('not_found' is never 'owned')", async () => {
    await expect(executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: 'camp-nowhere-0000-0000-000000000000', justification: JUST, companyId: CO_A }))
      .rejects.toMatchObject({ name: 'PreemptionOwnershipError', kind: 'not_owned' });
  });

  it('companyId is REQUIRED (missing -> refused before any read)', async () => {
    await expect(executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: CAMPAIGN_A2, justification: JUST } as never))
      .rejects.toMatchObject({ kind: 'not_owned' });
    untouched(CAMPAIGN_A2);
  });

  it("an ownership lookup that fails is 'unverified' (503 at the route), never treated as owned", async () => {
    failTable('campaign_versions', 'select');
    await expect(executeCampaignPreemption({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: CAMPAIGN_A2, justification: JUST, companyId: CO_A }))
      .rejects.toMatchObject({ kind: 'unverified' });
    untouched(CAMPAIGN_A2);
  });

  it("approval of a PRE-FIX request row naming B's campaign: refused; B unchanged; the request stays PENDING", async () => {
    await expect(executePreemptionFromRequest(REQ_X, JUST, CO_A)).rejects.toBeInstanceOf(PreemptionOwnershipError);
    untouched(CAMPAIGN_B);
    expect(rows('campaign_preemption_requests').find((r) => r.id === REQ_X)).toMatchObject({ status: 'PENDING' });
    expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
  });
});

describe('route: POST /api/campaigns/execute-preemption binds BOTH campaigns', () => {
  const body = (preempted: string) => ({ initiatorCampaignId: CAMPAIGN_A, preemptedCampaignId: preempted, companyId: CO_A, justification: JUST });

  it("A naming B's campaign -> 404 CAMPAIGN_NOT_FOUND; B unchanged; no governance event", async () => {
    const r = await invoke(executeRoute, { method: 'POST', as: 'A', body: body(CAMPAIGN_B) });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
    untouched(CAMPAIGN_B);
    expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
  });

  it("the TARGET is bound BEFORE the initiator's finalization check: a finalized initiator + B's target -> 404, no BLOCKED event", async () => {
    for (const c of rows('campaigns')) if (c.id === CAMPAIGN_A) c.execution_status = 'COMPLETED';
    const r = await invoke(executeRoute, { method: 'POST', as: 'A', body: body(CAMPAIGN_B) });
    expect(r.status).toBe(404);
    expect(mockRecordGovernanceEvent).not.toHaveBeenCalled();
  });

  it('CONTROL: A preempting its own campaign -> 200 and the target is PREEMPTED', async () => {
    const r = await invoke(executeRoute, { method: 'POST', as: 'A', body: body(CAMPAIGN_A2) });
    expect(r.status).toBe(200);
    expect(campaign(CAMPAIGN_A2)).toMatchObject({ execution_status: 'PREEMPTED' });
  });
});
