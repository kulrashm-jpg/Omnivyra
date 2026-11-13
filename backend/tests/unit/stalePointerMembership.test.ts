/**
 * BLOCKING (e9, 2026-11-13; the users.active_company_id sweep): the "current company" pointer is a PREFERENCE, not
 * proof of membership. C60 measured 25 of 33 prod pointers naming a company where the user's membership is INACTIVE.
 * The onboarding journey (service + POST), company-provenance and domain/track-event trusted the raw pointer, so a
 * former member of B read B's onboarding / integration state and wrote B's journey state and domain events.
 *
 * Rule now: the pointer counts only with an ACTIVE membership; otherwise the first active membership; otherwise none;
 * then enforceCompanyAccess. The db fake is FAITHFUL: every eq filter must match (status 'active' included).
 */
type Row = Record<string, any>;
const CO_A = 'c0a00000-0000-4000-8000-00000000000a';
const CO_B = 'c0b00000-0000-4000-8000-00000000000b';
const USER = 'u0000000-0000-4000-8000-000000000001';

let db: Record<string, Row[]> = {};
const writes: Array<{ table: string; op: string; row: Row }> = [];
function table(name: string) {
  const filters: Array<[string, unknown]> = [];
  let op: 'select' | 'upsert' | 'insert' | 'update' = 'select';
  let payload: Row | null = null;
  const q: any = {};
  const rows = () => (db[name] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
  q.select = () => q;
  for (const m of ['order', 'limit', 'not', 'gte', 'lte', 'in']) q[m] = () => q;
  q.eq = (c: string, v: unknown) => { filters.push([c, v]); return q; };
  q.upsert = (p: Row) => { op = 'upsert'; payload = p; writes.push({ table: name, op, row: p }); return q; };
  q.insert = (p: Row) => { op = 'insert'; payload = p; writes.push({ table: name, op, row: p }); return q; };
  q.update = (p: Row) => { op = 'update'; payload = p; return q; };
  q.maybeSingle = async () => ({ data: op === 'select' ? rows()[0] ?? null : payload, error: null });
  q.single = async () => ({ data: op === 'select' ? rows()[0] ?? null : payload, error: null });
  q.then = (ok: any, ko: any) => Promise.resolve({ data: op === 'select' ? rows() : [payload], error: null }).then(ok, ko);
  return q;
}
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => table(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => table(t), ownedDbRpc: jest.fn() }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/activationReadinessService', () => ({
  buildActivationReadiness: async () => ({ companyId: null, generatedAt: 'now', activated: false, checks: [] }),
}));
jest.mock('../../services/onboardingEventService', () => ({ emitOnboardingEvent: async () => undefined, resolveOnboardingCorrelationId: () => 'c' }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: { id: 'u0000000-0000-4000-8000-000000000001', supabaseUid: 'u0000000-0000-4000-8000-000000000001', emailVerified: true }, error: null }),
}));
const accessCalls: string[] = [];
jest.mock('../../services/userContextService', () => ({
  // Real authorization is not what this suite tests; it records WHICH company was authorized and allows it.
  enforceCompanyAccess: jest.fn(async ({ companyId }: any) => { accessCalls.push(companyId); return { userId: 'u0000000-0000-4000-8000-000000000001' }; }),
}));
const provenanceFor: string[] = [];
jest.mock('../../services/companyProfileProvenanceService', () => ({
  getCompanyProfileProvenance: async (companyId: string) => { provenanceFor.push(companyId); return { companyId }; },
}));
const domainEvents: Row[] = [];
jest.mock('../../services/domainEventLogger', () => ({ logDomainEvent: (e: Row) => { domainEvents.push(e); } }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIp: () => '127.0.0.1' }));

/* eslint-disable @typescript-eslint/no-var-requires */
const { buildOnboardingJourney } = require('../../services/onboardingJourneyService');
const journeyRoute = require('../../../pages/api/onboarding/journey').default;
const provenanceRoute = require('../../../pages/api/onboarding/company-provenance').default;
const trackEventRoute = require('../../../pages/api/domain/track-event').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const call = async (handler: any, method: string, body: Row = {}) => {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = (k: string, v: unknown) => { res.headers[k] = v; return res; };
  await handler({ method, query: {}, headers: {}, body }, res);
  return res;
};
/** Stale pointer to B (membership INACTIVE), active membership only in A. */
const staleWorld = () => ({
  users: [{ id: USER, supabase_uid: USER, name: 'Jo', is_email_verified: true, active_company_id: CO_B }],
  user_company_roles: [
    { user_id: USER, company_id: CO_B, status: 'inactive', created_at: '2026-03-01T00:00:00Z' },
    { user_id: USER, company_id: CO_A, status: 'active', created_at: '2026-06-01T00:00:00Z' },
  ],
  company_setup_progress: [{ company_id: CO_B, journey_state: { stages: { social_accounts: 'skipped' } } }],
  company_profiles: [{ company_id: CO_B, name: 'B SECRET Corp' }],
  social_accounts: [{ company_id: CO_B, platform: 'linkedin' }],
  analytics_integrations: [],
  company_integrations: [],
});

beforeEach(() => {
  db = staleWorld();
  writes.length = 0; accessCalls.length = 0; provenanceFor.length = 0; domainEvents.length = 0;
});

describe('a STALE pointer (to a company the user left) never reaches that company', () => {
  it("journey service: the company is A (the active membership), not the pointer's B", async () => {
    const j = await buildOnboardingJourney(USER);
    expect(j.companyId).toBe(CO_A);
    expect(JSON.stringify(j)).not.toContain('B SECRET');
  });

  it('CONTROL: a pointer WITH an active membership is honoured', async () => {
    db.user_company_roles.push({ user_id: USER, company_id: CO_B, status: 'active', created_at: '2026-01-01T00:00:00Z' });
    db.user_company_roles = db.user_company_roles.filter((r) => !(r.company_id === CO_B && r.status === 'inactive'));
    expect((await buildOnboardingJourney(USER)).companyId).toBe(CO_B);
  });

  it('no active membership at all -> no company (the stale pointer is ignored)', async () => {
    db.user_company_roles = db.user_company_roles.filter((r) => r.company_id !== CO_A);
    expect((await buildOnboardingJourney(USER)).companyId).toBeNull();
  });

  it('journey POST writes A’s journey state, never B’s, and authorizes A first', async () => {
    const r = await call(journeyRoute, 'POST', { stage: 'social_accounts', action: 'skip' });
    expect(r.statusCode).toBe(200);
    const progressWrites = writes.filter((w) => w.table === 'company_setup_progress');
    expect(progressWrites.length).toBeGreaterThan(0);
    expect(progressWrites.every((w) => w.row.company_id === CO_A)).toBe(true);
    expect(accessCalls).toContain(CO_A);
    expect(accessCalls).not.toContain(CO_B);
  });

  it('journey POST with no active membership -> refused (409 NO_COMPANY), nothing written', async () => {
    db.user_company_roles = db.user_company_roles.filter((r) => r.company_id !== CO_A);
    const r = await call(journeyRoute, 'POST', { stage: 'social_accounts', action: 'skip' });
    expect(r.statusCode).toBe(409);
    expect(writes.filter((w) => w.table === 'company_setup_progress')).toHaveLength(0);
  });

  it("company-provenance returns A's provenance (authorized), never B's", async () => {
    const r = await call(provenanceRoute, 'GET');
    expect(r.statusCode).toBe(200);
    expect(provenanceFor).toEqual([CO_A]);
    expect(accessCalls).toEqual([CO_A]);
  });

  it('domain/track-event attributes the event and reminder to A, never the stale B', async () => {
    const r = await call(trackEventRoute, 'POST', { event: 'DOMAIN_VERIFICATION_SKIPPED', final_domain: 'a.test' });
    expect(r.statusCode).toBe(202);
    expect(domainEvents[0]).toMatchObject({ company_id: CO_A });
    const reminders = writes.filter((w) => w.table === 'domain_reminders');
    expect(reminders).toHaveLength(1);
    expect(reminders[0].row.company_id).toBe(CO_A);
    expect(accessCalls).toEqual([CO_A]);
  });

  it('domain/track-event with no active membership -> logged with NO company (never the stale B)', async () => {
    db.user_company_roles = db.user_company_roles.filter((r) => r.company_id !== CO_A);
    await call(trackEventRoute, 'POST', { event: 'CLICK_VERIFY' });
    expect(domainEvents[0]).toMatchObject({ company_id: null });
    expect(accessCalls).toEqual([]);
  });
});
