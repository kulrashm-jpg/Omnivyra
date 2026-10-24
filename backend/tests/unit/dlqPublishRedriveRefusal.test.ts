/**
 * Closure-008 B2 — POST /api/super-admin/dead-letter-queue must never report a
 * publish job as re-driven.
 *
 * The publish worker uses the BullMQ job id AS the queue_jobs row id, so a
 * 'replay:publish-<hash>' job names no row and is failed by the worker before
 * any claim: the re-drive could never publish. The route used to answer 200
 * `redriven`, audit `result: 'redriven'`, and delete the dead-letter row.
 *
 * The authorization gates are NOT under test here (closure009PrivilegedWrite-
 * Authorization covers them): requireCapability is mocked to admit an active
 * platform SUPER_ADMIN, and the test pins only what happens after the gates.
 */

const mockRows: Record<string, Record<string, unknown>> = {};
const mockAdd = jest.fn().mockResolvedValue(undefined);
const mockAudit = jest.fn().mockResolvedValue(undefined);

jest.mock('../../services/requestAccessService', () => ({
  requireAdminRateLimit: jest.fn(async () => true),
}));
jest.mock('../../security/requireCapability', () => ({
  // An active platform SUPER_ADMIN: since Closure-009 the re-drive also needs
  // platform write authority, and this suite pins what happens AFTER the gates.
  requireCapability: jest.fn(async () => ({
    ok: true,
    principal: { userId: 'operator-1', legacyCookieSuperAdmin: false, organizations: [{ organizationId: 'platform', role: 'SUPER_ADMIN', status: 'active' }] },
  })),
}));
jest.mock('../../services/adminAuditService', () => ({
  recordAdminAudit: (...a: unknown[]) => mockAudit(...a),
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    let op: 'select' | 'delete' = 'select';
    let pendingId: string | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      delete: () => { op = 'delete'; return b; },
      eq: (_col: string, val: string) => {
        pendingId = val;
        if (op === 'delete') { delete mockRows[val]; return Promise.resolve({ error: null }); }
        return b;
      },
      maybeSingle: () => Promise.resolve({ data: pendingId ? (mockRows[pendingId] ?? null) : null, error: null }),
    };
    return b;
  },
}));
jest.mock('../../queue/bullmqClient', () => ({
  getQueue: () => ({ add: mockAdd }),
  getPostingQueue: () => ({ add: mockAdd }),
  getAiHeavyQueue: () => ({ add: mockAdd }),
  getEngagementPollingQueue: () => ({ add: mockAdd }),
  getLeadThreadRecomputeQueue: () => ({ add: mockAdd }),
  getConversationMemoryRebuildQueue: () => ({ add: mockAdd }),
  makeStableJobId: (prefix: string) => `jobid:${prefix}`,
}));
jest.mock('../../queue/boltQueue', () => ({ getBoltQueue: () => ({ add: mockAdd }) }));
jest.mock('../../queue/contentGenerationQueues', () => ({
  CONTENT_QUEUE_CONFIG: { 'content-blog': {} },
  getContentQueue: () => ({ add: mockAdd }),
}));

import handler from '../../../pages/api/super-admin/dead-letter-queue';
import { PUBLISH_REDRIVE_UNSUPPORTED } from '../../services/jobInspection';

function seed(id: string, workerName: string, payload: Record<string, unknown>) {
  mockRows[id] = {
    id, worker_name: workerName, job_payload: payload, failure_reason: 'boom',
    attempt_count: 3, last_attempt_at: '2026-07-16T00:00:00.000Z', created_at: '2026-07-16T00:00:00.000Z',
  };
}

async function post(body: Record<string, unknown>) {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res: any = {
    statusCode: 200,
    status(c: number) { out.status = c; this.statusCode = c; return this; },
    json(b: unknown) { out.body = b; return this; },
    setHeader() { return this; },
    getHeader() { return undefined; },
    end() { return this; },
  };
  await (handler as any)({ method: 'POST', query: {}, headers: {}, body, cookies: {}, url: '/api/super-admin/dead-letter-queue' }, res);
  return out;
}

beforeEach(() => {
  for (const k of Object.keys(mockRows)) delete mockRows[k];
  mockAdd.mockClear();
  mockAudit.mockClear();
});

describe('DLQ re-drive route — publish jobs (Closure-008 B2)', () => {
  const PUBLISH_PAYLOAD = { scheduled_post_id: 'sp-1', social_account_id: 'sa-1', user_id: 'u-1' };

  it('a publish dead letter: 422, ok:false, audited as failed, nothing enqueued, row kept', async () => {
    seed('p1', 'publish', PUBLISH_PAYLOAD);
    const r = await post({ id: 'p1' });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ ok: false, results: [{ id: 'p1', ok: false, error: PUBLISH_REDRIVE_UNSUPPORTED }] });
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockRows.p1).toBeDefined();
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ action: 'dlq.redrive', metadata: { result: 'failed' } });
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('redriven');
  });

  it('a mixed batch: the supported entry is re-driven, the publish entry is reported failed (never redriven)', async () => {
    seed('p1', 'publish', PUBLISH_PAYLOAD);
    seed('l1', 'lead-thread-recompute', { leadId: 'l-1' });
    const r = await post({ ids: ['p1', 'l1'] });
    expect(r.status).toBe(200);
    const byId = Object.fromEntries((r.body.results as Array<{ id: string }>).map((x) => [x.id, x]));
    expect(byId.p1).toMatchObject({ ok: false, error: PUBLISH_REDRIVE_UNSUPPORTED });
    expect(byId.l1).toMatchObject({ ok: true, enqueued: true });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0]).toBe('lead-thread-recompute');
    expect(mockRows.p1).toBeDefined();
    expect(mockRows.l1).toBeUndefined();
  });
});
