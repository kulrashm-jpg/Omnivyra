/**
 * Blueprint guard → HTTP contract for update-duration and commit-plan.
 *
 * The guard's three outcomes must stay distinguishable at the route:
 *   • BlueprintMutabilityReadError   → 503 BLUEPRINT_STATE_READ_FAILED (retryable)
 *   • BlueprintImmutableError        → 409 BLUEPRINT_IMMUTABLE         (policy conflict)
 *   • BlueprintExecutionFreezeError  → 409 EXECUTION_WINDOW_FROZEN     (policy conflict)
 * A missing campaign never reaches the guard: both routes 404 on their own read.
 *
 * The real error classes are used; only the guard call is stubbed.
 */
const CAMPAIGN_ROW = {
  id: 'camp-1',
  status: 'planning',
  current_stage: 'planning',
  blueprint_status: 'ACTIVE',
  duration_locked: false,
  duration_weeks: 4,
};
let campaignRow: Record<string, unknown> | null = CAMPAIGN_ROW;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit', 'order', 'in']) q[m] = () => q;
      q.maybeSingle = async () => ({
        data: table === 'campaigns' ? campaignRow : table === 'campaign_versions' ? { company_id: 'co-1' } : null,
        error: null,
      });
      return q;
    },
  },
}));
jest.mock('../../services/GovernanceLockdownService', () => ({ isGovernanceLocked: async () => false }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'user-1' }) }));
jest.mock('../../services/GovernanceEventService', () => ({ recordGovernanceEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/CampaignPrePlanningService', () => ({ runPrePlanning: jest.fn() }));
jest.mock('../../db/campaignPlanStore', () => ({ saveCampaignBlueprintFromLegacy: jest.fn() }));
jest.mock('../../services/campaignBlueprintAdapter', () => ({ fromStructuredPlan: jest.fn() }));
jest.mock('../../db/campaignVersionStore', () => ({ syncCampaignVersionStage: jest.fn() }));
jest.mock('../../services/campaignBlueprintService', () => ({
  ...jest.requireActual('../../services/campaignBlueprintService'),
  assertBlueprintMutable: jest.fn(),
}));

import updateDurationHandler from '../../../pages/api/campaigns/update-duration';
import commitPlanHandler from '../../../pages/api/campaigns/[id]/commit-plan';
import {
  assertBlueprintMutable,
  BlueprintImmutableError,
  BlueprintExecutionFreezeError,
  BlueprintMutabilityReadError,
} from '../../services/campaignBlueprintService';
import { invoke } from '../helpers/routeAuthHarness';

const guard = assertBlueprintMutable as jest.Mock;

const callUpdateDuration = () =>
  invoke(updateDurationHandler, {
    method: 'POST',
    body: { campaignId: 'camp-1', companyId: 'co-1', requested_weeks: 6 },
  });
const callCommitPlan = () =>
  invoke(commitPlanHandler, {
    method: 'POST',
    query: { id: 'camp-1' },
    body: { companyId: 'co-1', plan: { weeks: [] } },
  });

const ROUTES: Array<[string, () => ReturnType<typeof invoke>]> = [
  ['update-duration', callUpdateDuration],
  ['commit-plan', callCommitPlan],
];

beforeEach(() => {
  guard.mockReset();
  campaignRow = CAMPAIGN_ROW;
});

describe.each(ROUTES)('%s — blueprint guard error contract', (_name, call) => {
  it('a genuine read failure is 503 BLUEPRINT_STATE_READ_FAILED, not a policy conflict', async () => {
    guard.mockRejectedValueOnce(new BlueprintMutabilityReadError('campaigns', { message: 'connection reset' }));
    const res = await call();
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'BLUEPRINT_STATE_READ_FAILED' });
  });

  it('an immutability conflict stays 409 BLUEPRINT_IMMUTABLE', async () => {
    guard.mockRejectedValueOnce(new BlueprintImmutableError());
    const res = await call();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'BLUEPRINT_IMMUTABLE' });
  });

  it('a freeze-window conflict stays 409 EXECUTION_WINDOW_FROZEN', async () => {
    guard.mockRejectedValueOnce(new BlueprintExecutionFreezeError(undefined, 2, 24));
    const res = await call();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'EXECUTION_WINDOW_FROZEN' });
  });

  it('a missing campaign is the route 404 and never reaches the guard', async () => {
    campaignRow = null;
    const res = await call();
    expect(res.status).toBe(404);
    expect(guard).not.toHaveBeenCalled();
  });
});
