/**
 * B3 (financial-writes contract; e9 BLOCKING, e1 approved) - the async render route never enqueues a render without
 * its billing HOLD, on the new-job path AND the dedupe-reuse path. A failed hold used to be ignored (unread insert),
 * and a retry then found the existing job, skipped hold creation and enqueued UNBILLED.
 * Drives the REAL handler; rendering internals, workspace loader, access check and data layer are faked.
 */
export {};

type Row = Record<string, any>;
const mockState: {
  existingJob: Row | null; holds: Row[]; failHoldInsert: boolean; failHoldRead: boolean; enqueued: number; inserts: Array<{ table: string; row: Row }>;
} = { existingJob: null, holds: [], failHoldInsert: false, failHoldRead: false, enqueued: 0, inserts: [] };

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u-1' }) }));
jest.mock('../../services/creator/intelligence/workspace', () => ({ loadCreatorWorkspace: () => ({ ok: true, task: { asset_family: 'image' } }) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../services/creator/rendering', () => {
  class RenderProjectionError extends Error { code = 'x'; }
  return {
    isCreatorRenderingEnabled: () => true,
    isCreatorRenderQueueEnabled: () => true,
    executeRenderJob: jest.fn(),
    createRenderProviderRegistry: () => ({ resolveProviderChain: () => ['openai'] }),
    enqueueRenderJob: jest.fn(async () => { mockState.enqueued += 1; return { queue_job_id: 'q-1', event: 'render_enqueued' }; }),
    projectRenderRequest: () => ({ canonical_asset_family: 'image', render_modality: 'image', deterministic_input_hash: 'h'.repeat(64) }),
    RenderProjectionError,
    evaluateRenderGovernance: () => ({ allowed: true }),
    coerceGovernanceRow: (r: unknown) => r,
    GLOBAL_GOVERNANCE_SENTINEL: '00000000-0000-0000-0000-000000000000',
  };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    insert: (row: Row) => {
      if (table === 'billing_operations' && mockState.failHoldInsert) {
        const p: any = Promise.resolve({ data: null, error: { message: 'insert refused' } });
        return p;
      }
      mockState.inserts.push({ table, row });
      if (table === 'billing_operations') mockState.holds.push({ id: 'bo-new', ...row });
      const rec = { id: table === 'creator_render_job' ? 'job-new' : `${table}-1`, ...row };
      const p: any = Promise.resolve({ data: rec, error: null });
      p.select = () => ({ single: async () => ({ data: rec, error: null }) });
      return p;
    },
  }),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {};
      const filters: Record<string, unknown> = {};
      b.select = () => b; b.in = () => b; b.gte = () => b; b.limit = () => b;
      b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
      b.maybeSingle = async () => {
        if (table === 'daily_content_plans') return { data: { id: 'p-1', campaign_id: 'camp-1', content: { platform: 'instagram' }, intent_type: 'creator', organization_id: 'org-1' }, error: null };
        if (table === 'campaigns') return { data: { company_id: 'org-1' }, error: null };
        if (table === 'creator_render_job') return { data: mockState.existingJob, error: null };
        return { data: null, error: null };
      };
      b.then = (res: any, rej: any) => {
        if (table === 'billing_operations') {
          if (mockState.failHoldRead) return Promise.resolve({ data: null, error: { message: 'read refused' } }).then(res, rej);
          return Promise.resolve({ data: mockState.holds.filter((h) => h.idempotency_key === filters.idempotency_key), error: null }).then(res, rej);
        }
        return Promise.resolve({ data: [], error: null }).then(res, rej);
      };
      return b;
    },
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const handler = require('../../../pages/api/activity-workspace/[id]/render-image').default;
/* eslint-enable @typescript-eslint/no-var-requires */

function call() {
  const res: any = { statusCode: 0, body: null, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return Promise.resolve(handler({ method: 'POST', query: { id: 'p-1' }, body: {}, headers: {} }, res)).then(() => res);
}
beforeEach(() => {
  mockState.existingJob = null; mockState.holds = []; mockState.failHoldInsert = false; mockState.failHoldRead = false;
  mockState.enqueued = 0; mockState.inserts = [];
});

it('CONTROL: a new job gets its HOLD and is enqueued (202)', async () => {
  const res = await call();
  expect(res.statusCode).toBe(202);
  expect(mockState.holds).toEqual([expect.objectContaining({ idempotency_key: 'render:job-new', status: 'held' })]);
  expect(mockState.enqueued).toBe(1);
});

it('a FAILED hold insert on a new job -> 503 billing_hold_failed and NOT enqueued', async () => {
  mockState.failHoldInsert = true;
  const res = await call();
  expect(res.statusCode).toBe(503);
  expect(res.body.render).toMatchObject({ ok: false, reason: 'billing_hold_failed' });
  expect(mockState.enqueued).toBe(0);
});

it('the RETRY HOLE: an existing job with NO hold gets its hold created before it is enqueued', async () => {
  mockState.existingJob = { id: 'job-old' };
  const res = await call();
  expect(res.statusCode).toBe(202);
  expect(mockState.holds).toEqual([expect.objectContaining({ idempotency_key: 'render:job-old', status: 'held' })]);
  expect(mockState.enqueued).toBe(1);
});

it('an existing job WITH its hold is not given a second one', async () => {
  mockState.existingJob = { id: 'job-old' };
  mockState.holds = [{ id: 'bo-1', idempotency_key: 'render:job-old', status: 'held' }];
  const res = await call();
  expect(res.statusCode).toBe(202);
  expect(mockState.inserts.filter((i) => i.table === 'billing_operations')).toEqual([]);
  expect(mockState.enqueued).toBe(1);
});

it('a FAILED hold lookup -> 503, not enqueued (a null error is not an answer)', async () => {
  mockState.existingJob = { id: 'job-old' };
  mockState.failHoldRead = true;
  const res = await call();
  expect(res.statusCode).toBe(503);
  expect(mockState.enqueued).toBe(0);
});
