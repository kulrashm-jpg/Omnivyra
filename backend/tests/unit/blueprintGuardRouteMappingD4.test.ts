/**
 * D4 — blueprint guard → HTTP contract for regenerate-blueprint,
 * negotiate-duration, run-preplanning and schedule-structured-plan.
 *
 * Same three-way contract as blueprintGuardRouteMapping.test.ts:
 *   • BlueprintMutabilityReadError   → 503 BLUEPRINT_STATE_READ_FAILED (retryable)
 *   • BlueprintImmutableError        → 409 BLUEPRINT_IMMUTABLE         (policy conflict)
 *   • BlueprintExecutionFreezeError  → 409 EXECUTION_WINDOW_FROZEN     (policy conflict)
 * Before D4 these four routes had no branch for the read error, so a guard read
 * failure surfaced as a generic 500 — indistinguishable from a server bug.
 *
 * The real route handlers and the real error classes run; only the guard call
 * (and, for preplanning, the blueprint loader that gates it) is stubbed.
 */
import { idempotencyHeaders } from '../utils/idempotency';

// schedule-structured-plan adopted the caller-scoped withIdempotency middleware.
jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock());
jest.mock('../../db/writeOwner', () => {
  const actual = jest.requireActual('../../db/writeOwner');
  return {
    ...actual,
    ownedDbTable: jest.fn(require('../utils/idempotency').withIdempotencyTable(actual.ownedDbTable)),
  };
});

type Row = Record<string, unknown>;
let campaignRow: Row | null = null;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit', 'order', 'in', 'insert', 'update', 'upsert', 'delete']) q[m] = () => q;
      const data = (): unknown =>
        table === 'campaigns' ? campaignRow : table === 'campaign_versions' ? { company_id: 'co-1', campaign_snapshot: {} } : null;
      q.maybeSingle = async () => ({ data: data(), error: null });
      q.single = async () => ({ data: data(), error: null });
      q.then = (ok: (r: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  },
}));
jest.mock('../../services/GovernanceLockdownService', () => ({ isGovernanceLocked: async () => false }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'user-1' }) }));
jest.mock('../../services/campaignAccessService', () => ({
  requireCampaignAccess: async (_req: unknown, _res: unknown, campaignId: string) => ({
    userId: 'user-1', companyId: 'co-1', campaignId, campaignAuth: { role: 'COMPANY_ADMIN' },
  }),
}));
jest.mock('../../services/GovernanceEventService', () => ({ recordGovernanceEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/CampaignNegotiationService', () => ({ runDurationNegotiation: jest.fn() }));
jest.mock('../../services/CampaignPrePlanningService', () => ({ runPrePlanning: jest.fn() }));
jest.mock('../../services/aiGateway', () => ({ generatePrePlanningExplanation: jest.fn() }));
jest.mock('../../services/structuredPlanScheduler', () => ({ scheduleStructuredPlan: jest.fn() }));
jest.mock('../../services/SchedulerLockService', () => ({
  acquireSchedulerLock: jest.fn(async () => 'lock-1'),
  releaseSchedulerLock: jest.fn(async () => undefined),
  SchedulerLockError: class SchedulerLockError extends Error {},
}));
jest.mock('../../services/campaignBlueprintService', () => ({
  ...jest.requireActual('../../services/campaignBlueprintService'),
  assertBlueprintMutable: jest.fn(),
  assertBlueprintActive: jest.fn(async () => undefined),
  getUnifiedCampaignBlueprint: jest.fn(async () => ({ weeks: [{ week: 1 }] })),
}));

import regenerateHandler from '../../../pages/api/campaigns/regenerate-blueprint';
import negotiateHandler from '../../../pages/api/campaigns/negotiate-duration';
import preplanningHandler from '../../../pages/api/campaigns/run-preplanning';
import scheduleStructuredPlanHandler from '../../../pages/api/campaigns/[id]/schedule-structured-plan';
import {
  assertBlueprintMutable,
  assertBlueprintActive,
  BlueprintImmutableError,
  BlueprintExecutionFreezeError,
  BlueprintMutabilityReadError,
} from '../../services/campaignBlueprintService';
import { invoke } from '../helpers/routeAuthHarness';

const guard = assertBlueprintMutable as jest.Mock;
const activeGuard = assertBlueprintActive as jest.Mock;

// regenerate / negotiate / schedule-structured-plan evaluate a duration-set
// campaign; preplanning only reaches the guard while the duration is unset
// (a set duration returns APPROVED before it).
const DURATION_SET: Row = { id: 'camp-1', blueprint_status: 'ACTIVE', duration_weeks: 4, execution_status: null };
const DURATION_UNSET: Row = { id: 'camp-1', blueprint_status: 'ACTIVE', duration_weeks: null };

const ROUTES: Array<[string, Row, () => ReturnType<typeof invoke>]> = [
  ['regenerate-blueprint', DURATION_SET, () =>
    invoke(regenerateHandler, { method: 'POST', body: { campaignId: 'camp-1', companyId: 'co-1' } })],
  ['negotiate-duration', DURATION_SET, () =>
    invoke(negotiateHandler, { method: 'POST', body: { campaignId: 'camp-1', companyId: 'co-1', message: '6 weeks' } })],
  ['run-preplanning', DURATION_UNSET, () =>
    invoke(preplanningHandler, { method: 'POST', body: { campaignId: 'camp-1', companyId: 'co-1', requested_weeks: 6 } })],
  ['schedule-structured-plan', DURATION_SET, () =>
    invoke(scheduleStructuredPlanHandler, {
      method: 'POST',
      query: { id: 'camp-1' },
      headers: idempotencyHeaders(),
      body: { plan: { weeks: [] } },
    })],
];

beforeEach(() => {
  guard.mockReset();
  activeGuard.mockReset();
  activeGuard.mockResolvedValue(undefined);
  require('../utils/idempotency').resetIdempotency();
});

describe.each(ROUTES)('%s — blueprint guard error contract (D4)', (_name, row, call) => {
  beforeEach(() => { campaignRow = row; });

  it('a genuine guard read failure is 503 BLUEPRINT_STATE_READ_FAILED, not a 500 or a policy conflict', async () => {
    guard.mockRejectedValueOnce(new BlueprintMutabilityReadError('queue_jobs', { message: 'connection reset' }));
    const res = await call();
    expect(guard).toHaveBeenCalledTimes(1);
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
});

describe('schedule-structured-plan — assertBlueprintActive read failure is also 503', () => {
  it('maps the typed read error from the active-blueprint check', async () => {
    campaignRow = DURATION_SET;
    guard.mockResolvedValueOnce(undefined);
    activeGuard.mockRejectedValueOnce(new BlueprintMutabilityReadError('campaigns.blueprint_status', { message: 'timeout' }));
    const res = await invoke(scheduleStructuredPlanHandler, {
      method: 'POST', query: { id: 'camp-1' }, headers: idempotencyHeaders(), body: { plan: { weeks: [] } },
    });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'BLUEPRINT_STATE_READ_FAILED' });
  });
});
