/**
 * G-11 — who may see and decide an opt-out review: the tenant's OWN admin (COMPANY_ADMIN in
 * that company), never the platform super-admin bypass, never a non-admin member, never
 * another tenant's admin. The real routes over a doubled TenantGuard decision and a doubled
 * service; the decision itself is optOutReview.test.ts, and the real guard on a real schema
 * is realschema/g11_optout_review.test.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

export {};

type Row = Record<string, unknown>;

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => { throw new Error('no table access in this suite'); } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no table access in this suite'); } } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const ADMIN = '00000000-0000-4000-8000-0000000000d1';
const ORG = '00000000-0000-4000-8000-0000000000a1';
const REVIEW = '00000000-0000-4000-8000-0000000000e1';

const mockAccess = { companyAllowed: true };
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res }: { res: { status: (n: number) => { json: (j: unknown) => void } } }) => {
    if (!mockAccess.companyAllowed) { res.status(403).json({ error: 'Access denied to company' }); return null; }
    return { userId: '00000000-0000-4000-8000-0000000000d1' };
  }),
}));
type Decision = { ok: true; access: { role: string | null; bypass: boolean } } | { ok: false; reason: string };
const mockGuard = { decision: { ok: true, access: { role: 'COMPANY_ADMIN', bypass: false } } as Decision, inputs: [] as Row[] };
jest.mock('../../security/TenantGuard', () => ({
  assertTenantAccess: jest.fn(async (i: Row) => { mockGuard.inputs.push(i); return mockGuard.decision; }),
}));
const mockService = { outcome: null as Row | null, decideInputs: [] as Row[] };
jest.mock('../../services/orchestration/optOutReview', () => ({
  listOptOutReviews: jest.fn(async () => [{ id: '00000000-0000-4000-8000-0000000000e1', state: 'pending', overdue: false }]),
  getOptOutReview: jest.fn(async () => ({ id: '00000000-0000-4000-8000-0000000000e1', state: 'pending' })),
  decideOptOutReview: jest.fn(async (i: Row) => { mockService.decideInputs.push(i); return mockService.outcome; }),
}));
const mockAudit: Row[] = [];
jest.mock('../../services/execution/executionAuditService', () => ({ recordExecutionAudit: jest.fn(async (a: Row) => { mockAudit.push(a); }) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const listRoute = require('../../../pages/api/contact-optout-reviews/index').default;
const reviewRoute = require('../../../pages/api/contact-optout-reviews/[id]').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function call(route: (req: NextApiRequest, res: NextApiResponse) => unknown, method: string, query: Row, body: Row = {}) {
  const out = { status: 0, json: {} as Row };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method, query, body, headers: {}, url: '/api/contact-optout-reviews' };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}
const decide = (body: Row = { reopenChannels: ['email'], reason: 'confirmed by phone' }) =>
  call(reviewRoute, 'POST', { id: REVIEW, company_id: ORG }, body);
const list = () => call(listRoute, 'GET', { company_id: ORG });

const APPLIED = {
  ok: true, reviewId: REVIEW, decision: 'reopen', reopenedChannels: ['email'], closedChannels: ['phone', 'whatsapp'],
  revokedIds: ['h1'], closingRecordIds: ['c1', 'c2'], preExistingHoldIds: [], heldByOtherReview: ['h9'], reinstatedHoldIds: [],
};

beforeEach(() => {
  mockAccess.companyAllowed = true;
  mockGuard.decision = { ok: true, access: { role: 'COMPANY_ADMIN', bypass: false } };
  mockGuard.inputs = [];
  mockService.outcome = { ...APPLIED };
  mockService.decideInputs = [];
  mockAudit.length = 0;
});

describe('who decides (owner rule 4)', () => {
  it('the company admin decides: the actor is the authenticated principal, the tenant the verified one; an audit row is written', async () => {
    const r = await decide({ reopenChannels: ['email'], reason: 'confirmed by phone', actorUserId: 'someone-else', organizationId: 'other' });
    expect(r.status).toBe(200);
    expect(r.json.decision).toMatchObject({ reviewId: REVIEW, decision: 'reopen', reopenedChannels: ['email'], heldByOtherReview: ['h9'], reinstatedHoldIds: [] });
    expect(mockService.decideInputs).toEqual([{ organizationId: ORG, reviewId: REVIEW, actorUserId: ADMIN, reopenChannels: ['email'], reason: 'confirmed by phone' }]);
    expect(mockGuard.inputs).toEqual([{ userId: ADMIN, organizationId: ORG, options: { noPlatformBypass: true } }]);
    expect(mockAudit).toEqual([expect.objectContaining({
      companyId: ORG, stage: 'suppression', decision: 'cancelled', reason: 'optout_review_reopen', actor: ADMIN,
      evidence: { review_id: REVIEW, reopened_channels: ['email'], closed_channels: ['phone', 'whatsapp'], revoked_ids: ['h1'], closing_record_ids: ['c1', 'c2'], held_by_other_review: ['h9'], reinstated_hold_ids: [] },
    })]);
  });

  it('keep_closed is audited as `suppressed`', async () => {
    mockService.outcome = { ...APPLIED, decision: 'keep_closed', reopenedChannels: [], closedChannels: ['email', 'phone', 'whatsapp'] };
    expect((await decide({ reopenChannels: [], reason: 'no' })).status).toBe(200);
    expect(mockAudit[0]).toMatchObject({ decision: 'suppressed', reason: 'optout_review_keep_closed' });
  });

  it('the super-admin BYPASS is refused: the guard is asked without it, and a bypass grant is refused anyway', async () => {
    mockGuard.decision = { ok: true, access: { role: null, bypass: true } };
    expect(await decide()).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    expect(await list()).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    expect(mockGuard.inputs.every((i) => (i.options as Row).noPlatformBypass === true)).toBe(true);
    expect(mockService.decideInputs).toEqual([]);
  });

  it('a super-admin with no membership in this company is refused (the guard falls through to NOT_A_MEMBER)', async () => {
    mockGuard.decision = { ok: false, reason: 'NOT_A_MEMBER' };
    expect((await decide()).status).toBe(403);
    expect(mockService.decideInputs).toEqual([]);
  });

  it.each(['CONTENT_CREATOR', 'VIEW_ONLY', 'CONTENT_REVIEWER', 'SUPER_ADMIN', ''])('a member whose role here is %p is refused', async (role) => {
    mockGuard.decision = { ok: true, access: { role, bypass: false } };
    expect(await decide()).toMatchObject({ status: 403, json: { code: 'company_admin_required' } });
    expect(await list()).toMatchObject({ status: 403 });
    expect(mockService.decideInputs).toEqual([]);
    expect(mockAudit).toEqual([]);
  });

  it('the legacy ADMIN spelling is a company admin', async () => {
    mockGuard.decision = { ok: true, access: { role: 'ADMIN', bypass: false } };
    expect((await decide()).status).toBe(200);
  });

  it('another tenant\'s admin is refused by the company check before the role check', async () => {
    mockAccess.companyAllowed = false;
    expect((await decide()).status).toBe(403);
    expect((await list()).status).toBe(403);
    expect(mockGuard.inputs).toEqual([]);
    expect(mockService.decideInputs).toEqual([]);
  });

  it('another tenant\'s admin let through by a legacy company fallback still has no admin membership here', async () => {
    mockGuard.decision = { ok: false, reason: 'NOT_A_MEMBER' };
    expect((await decide()).status).toBe(403);
    expect((await list()).status).toBe(403);
  });
});

describe('responses', () => {
  it.each([
    ['channel_locked', 400], ['reason_required', 400], ['unknown_channel', 400], ['invalid_channels', 400],
    ['review_not_found', 404], ['decision_race_lost', 409], ['governance_write_failed', 503],
  ])('%s → %i, and nothing is audited', async (code, status) => {
    mockService.outcome = { ok: false, code, reason: 'r', ...(code === 'channel_locked' ? { channels: ['whatsapp'] } : {}) };
    const r = await decide();
    expect(r.status).toBe(status);
    expect(r.json.code).toBe(code);
    if (code === 'channel_locked') expect(r.json.channels).toEqual(['whatsapp']);
    expect(mockAudit).toEqual([]);
  });

  it('reconcile_incomplete → 503, and the partly applied decision IS audited', async () => {
    mockService.outcome = { ok: false, code: 'reconcile_incomplete', reason: 'retry the decision',
      applied: { reviewId: REVIEW, decision: 'reopen', recorded: true, revokedIds: ['h1'], heldByOtherReview: [], closingRecordIds: ['c1'] } };
    const r = await decide();
    expect(r).toMatchObject({ status: 503, json: { code: 'reconcile_incomplete' } });
    expect(mockAudit).toEqual([expect.objectContaining({
      companyId: ORG, stage: 'suppression', decision: 'cancelled', reason: 'optout_review_reconcile_incomplete', actor: ADMIN,
      evidence: { review_id: REVIEW, recorded: true, revoked_ids: ['h1'], held_by_other_review: [], closing_record_ids: ['c1'] },
    })]);
  });

  it('bad ids and methods', async () => {
    expect((await call(reviewRoute, 'POST', { id: 'nope', company_id: ORG })).status).toBe(400);
    expect((await call(reviewRoute, 'POST', { id: REVIEW })).status).toBe(400);
    expect((await call(reviewRoute, 'DELETE', { id: REVIEW, company_id: ORG })).status).toBe(405);
    expect((await call(listRoute, 'POST', { company_id: ORG })).status).toBe(405);
    expect((await call(listRoute, 'GET', { company_id: ORG, state: 'open' })).status).toBe(400);
  });

  it('the admin lists the company\'s reviews and reads one', async () => {
    expect(await list()).toMatchObject({ status: 200, json: { reviews: [{ id: REVIEW, overdue: false }] } });
    expect(await call(reviewRoute, 'GET', { id: REVIEW, company_id: ORG })).toMatchObject({ status: 200, json: { review: { id: REVIEW } } });
  });
});
