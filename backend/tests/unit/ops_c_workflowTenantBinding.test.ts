/**
 * OPS-C — POST /api/active-leads/workflow binds the opportunity to the
 * authorized company.
 *
 * Before: companyId was authorized (enforceCompanyAccess) but opportunityId was
 * never checked. A cross-tenant item reached the insert; assignments and
 * dispositions failed on the composite tenant FK (23503 → HTTP 500 carrying the
 * database message), and notes/tags — single-column FK only — were WRITTEN in
 * tenant A pointing at tenant B's opportunity.
 *
 * The real guard chain runs (resolveUserContext → enforceCompanyAccess →
 * TenantGuard → rbacService); only the DB and identity provider are faked.
 */
import {
  seed, invoke, completedWrites, writeCalls, leaksB, failTable,
  CO_A, CO_B, USER_A,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/realtimePublisherService', () => ({ publishRealtime: async () => undefined }));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: () => undefined }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const handler = () => require('../../../pages/api/active-leads/workflow').default;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const svc = () => require('../../services/opportunityWorkflowService') as typeof import('../../services/opportunityWorkflowService');

const ITEM_A = '0a0a0a0a-0000-4000-8000-00000000000a';
const ITEM_B = '0b0b0b0b-0000-4000-8000-00000000000b';
const ITEM_NONE = '0c0c0c0c-0000-4000-8000-00000000000c';
const WRITE_TABLES = ['opportunity_notes', 'opportunity_tags', 'opportunity_assignments', 'opportunity_dispositions'];

const NOT_FOUND = { error: 'Opportunity not found', code: 'OPPORTUNITY_NOT_FOUND' };

let warnSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
beforeEach(() => {
  seed({
    opportunity_feed_items: [
      { id: ITEM_A, organization_id: CO_A },
      { id: ITEM_B, organization_id: CO_B },
    ],
  });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { warnSpy.mockRestore(); errSpy.mockRestore(); jest.restoreAllMocks(); });

const note = (opportunityId: string, companyId: string = CO_A) => ({
  companyId, opportunityId, kind: 'note', body: 'call back next week', visibility: 'internal',
});

describe('same tenant', () => {
  it('writes the note (200)', async () => {
    const r = await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_A) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });
    expect(completedWrites(['opportunity_notes'])).toHaveLength(1);
  });
});

describe('cross tenant and nonexistent', () => {
  it.each(['note', 'tag', 'assignment', 'disposition'])('%s on tenant B\'s opportunity is a 404 and writes nothing', async (kind) => {
    const body: Record<string, unknown> = { companyId: CO_A, opportunityId: ITEM_B, kind, body: 'x', tag: 'hot', assignedToUserId: USER_A, disposition: 'qualified' };
    const r = await invoke(handler(), { method: 'POST', as: 'A', body });
    expect(r.status).toBe(404);
    expect(r.body).toEqual(NOT_FOUND);
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
    expect(leaksB(r.body)).toBe(false);
  });

  it('a nonexistent opportunity gets the IDENTICAL response (no existence leak)', async () => {
    const cross = await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_B) });
    const none = await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_NONE) });
    const malformed = await invoke(handler(), { method: 'POST', as: 'A', body: note('not-a-uuid') });
    expect(none.status).toBe(404);
    expect(none.body).toEqual(cross.body);
    expect(malformed.status).toBe(404);
    expect(malformed.body).toEqual(cross.body);
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
  });

  it('records an audit line and never a database error', async () => {
    await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_B) });
    const audit = warnSpy.mock.calls.find((c) => c[0] === 'OPPORTUNITY_TENANT_MISMATCH');
    expect(audit).toBeDefined();
    expect(audit![1]).toMatchObject({ companyId: CO_A, userId: USER_A, kind: 'note', reason: 'pre_check' });
  });

  it('a residual item-FK 23503 at write time maps to the same 404, not a 500', async () => {
    jest.spyOn(svc(), 'addOpportunityNote').mockRejectedValueOnce(new (svc().OpportunityNotInTenantError)());
    const r = await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_A) });
    expect(r.status).toBe(404);
    expect(r.body).toEqual(NOT_FOUND);
    const audit = warnSpy.mock.calls.find((c) => c[0] === 'OPPORTUNITY_TENANT_MISMATCH');
    expect(audit![1]).toMatchObject({ reason: 'fk_violation' });
  });

  it('a failed opportunity lookup is a retryable 503, never an allow', async () => {
    failTable('opportunity_feed_items', 'select');
    const r = await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_A) });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ code: 'OPPORTUNITY_LOOKUP_ERROR', retryable: true });
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
  });
});

describe('tenant context and membership', () => {
  it('missing membership keeps the existing 403 (B posting into A)', async () => {
    const r = await invoke(handler(), { method: 'POST', as: 'B', body: note(ITEM_A) });
    expect(r.status).toBe(403);
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
  });

  it('missing membership is answered BEFORE the opportunity binding (403, not 404, for an item of the caller\'s own tenant)', async () => {
    const r = await invoke(handler(), { method: 'POST', as: 'B', body: note(ITEM_B, CO_A) });
    expect(r.status).toBe(403);
  });

  it('malformed tenant context: missing companyId is a 400', async () => {
    const r = await invoke(handler(), { method: 'POST', as: 'A', body: { opportunityId: ITEM_A, kind: 'note', body: 'x' } });
    expect(r.status).toBe(400);
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
  });

  it('malformed tenant context: an unknown company id is denied, never written', async () => {
    const r = await invoke(handler(), { method: 'POST', as: 'A', body: note(ITEM_A, 'garbage-company') });
    expect([403, 404]).toContain(r.status);
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
  });

  it('unauthenticated is a 401', async () => {
    const r = await invoke(handler(), { method: 'POST', as: null, body: note(ITEM_A) });
    expect(r.status).toBe(401);
    expect(writeCalls(WRITE_TABLES)).toHaveLength(0);
  });
});

describe('service-role / internal operation (no user principal)', () => {
  it('checkOpportunityInTenant binds by (id, organization_id)', async () => {
    const { checkOpportunityInTenant } = svc();
    await expect(checkOpportunityInTenant(CO_A, ITEM_A)).resolves.toBe('owned');
    await expect(checkOpportunityInTenant(CO_A, ITEM_B)).resolves.toBe('not_found');
    await expect(checkOpportunityInTenant(CO_B, ITEM_B)).resolves.toBe('owned');
    await expect(checkOpportunityInTenant(CO_A, ITEM_NONE)).resolves.toBe('not_found');
    await expect(checkOpportunityInTenant('', ITEM_A)).resolves.toBe('not_found');
    await expect(checkOpportunityInTenant(CO_A, "x' OR 1=1")).resolves.toBe('not_found');
  });

  it('a failed read is lookup_error, never owned', async () => {
    failTable('opportunity_feed_items', 'select');
    await expect(svc().checkOpportunityInTenant(CO_A, ITEM_A)).resolves.toBe('lookup_error');
  });

  it('isOpportunityItemFkViolation matches only the item FK', () => {
    const { isOpportunityItemFkViolation } = svc();
    expect(isOpportunityItemFkViolation({ code: '23503', message: 'insert or update on table "opportunity_assignments" violates foreign key constraint "opp_assignments_item_tenant_fk"' })).toBe(true);
    expect(isOpportunityItemFkViolation({ code: '23503', message: 'violates foreign key constraint "opportunity_notes_opportunity_feed_item_id_fkey"' })).toBe(true);
    expect(isOpportunityItemFkViolation({ code: '23503', message: 'violates foreign key constraint "opportunity_assignments_assigned_to_user_id_fkey"' })).toBe(false);
    expect(isOpportunityItemFkViolation({ code: '23505', message: 'opportunity_feed_item' })).toBe(false);
    expect(isOpportunityItemFkViolation(null)).toBe(false);
  });
});

afterAll(() => {
  require('../helpers/routeAuthHarness').assertNoHarnessConfigurationError();
});
