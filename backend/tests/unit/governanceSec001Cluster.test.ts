/**
 * GOVERNANCE-SEC-001 — the pages/api/governance/* cluster (five routes).
 *
 * Two defects, three already correct:
 *
 *   events           NO authentication, NO authorization. A caller-supplied
 *                    companyId went straight into a service-role predicate.
 *                    Anonymous cross-tenant read of the governance timeline,
 *                    including raw event metadata. FIXED.
 *   campaign-status  NO authentication, and the campaign was selected BY ID
 *                    ALONE. The owning company even fell back to the
 *                    CALLER-SUPPLIED companyId when no campaign_version
 *                    existed. FIXED.
 *   company-drift    withRBAC → enforceRole binds the role check to the
 *   replay-event     request's companyId (getUserRole(user, companyId) with
 *   simulate-policy  status='active'), and each route then requires its
 *                    resource to belong to that same company. Correct as
 *                    written — unchanged, and pinned here against regression.
 *
 * The REAL authorization chain runs in every test: withRBAC → enforceRole →
 * resolveUserContext → getUserRole, and requireCompanyAccess →
 * assertTenantAccess. Only the data layer, the auth seam, and the execution
 * sinks are mocked, so the actual membership decision tree is exercised.
 *
 * Assertions inspect the SINK — the query predicate, and for the dangerous
 * routes whether replayGovernanceEvent / runPrePlanning / the rate-limiter
 * were invoked at all.
 */

const MEMBER_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const ADMIN_A = 'dddddddd-0000-0000-0000-0000000000dd';
const SUPERADMIN = 'cccccccc-0000-0000-0000-0000000000cc';
const COMPANY_A = 'a0000000-0000-0000-0000-00000000000a';
const COMPANY_B = 'b0000000-0000-0000-0000-00000000000b';
const CAMPAIGN_A = 'ca000000-0000-0000-0000-00000000000a';
const CAMPAIGN_B = 'cb000000-0000-0000-0000-00000000000b';
const EVENT_B = 'eb000000-0000-0000-0000-00000000000b';

/** (user, company) → role. ADMIN_A is COMPANY_ADMIN of A; MEMBER_A is a plain member. */
const ROLES: Array<{ user_id: string; company_id: string; role: string; status: string }> = [
  { user_id: MEMBER_A, company_id: COMPANY_A, role: 'CONTENT_CREATOR', status: 'active' },
  { user_id: ADMIN_A, company_id: COMPANY_A, role: 'COMPANY_ADMIN', status: 'active' },
  { user_id: SUPERADMIN, company_id: COMPANY_A, role: 'SUPER_ADMIN', status: 'active' },
];

const CAMPAIGN_OWNER: Record<string, string> = { [CAMPAIGN_A]: COMPANY_A, [CAMPAIGN_B]: COMPANY_B };
/** The governance event under test belongs to COMPANY_B. */
const EVENT_OWNER: Record<string, string> = { [EVENT_B]: COMPANY_B };

let authUser: string | null = MEMBER_A;

type Q = { table: string; filters: Record<string, unknown> };
const queries: Q[] = [];
const writes: Array<{ table: string; payload: unknown }> = [];

/** Execution sinks — the whole point of the replay/simulate audit. */
const replayCalls: string[] = [];
const prePlanningCalls: Array<Record<string, unknown>> = [];
const rateLimiterCalls: string[] = [];
const analyticsCalls: string[] = [];

/** Governance data reads, excluding the authorization chain's own lookups. */
const govQueries = () =>
  queries.filter(q => !['user_company_roles', 'companies'].includes(q.table));

jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () =>
    authUser
      ? { user: { id: authUser, email: 'u@example.com', emailVerified: true }, error: null }
      : { user: null, error: 'MISSING_AUTH' }
  ),
}));

jest.mock('../../security/IdentityResolver', () => ({
  resolvePrincipal: jest.fn(async () =>
    authUser
      ? { ok: true, principal: { userId: authUser, supabaseUid: authUser, legacyCookieSuperAdmin: false } }
      : { ok: false, reason: 'NO_AUTH' }
  ),
}));

jest.mock('../../db/supabaseClient', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {};
    let selected = '';
    const b: any = {};
    b.select = (cols?: string) => { selected = cols ?? ''; return b; };
    b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.in = (c: string, v: unknown) => { filters[c] = v; return b; };
    b.gte = (c: string, v: unknown) => { filters[`${c}__gte`] = v; return b; };
    b.lte = (c: string, v: unknown) => { filters[`${c}__lte`] = v; return b; };
    b.order = () => b; b.limit = () => b; b.range = () => b;
    b.insert = (p: unknown) => { writes.push({ table, payload: p }); return Promise.resolve({ error: null }); };
    b.update = (p: unknown) => { writes.push({ table, payload: p }); return b; };
    b.delete = () => { writes.push({ table, payload: 'delete' }); return b; };

    const rows = (): any[] => {
      if (table === 'user_company_roles') {
        return ROLES.filter(r =>
          (filters.user_id === undefined || r.user_id === filters.user_id) &&
          (filters.company_id === undefined || r.company_id === filters.company_id) &&
          (filters.role === undefined || r.role === filters.role) &&
          (filters.status === undefined || r.status === filters.status)
        ).map(r => (selected.includes('id') && !selected.includes('role') ? { id: `${r.user_id}:${r.company_id}` } : r));
      }
      if (table === 'companies') return [{ id: filters.id, status: 'active' }];
      if (table === 'campaigns') {
        const owner = CAMPAIGN_OWNER[String(filters.id)];
        return owner ? [{ id: filters.id, company_id: owner, priority_level: 'NORMAL', is_protected: false,
          blueprint_status: 'ACTIVE', duration_weeks: 12, duration_locked: false,
          last_preempted_at: null, execution_status: null, auto_optimize_enabled: false }] : [];
      }
      if (table === 'campaign_governance_events') {
        const owner = EVENT_OWNER[String(filters.id)];
        if (filters.id !== undefined) return owner ? [{ id: filters.id, company_id: owner }] : [];
        // timeline / latest-event reads
        return [{ id: 'ev1', campaign_id: CAMPAIGN_B, company_id: COMPANY_B,
                  event_type: 'EVAL', event_status: 'DONE',
                  metadata: { secret: 'VICTIM_GOVERNANCE_METADATA' }, created_at: '2026-01-01' }]
          .filter(r => filters.company_id === undefined || r.company_id === filters.company_id)
          .filter(r => filters.campaign_id === undefined || r.campaign_id === filters.campaign_id);
      }
      if (table === 'governance_audit_runs') return [{ audit_status: 'OK' }];
      return [];
    };
    const resolve = () => {
      queries.push({ table, filters: { ...filters } });
      return { data: rows(), count: rows().length, error: null };
    };
    b.maybeSingle = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.single = () => { const r = resolve(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); };
    b.then = (fn: any) => Promise.resolve(resolve()).then(fn);
    return b;
  };
  return { supabase: { from: (t: string) => build(t) } };
});

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => require('../../db/supabaseClient').supabase.from(t),
}));

/* ── execution sinks ─────────────────────────────────────────────────── */

jest.mock('../../services/GovernanceReplayService', () => ({
  replayGovernanceEvent: jest.fn(async (id: string) => {
    replayCalls.push(id);
    return { policyHashMatch: true, statusMatch: true };
  }),
  ReplayNotSupportedError: class extends Error {},
}));
jest.mock('../../services/GovernanceRateLimiter', () => ({
  tryConsumeReplayToken: jest.fn((c: string) => { rateLimiterCalls.push(c); return true; }),
}));
jest.mock('../../services/CampaignPrePlanningService', () => ({
  runPrePlanning: jest.fn(async (a: Record<string, unknown>) => {
    prePlanningCalls.push(a);
    return { status: 'APPROVED', limiting_constraints: [], blocking_constraints: [],
             max_weeks_allowed: 12, min_weeks_required: 1, tradeOffOptions: [] };
  }),
}));
jest.mock('../../governance/GovernancePolicyRegistry', () => ({
  getGovernancePolicy: jest.fn(() => ({ hash: 'h1' })),
  PolicyVersionNotFoundError: class extends Error {},
}));
jest.mock('../../services/GovernanceAnalyticsService', () => ({
  getCompanyGovernanceAnalytics: jest.fn(async (c: string) => {
    analyticsCalls.push(c);
    return { totalCampaigns: 1, verifiedCampaigns: 1, driftedCampaigns: 0, averageReplayCoverage: 1,
             integrityRiskScore: 0, lastSnapshotAt: null, lastSnapshotId: null, snapshotCount: 0,
             ledgerIntegrity: 'OK', projectionStatus: 'OK', averageRoiScore: 0 };
  }),
}));
jest.mock('../../services/GovernanceLockdownService', () => ({ isGovernanceLocked: jest.fn(async () => false) }));
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: jest.fn(async (id: string) => {
    const owner = CAMPAIGN_OWNER[id];
    return owner ? { company_id: owner, campaign_snapshot: {} } : null;
  }),
}));
jest.mock('../../services/campaignBlueprintService', () => ({ getBlueprintBlockReason: jest.fn(async () => null) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import eventsHandler from '../../../pages/api/governance/events';
import campaignStatusHandler from '../../../pages/api/governance/campaign-status';
import companyDriftHandler from '../../../pages/api/governance/company-drift';
import replayEventHandler from '../../../pages/api/governance/replay-event';
import simulatePolicyHandler from '../../../pages/api/governance/simulate-policy';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  return res;
}
async function call(h: any, as: string | null, query: Record<string, unknown>, method = 'GET') {
  authUser = as;
  const res = mockRes();
  await h({ method, url: '/api/governance/x', query, body: {}, headers: {} } as never, res);
  return res;
}
function assertNoVictimData(body: unknown) {
  const blob = JSON.stringify(body ?? {});
  expect(blob).not.toContain('VICTIM_GOVERNANCE_METADATA');
  expect(blob).not.toContain(COMPANY_B);
}
const noSinks = () => {
  expect(replayCalls).toEqual([]);
  expect(prePlanningCalls).toEqual([]);
  expect(rateLimiterCalls).toEqual([]);
  expect(analyticsCalls).toEqual([]);
  expect(writes).toEqual([]);
};

beforeEach(() => {
  authUser = MEMBER_A;
  queries.length = 0; writes.length = 0;
  replayCalls.length = 0; prePlanningCalls.length = 0;
  rateLimiterCalls.length = 0; analyticsCalls.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'debug').mockImplementation(() => {});
});

/* ═══ events — FIXED ═════════════════════════════════════════════════ */

describe('governance/events', () => {
  it('A/B CRITICAL: unauthenticated → 401 and the timeline is never queried', async () => {
    const res = await call(eventsHandler, null, { companyId: COMPANY_B });
    expect(res.statusCode).toBe(401);
    expect(govQueries()).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('C: a member still reads their own company timeline', async () => {
    const res = await call(eventsHandler, MEMBER_A, { companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  it('D/E CRITICAL: naming another company is 403 with no governance read', async () => {
    const res = await call(eventsHandler, MEMBER_A, { companyId: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(govQueries()).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('the timeline predicate is the AUTHORIZED company', async () => {
    await call(eventsHandler, MEMBER_A, { companyId: COMPANY_A });
    const sink = govQueries().find(q => q.table === 'campaign_governance_events');
    expect(sink!.filters.company_id).toBe(COMPANY_A);
  });

  it('G: a scope/role flag is not a privilege grant', async () => {
    const res = await call(eventsHandler, MEMBER_A, { companyId: COMPANY_B, scope: 'platform', role: 'SUPER_ADMIN', isAdmin: 'true' });
    expect(res.statusCode).toBe(403);
    expect(govQueries()).toEqual([]);
  });

  it('H: a super admin keeps the platform bypass', async () => {
    const res = await call(eventsHandler, SUPERADMIN, { companyId: COMPANY_B });
    expect(res.statusCode).toBe(200);
  });

  it('J: a malformed companyId cannot bypass the guard', async () => {
    const res = await call(eventsHandler, MEMBER_A, { companyId: "x' OR 1=1--" });
    expect(res.statusCode).not.toBe(200);
    expect(govQueries()).toEqual([]);
  });
});

/* ═══ campaign-status — FIXED ════════════════════════════════════════ */

describe('governance/campaign-status', () => {
  it('A/B CRITICAL: unauthenticated → 401, nothing read', async () => {
    const res = await call(campaignStatusHandler, null, { campaignId: CAMPAIGN_B });
    expect(res.statusCode).toBe(401);
    expect(govQueries()).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('C: a member still reads their own campaign', async () => {
    const res = await call(campaignStatusHandler, MEMBER_A, { campaignId: CAMPAIGN_A });
    expect(res.statusCode).toBe(200);
    expect(res.body.companyId).toBe(COMPANY_A);
  });

  it('D/F CRITICAL: another tenant’s campaign is refused, and no event metadata is read', async () => {
    const res = await call(campaignStatusHandler, MEMBER_A, { campaignId: CAMPAIGN_B });
    expect(res.statusCode).toBe(403);
    assertNoVictimData(res.body);
    // Ownership resolution may read campaigns; the governance event read must not happen.
    expect(govQueries().filter(q => q.table === 'campaign_governance_events')).toEqual([]);
  });

  it('E CRITICAL: a caller-supplied companyId is never used as the campaign’s tenant', async () => {
    // The pre-fix fallback was `cv.company_id ?? companyIdQuery`. Naming your
    // OWN company must not make another tenant's campaign readable.
    const res = await call(campaignStatusHandler, MEMBER_A, { campaignId: CAMPAIGN_B, companyId: COMPANY_A });
    expect(res.statusCode).toBe(403);
    assertNoVictimData(res.body);
  });

  it('I: an unresolvable campaign keeps the established 404', async () => {
    const res = await call(campaignStatusHandler, MEMBER_A, { campaignId: 'ff000000-0000-0000-0000-0000000000ff' });
    expect(res.statusCode).toBe(404);
    expect(govQueries().filter(q => q.table === 'campaign_governance_events')).toEqual([]);
  });

  it('a missing campaignId is rejected before any work', async () => {
    const res = await call(campaignStatusHandler, MEMBER_A, {});
    expect(res.statusCode).toBe(400);
    expect(govQueries()).toEqual([]);
  });
});

/* ═══ replay-event — ALREADY CORRECT, pinned ═════════════════════════ */

describe('governance/replay-event (already correct)', () => {
  it('A/B CRITICAL: unauthenticated → 401 and replay is never invoked', async () => {
    const res = await call(replayEventHandler, null, { eventId: EVENT_B, companyId: COMPANY_B });
    expect(res.statusCode).toBe(401);
    noSinks();
  });

  it('D/E CRITICAL: an admin of A cannot replay B’s event, even naming B', async () => {
    // withRBAC → enforceRole binds the role check to the SUPPLIED companyId,
    // so naming the victim company fails the role check outright.
    const res = await call(replayEventHandler, ADMIN_A, { eventId: EVENT_B, companyId: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(replayCalls).toEqual([]);
    expect(rateLimiterCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('F CRITICAL: naming your OWN company with a foreign event is 404, no replay', async () => {
    // The second layer: the event's company_id must equal the authorized
    // company, so the two caller inputs cannot be mixed.
    const res = await call(replayEventHandler, ADMIN_A, { eventId: EVENT_B, companyId: COMPANY_A });
    expect(res.statusCode).toBe(404);
    expect(replayCalls).toEqual([]);
    expect(rateLimiterCalls).toEqual([]);
  });

  it('G: a scope flag does not grant replay', async () => {
    const res = await call(replayEventHandler, MEMBER_A, { eventId: EVENT_B, companyId: COMPANY_B, scope: 'platform' });
    expect(res.statusCode).toBe(403);
    expect(replayCalls).toEqual([]);
  });

  it('a plain member of A cannot replay even within A', async () => {
    const res = await call(replayEventHandler, MEMBER_A, { eventId: EVENT_B, companyId: COMPANY_A });
    expect(res.statusCode).toBe(403);
    expect(replayCalls).toEqual([]);
  });

  it('a missing companyId is refused before replay', async () => {
    const res = await call(replayEventHandler, ADMIN_A, { eventId: EVENT_B });
    expect(res.statusCode).toBe(400);
    expect(replayCalls).toEqual([]);
  });
});

/* ═══ simulate-policy — ALREADY CORRECT, pinned ══════════════════════ */

describe('governance/simulate-policy (already correct)', () => {
  it('A/B CRITICAL: unauthenticated → 401 and pre-planning never runs', async () => {
    const res = await call(simulatePolicyHandler, null, { campaignId: CAMPAIGN_B, policyVersion: 'v1', companyId: COMPANY_B });
    expect(res.statusCode).toBe(401);
    noSinks();
  });

  it('D/E CRITICAL: an admin of A cannot simulate for B', async () => {
    const res = await call(simulatePolicyHandler, ADMIN_A, { campaignId: CAMPAIGN_B, policyVersion: 'v1', companyId: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(prePlanningCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('F CRITICAL: own company + foreign campaign is 403, and no evaluation runs', async () => {
    const res = await call(simulatePolicyHandler, ADMIN_A, { campaignId: CAMPAIGN_B, policyVersion: 'v1', companyId: COMPANY_A });
    expect(res.statusCode).toBe(403);
    expect(prePlanningCalls).toEqual([]);
  });

  it('C: a legitimate admin simulates their own campaign with events suppressed', async () => {
    const res = await call(simulatePolicyHandler, ADMIN_A, { campaignId: CAMPAIGN_A, policyVersion: 'v1', companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(prePlanningCalls).toHaveLength(1);
    // "Simulate" must stay side-effect free: suppressEvents is what keeps the
    // evaluation from emitting governance events.
    expect(prePlanningCalls[0].suppressEvents).toBe(true);
    expect(prePlanningCalls[0].companyId).toBe(COMPANY_A);
    expect(writes).toEqual([]);
  });
});

/* ═══ company-drift — ALREADY CORRECT, pinned ════════════════════════ */

describe('governance/company-drift (already correct)', () => {
  it('A/B CRITICAL: unauthenticated → 401 and analytics never runs', async () => {
    const res = await call(companyDriftHandler, null, { companyId: COMPANY_B });
    expect(res.statusCode).toBe(401);
    noSinks();
  });

  it('D/E CRITICAL: an admin of A cannot read B’s drift', async () => {
    const res = await call(companyDriftHandler, ADMIN_A, { companyId: COMPANY_B });
    expect(res.statusCode).toBe(403);
    expect(analyticsCalls).toEqual([]);
    assertNoVictimData(res.body);
  });

  it('C: a legitimate admin reads their own company', async () => {
    const res = await call(companyDriftHandler, ADMIN_A, { companyId: COMPANY_A });
    expect(res.statusCode).toBe(200);
    expect(analyticsCalls).toEqual([COMPANY_A]);
  });
});

/* ═══ cluster-wide ═══════════════════════════════════════════════════ */

describe('cluster-wide', () => {
  it('CRITICAL: across all five routes a denied caller reaches no sink and writes nothing', async () => {
    await call(eventsHandler, MEMBER_A, { companyId: COMPANY_B });
    await call(campaignStatusHandler, MEMBER_A, { campaignId: CAMPAIGN_B, companyId: COMPANY_A });
    await call(companyDriftHandler, MEMBER_A, { companyId: COMPANY_B });
    await call(replayEventHandler, MEMBER_A, { eventId: EVENT_B, companyId: COMPANY_B });
    await call(simulatePolicyHandler, MEMBER_A, { campaignId: CAMPAIGN_B, policyVersion: 'v1', companyId: COMPANY_B });
    expect(replayCalls).toEqual([]);
    expect(prePlanningCalls).toEqual([]);
    expect(rateLimiterCalls).toEqual([]);
    expect(analyticsCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('every route refuses a non-GET verb', async () => {
    for (const h of [eventsHandler, campaignStatusHandler, companyDriftHandler, replayEventHandler, simulatePolicyHandler]) {
      const res = await call(h, ADMIN_A, { companyId: COMPANY_A, campaignId: CAMPAIGN_A, eventId: EVENT_B, policyVersion: 'v1' }, 'POST');
      expect(res.statusCode).toBe(405);
    }
    noSinks();
  });
});
