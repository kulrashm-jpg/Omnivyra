/**
 * G-11 — a prospect closed to NEW journeys by its company's admin: the enrolment gate
 * (enrollment.ts → contactEnrolmentClosure.ts), the manual close/reopen and the admin route, over
 * an in-memory store. The real-schema twin is realschema/g11_optout_review.test.ts ("enrolment
 * closure").
 *
 * Owner ruling (2026-11-07): "new journey gets closed while prospect is closed and once it is
 * opened by admin it will be open for new journeys. only copany admin can close or reopen the
 * prospect"; "Also a manual close".
 */
import type { NextApiRequest, NextApiResponse } from 'next';

export {};

type Row = Record<string, unknown>;

const mockDb = { tables: {} as Record<string, Row[]>, fail: new Set<string>(), seq: 0 };
const mockUuid = () => `00000000-0000-4000-8000-${String(++mockDb.seq).padStart(12, '0')}`;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const st = { op: 'select', payload: null as Row | null, tests: [] as Array<(r: Row) => boolean>, mode: 'many' };
    const rows = () => (mockDb.tables[table] ??= []);
    const exec = async () => {
      if (mockDb.fail.has(table)) return { data: null, error: { code: '08006', message: 'down' } };
      if (st.op === 'insert') {
        const row: Row = { id: mockUuid(), closed_at: new Date().toISOString(), reopened_by: null, reopened_at: null, reopen_reason: null, ...st.payload };
        if (table === 'contact_enrolment_closures' && rows().some((r) => r.organization_id === row.organization_id && r.prospect_id === row.prospect_id && r.reopened_at == null)) {
          return { data: null, error: { code: '23505', message: 'one active' } };
        }
        rows().push(row);
        return { data: { ...row }, error: null };
      }
      const hit = rows().filter((r) => st.tests.every((t) => t(r)));
      if (st.op === 'update') for (const r of hit) Object.assign(r, st.payload);
      const out = hit.map((r) => ({ ...r }));
      if (st.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one' } };
      return { data: out, error: null };
    };
    const b: Row = {
      select: () => b, order: () => b,
      insert: (p: Row) => { st.op = 'insert'; st.payload = p; return b; },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      eq: (c: string, v: unknown) => { st.tests.push((r) => r[c] === v); return b; },
      in: (c: string, v: unknown[]) => { st.tests.push((r) => v.includes(r[c])); return b; },
      is: (c: string, v: unknown) => { st.tests.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      single: () => { st.mode = 'single'; return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no client in this suite'); } } }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/workflows/workflowStore', () => ({
  getCurrentWorkflowVersion: jest.fn(async () => ({ id: 'ver-1', definition: { enrollment: { conditions: [] } } })),
}));

const ORG = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b1';
const PROSPECT = '00000000-0000-4000-8000-0000000000c1';
const PERSON = '00000000-0000-4000-8000-0000000000c2';
const ADMIN = '00000000-0000-4000-8000-0000000000d1';

const mockPerson = { ok: true, personId: PERSON as string | null, contacts: { email: 'Ana@Example.test', phone: '+44 7700 900123' } as { email: string | null; phone: string | null } | null };
const mockAccess = { companyAllowed: true };
const mockGuard = { decision: { ok: true, access: { role: 'COMPANY_ADMIN', bypass: false } } as Row };
const mockAudit: Row[] = [];
jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async ({ res }: { res: { status: (n: number) => { json: (j: unknown) => void } } }) => {
    if (!mockAccess.companyAllowed) { res.status(403).json({ error: 'Access denied to company' }); return null; }
    return { userId: '00000000-0000-4000-8000-0000000000d1' };
  }),
}));
jest.mock('../../security/TenantGuard', () => ({ assertTenantAccess: jest.fn(async () => mockGuard.decision) }));
jest.mock('../../services/execution/executionAuditService', () => ({ recordExecutionAudit: jest.fn(async (a: Row) => { mockAudit.push(a); }) }));
jest.mock('../../services/orchestration/individualIntelligence', () => {
  const actual = jest.requireActual('../../services/orchestration/individualIntelligence');
  const port = {
    resolvePerson: async () => ({ ok: mockPerson.ok, personId: mockPerson.personId }),
    readPersonContacts: async () => mockPerson.contacts,
    readLeadIntelligence: async () => null,
    readProspectScore: async () => null,
    channelPermission: async () => true,
    readProspectState: async () => null,
  };
  return { ...actual, durableIntelligencePort: port };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const { checkEnrollmentEligibility } = require('../../services/orchestration/enrollment');
const { durableIntelligencePort } = require('../../services/orchestration/individualIntelligence');
const route = require('../../../pages/api/contact-enrolment-closures/index').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const enrol = (org = ORG) => checkEnrollmentEligibility({ organizationId: org, workflowId: 'wf', subject: { kind: 'prospect', id: PROSPECT }, intelligence: durableIntelligencePort });
const review = (r: Row) => (mockDb.tables.contact_opt_out_reviews ??= []).push({
  id: mockUuid(), organization_id: ORG, anchor_kind: 'person', anchor_channel: null, anchor_value: PERSON, person_id: PERSON,
  state: 'pending', decision: null, merged_into: null, ...r,
}) && mockDb.tables.contact_opt_out_reviews[mockDb.tables.contact_opt_out_reviews.length - 1];
function call(method: string, query: Row, body: Row = {}) {
  const out = { status: 0, json: {} as Row };
  const res = {
    setHeader: () => res, status(n: number) { out.status = n; return res; }, json(j: Row) { out.json = j; return res; },
    end() { return res; }, writableEnded: false, headersSent: false, getHeader: () => undefined,
  };
  const req = { method, query, body, headers: {}, url: '/api/contact-enrolment-closures' };
  return Promise.resolve(route(req as unknown as NextApiRequest, res as unknown as NextApiResponse)).then(() => out);
}
const close = (reason: unknown = 'asked us by phone') => call('POST', { company_id: ORG }, { action: 'close', prospectId: PROSPECT, reason });
const reopen = (reason: unknown = 'confirmed again') => call('POST', { company_id: ORG }, { action: 'reopen', prospectId: PROSPECT, reason });

beforeEach(() => {
  mockDb.tables = {}; mockDb.fail = new Set(); mockDb.seq = 100;
  mockPerson.ok = true; mockPerson.personId = PERSON; mockPerson.contacts = { email: 'Ana@Example.test', phone: '+44 7700 900123' };
  mockAccess.companyAllowed = true;
  mockGuard.decision = { ok: true, access: { role: 'COMPANY_ADMIN', bypass: false } };
  mockAudit.length = 0;
});

describe('the review-derived gate (no write of its own)', () => {
  it('open with no review; a PENDING person review closes it as contact_closed_by_admin', async () => {
    expect(await enrol()).toMatchObject({ eligible: true, reasons: [] });
    review({});
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closed_by_admin'] });
  });

  it('decided reopen (any channel) opens; keep_closed holds; a later re-decision to reopen opens', async () => {
    const r = review({ state: 'decided', decision: 'reopen' });
    expect((await enrol()).eligible).toBe(true);
    r.decision = 'keep_closed';
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closed_by_admin'] });
    r.decision = 'reopen';
    expect((await enrol()).eligible).toBe(true);
  });

  it('a target-anchored STOP review on the CANONICAL number closes the prospect whose stored phone is spaced', async () => {
    review({ anchor_kind: 'target', anchor_channel: 'whatsapp', anchor_value: '+447700900123', person_id: null });
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closed_by_admin'] });
  });

  it('an email target matches the canonical (lower-cased) address; a phone target does not match the email', async () => {
    review({ anchor_kind: 'target', anchor_channel: 'email', anchor_value: 'ana@example.test', person_id: null });
    expect((await enrol()).eligible).toBe(false);
    mockDb.tables.contact_opt_out_reviews[0].anchor_channel = 'phone';
    expect((await enrol()).eligible).toBe(true);
  });

  it('a MERGED review is followed to the review it merged into, which governs', async () => {
    const t = review({ anchor_kind: 'target', anchor_channel: 'email', anchor_value: 'elsewhere@example.test', person_id: null });
    review({ state: 'merged', merged_into: t.id });
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closed_by_admin'] });   // t pending
    Object.assign(t, { state: 'decided', decision: 'reopen' });
    expect((await enrol()).eligible).toBe(true);
  });

  it('another tenant\'s review has no effect', async () => {
    review({ organization_id: ORG_B });
    review({ organization_id: ORG_B, anchor_kind: 'target', anchor_channel: 'email', anchor_value: 'ana@example.test', person_id: null });
    expect((await enrol()).eligible).toBe(true);
  });
});

describe('FAIL CLOSED: an unknown closure state never enrols', () => {
  it.each([
    ['the review store', () => { mockDb.fail.add('contact_opt_out_reviews'); }],
    ['the closure store', () => { mockDb.fail.add('contact_enrolment_closures'); }],
    ['the person', () => { mockPerson.ok = false; mockPerson.personId = null; }],
    ['the address', () => { mockPerson.contacts = null; }],
  ])('%s unreadable → contact_closure_unreadable', async (_what, arrange) => {
    (arrange as () => void)();
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closure_unreadable'] });
  });
});

describe('the manual gate, through the admin route', () => {
  it('close → refused; reopen → enrols; each audited without the reason text', async () => {
    expect((await close()).status).toBe(201);
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closed_by_admin'] });
    expect((await close()).json).toMatchObject({ code: 'already_closed' });
    expect((await reopen()).status).toBe(200);
    expect((await enrol()).eligible).toBe(true);
    expect(mockAudit).toEqual([
      expect.objectContaining({ companyId: ORG, stage: 'control', decision: 'blocked', reason: 'contact_enrolment_closed', actor: ADMIN }),
      expect.objectContaining({ decision: 'allowed', reason: 'contact_enrolment_reopened', actor: ADMIN }),
    ]);
    expect(JSON.stringify(mockAudit)).not.toMatch(/asked us by phone|confirmed again|example\.test|7700/);
    expect(mockDb.tables.contact_enrolment_closures).toHaveLength(1);
    expect((await reopen()).json).toMatchObject({ code: 'not_closed' });
  });

  it('a manual reopen while a REVIEW still holds is 409 closed_by_optout_review with the review; nothing changes, enrolment stays refused', async () => {
    await close();
    const r = review({});
    const out = await reopen();
    expect(out).toMatchObject({ status: 409, json: { code: 'closed_by_optout_review', reviewId: r.id } });
    expect(mockDb.tables.contact_enrolment_closures[0]).toMatchObject({ reopened_at: null });
    expect(await enrol()).toMatchObject({ eligible: false, reasons: ['contact_closed_by_admin'] });
    expect(mockAudit).toHaveLength(1);
  });

  it('a reason is required (1–500), and the GET reports which gate holds', async () => {
    expect(await close('  ')).toMatchObject({ status: 400, json: { code: 'reason_required' } });
    expect(await close('x'.repeat(501))).toMatchObject({ status: 400, json: { code: 'reason_required' } });
    await close();
    expect((await call('GET', { company_id: ORG, prospect_id: PROSPECT })).json).toMatchObject({ status: { closed: true, gate: 'manual' } });
    const r = review({});
    expect((await call('GET', { company_id: ORG, prospect_id: PROSPECT })).json).toMatchObject({ status: { closed: true, gate: 'optout_review', reviewId: r.id } });
  });

  it('another tenant\'s closure has no effect', async () => {
    (mockDb.tables.contact_enrolment_closures ??= []).push({ id: mockUuid(), organization_id: ORG_B, prospect_id: PROSPECT, reopened_at: null });
    expect((await enrol()).eligible).toBe(true);
  });
});

describe('who: COMPANY_ADMIN of that company only', () => {
  it.each([
    ['a non-admin member', () => { mockGuard.decision = { ok: true, access: { role: 'VIEW_ONLY', bypass: false } }; }],
    ['a company-scoped SUPER_ADMIN', () => { mockGuard.decision = { ok: true, access: { role: 'SUPER_ADMIN', bypass: false } }; }],
    ['the super-admin bypass', () => { mockGuard.decision = { ok: true, access: { role: null, bypass: true } }; }],
    ['another tenant\'s admin (no membership here)', () => { mockGuard.decision = { ok: false, reason: 'NOT_A_MEMBER' }; }],
    ['a refused company check', () => { mockAccess.companyAllowed = false; }],
  ])('%s is refused, and nothing is written or audited', async (_who, arrange) => {
    (arrange as () => void)();
    expect((await close()).status).toBe(403);
    expect((await reopen()).status).toBe(403);
    expect(mockDb.tables.contact_enrolment_closures ?? []).toEqual([]);
    expect(mockAudit).toEqual([]);
  });
});
