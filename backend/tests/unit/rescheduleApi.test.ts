/**
 * Tests for /api/activity-workspace/[id]/reschedule.
 *
 *   - retime-only: scheduled_posts.scheduled_for updates; lifecycle stays scheduled
 *   - replace-media-only: validation runs → scheduled → media_uploaded → ready_for_schedule → scheduled
 *   - replace-media-and-retime: combined flow; both scheduled_posts.media_urls and scheduled_for update
 *   - rejection: row in unsupported state (e.g. awaiting_media_upload) → 409
 *   - rejection: row not attachment-required
 *   - rejection: missing both fields → 400
 *   - rejection: scheduled_at in the past → 400
 *   - concurrency mismatch → 409 CONCURRENT_UPLOAD_CONFLICT
 *   - validation failure → row → upload_failed; scheduled_post NOT updated
 */

import {
  idempotencyHeaders,
  makeAssertable,
  resetIdempotency,
  withIdempotencyTable,
} from '../utils/idempotency';

// WS1-E6-T006: this endpoint adopted the caller-scoped withIdempotency
// middleware. AUTHENTICATION only — the endpoint's own authorization still
// runs inside the handler and is still asserted below.
jest.mock('../../security/IdentityResolver', () =>
  require('../utils/idempotency').identityResolverMock());


function createRes() {
  return {
    statusCode: 200,
    body: null as unknown,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: unknown) {
      this.body = body;
      return this;
    }),
    setHeader: jest.fn(),
  };
}

let supabaseRows: Record<string, unknown> = {};
const ownedUpdates: Array<{ table: string; payload: Record<string, any>; filter: Record<string, any> }> = [];
let mockValidatorReturn: { valid: boolean; errors?: string[]; details?: any; validated_at?: string } = {
  valid: true, validated_at: 'now', details: {},
};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        maybeSingle: jest.fn(async () => {
          // Lookup of scheduled_posts user_id/social_account_id during reschedule
          if (table === 'scheduled_posts') {
            return { data: { user_id: 'user-1', social_account_id: 'sa-1' }, error: null };
          }
          return { data: supabaseRows[`${table}:single`] ?? null, error: null };
        }),
      };
      return api;
    }),
    storage: {
      from: jest.fn(() => ({
        remove: jest.fn(async () => ({ data: null, error: null })),
      })),
    },
  },
}));

function chain(table: string) {
  let updatePayload: Record<string, any> | null = null;
  const filters: Record<string, any> = {};
  const api: any = {
    select: jest.fn(() => api),
    eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
    update: jest.fn((p: Record<string, any>) => { updatePayload = p; return api; }),
    maybeSingle: jest.fn(async () => ({ data: null, error: null })),
    then(resolve: any) {
      if (updatePayload) {
        ownedUpdates.push({ table, payload: updatePayload, filter: { ...filters } });
      }
      return Promise.resolve({ data: null, error: null }).then(resolve);
    },
  };
  return api;
}

jest.mock('../../db/writeOwner', () => ({
  // withIdempotency stores its record in api_idempotency_keys via this same
  // accessor; the wrapper serves that one table a stateful double and passes
  // every other table through to this suite's own double, unchanged.
  ownedDbTable: jest.fn(require('../utils/idempotency').withIdempotencyTable((table: string) => chain(table))),
}));

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1', companyId: 'company-1' })),
}));

jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => mockValidatorReturn),
}));

const queueCalls = {
  cancel: [] as Array<{ id: string; reason?: string }>,
  enqueue: [] as Array<{ id: string; userId: string; socialAccountId: string; scheduledFor: string }>,
  atomic: [] as Array<{ id: string; userId: string; socialAccountId: string; scheduledFor: string; reason?: string }>,
};
let mockAtomicResult: { ok: boolean; locked: boolean; enqueue: string; cancel: any; idempotency_key: string; rollback?: string } = {
  ok: true,
  locked: true,
  enqueue: 'enqueued',
  cancel: { db_cancelled: 1, queue_removed: 1, errors: [] },
  idempotency_key: 'reschedule:sp-1:0',
};
jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async (id: string, options: any) => {
    queueCalls.cancel.push({ id, reason: options?.reason });
    return { db_cancelled: 1, queue_removed: 1, errors: [] };
  }),
  enqueueScheduledPostAt: jest.fn(async (scheduledPostId: string, userId: string, socialAccountId: string, scheduledFor: string) => {
    queueCalls.enqueue.push({ id: scheduledPostId, userId, socialAccountId, scheduledFor });
    return 'enqueued';
  }),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: any) => {
    queueCalls.atomic.push({
      id: input.scheduledPostId,
      userId: input.userId,
      socialAccountId: input.socialAccountId,
      scheduledFor: input.newScheduledFor,
      reason: input.reason,
    });
    // Also push to the cancel/enqueue trackers so existing assertions still work
    if (mockAtomicResult.ok) {
      queueCalls.cancel.push({ id: input.scheduledPostId, reason: input.reason });
      queueCalls.enqueue.push({
        id: input.scheduledPostId,
        userId: input.userId,
        socialAccountId: input.socialAccountId,
        scheduledFor: input.newScheduledFor,
      });
    }
    return mockAtomicResult;
  }),
  tryAcquireScheduledPostQueueLock: jest.fn(async () => ({ acquired: true, release: async () => undefined, mode: 'advisory' })),
}));

function setScheduledRow(opts?: { revision?: number; lifecycle?: string }) {
  const history = Array.from({ length: opts?.revision ?? 4 }, (_, i) => ({ to: `state-${i}` }));
  supabaseRows = {
    'daily_content_plans:single': {
      id: 'plan-1',
      campaign_id: 'campaign-1',
      content_type: 'reel',
      content: {
        creator_lifecycle_state: opts?.lifecycle ?? 'scheduled',
        uploaded_media_url: 'https://supabase.test/storage/v1/object/public/media-uploads/company-1/plan-1/video/prior.mp4',
        scheduled_post_id: 'sp-1',
        creator_lifecycle_history: history,
      },
      content_status: opts?.lifecycle ?? 'scheduled',
      platform: 'instagram',
      scheduled_time: null,
      date: '2030-01-01',
    },
    'campaigns:single': { company_id: 'company-1' },
  };
}

async function callHandler(body: Record<string, any>) {
  const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/reschedule');
  const req: any = { method: 'POST', headers: idempotencyHeaders(), query: { id: 'plan-1' }, body };
  const res = makeAssertable(createRes()) as any;
  await handler(req, res);
  return res;
}

describe('reschedule API', () => {
  beforeEach(() => {
    resetIdempotency();
    jest.clearAllMocks();
    ownedUpdates.length = 0;
    queueCalls.cancel.length = 0;
    queueCalls.enqueue.length = 0;
    mockValidatorReturn = { valid: true, validated_at: 'now', details: { detected_mime: 'video/mp4', detected_size_bytes: 1024 } } as any;
  });

  test('rejects with 400 when no media_url and no scheduled_at provided', async () => {
    setScheduledRow();
    const res = await callHandler({});
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rejects with 400 when scheduled_at is in the past', async () => {
    setScheduledRow();
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await callHandler({ scheduled_at: past });
    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.body as any).error).toMatch(/must be in the future/);
  });

  test('rejects with 409 for non-attachment-required format', async () => {
    supabaseRows = {
      'daily_content_plans:single': {
        id: 'plan-1', campaign_id: 'campaign-1', content_type: 'infographic',
        content: { creator_lifecycle_state: 'render_ready' },
        content_status: 'render_ready', platform: 'instagram',
      },
      'campaigns:single': { company_id: 'company-1' },
    };
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await callHandler({ scheduled_at: future });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('RESCHEDULE_NOT_VALID_FOR_FORMAT');
  });

  test('rejects with 409 when row lifecycle is not scheduled/ready_for_schedule', async () => {
    setScheduledRow({ lifecycle: 'awaiting_media_upload' });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await callHandler({ scheduled_at: future });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('RESCHEDULE_INVALID_STATE');
  });

  test('retime-only: updates scheduled_posts.scheduled_for; lifecycle stays scheduled', async () => {
    setScheduledRow({ revision: 4 });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await callHandler({ scheduled_at: future });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).media_replaced).toBe(false);
    expect((res.body as any).to).toBe('scheduled');
    // scheduled_posts updated with new scheduled_for
    const postUpdate = ownedUpdates.find((u) => u.table === 'scheduled_posts');
    expect(postUpdate?.payload.scheduled_for).toBe(future);
    // No media_urls overwrite when retiming only
    expect(postUpdate?.payload.media_urls).toBeUndefined();
  });

  test('replace-media-only: validation runs, FSM transitions, scheduled_posts.media_urls updates', async () => {
    setScheduledRow({ revision: 4 });
    const newUrl = 'https://supabase.test/storage/v1/object/public/media-uploads/company-1/plan-1/video/new.mp4';
    const res = await callHandler({ media_url: newUrl, source: 'external_link' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).media_replaced).toBe(true);
    expect((res.body as any).to).toBe('scheduled');
    const postUpdate = ownedUpdates.find((u) => u.table === 'scheduled_posts');
    expect(postUpdate?.payload.media_urls).toEqual([newUrl]);
    // Daily plan updated with new content + scheduled status
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('scheduled');
    const updatedContent = JSON.parse(planUpdate!.payload.content);
    expect(updatedContent.uploaded_media_url).toBe(newUrl);
    // FSM history contains the reschedule transitions
    const reasons = (updatedContent.creator_lifecycle_history as Array<Record<string, unknown>>)
      .map((h) => h.reason).filter(Boolean);
    expect(reasons).toContain('reschedule_replace_media');
  });

  test('replace-media + retime: both media_urls and scheduled_for update on scheduled_posts', async () => {
    setScheduledRow({ revision: 4 });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const newUrl = 'https://supabase.test/storage/v1/object/public/media-uploads/company-1/plan-1/video/new.mp4';
    const res = await callHandler({ media_url: newUrl, scheduled_at: future });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).media_replaced).toBe(true);
    const postUpdate = ownedUpdates.find((u) => u.table === 'scheduled_posts');
    expect(postUpdate?.payload.scheduled_for).toBe(future);
    expect(postUpdate?.payload.media_urls).toEqual([newUrl]);
  });

  test('validation failure on replace-media: row → upload_failed, scheduled_post NOT updated', async () => {
    setScheduledRow();
    mockValidatorReturn = { valid: false, errors: ['simulated failure'], validated_at: 'now', details: {} } as any;
    const newUrl = 'https://cdn.example.test/dead.mp4';
    const res = await callHandler({ media_url: newUrl });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(false);
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('upload_failed');
    // scheduled_posts must NOT have been updated on validation failure
    expect(ownedUpdates.find((u) => u.table === 'scheduled_posts')).toBeUndefined();
  });

  test('concurrency conflict: expected_revision mismatch → 409, no DB writes', async () => {
    setScheduledRow({ revision: 4 });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await callHandler({ scheduled_at: future, expected_revision: 2 });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('CONCURRENT_UPLOAD_CONFLICT');
    expect((res.body as any).expected_revision).toBe(2);
    expect((res.body as any).actual_revision).toBe(4);
    expect(ownedUpdates).toHaveLength(0);
  });

  test('retime triggers queue cancel + re-enqueue with the new scheduled_for', async () => {
    setScheduledRow();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await callHandler({ scheduled_at: future });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).queue).toBe('re_enqueued');
    expect(queueCalls.cancel).toHaveLength(1);
    expect(queueCalls.cancel[0]).toMatchObject({ id: 'sp-1' });
    expect(queueCalls.cancel[0].reason).toMatch(/reschedule_retime/);
    expect(queueCalls.enqueue).toHaveLength(1);
    expect(queueCalls.enqueue[0]).toMatchObject({ id: 'sp-1', userId: 'user-1', socialAccountId: 'sa-1', scheduledFor: future });
  });

  test('replace-media-only does NOT touch the queue (same scheduled_for kept)', async () => {
    setScheduledRow();
    const newUrl = 'https://supabase.test/storage/v1/object/public/media-uploads/x/new.mp4';
    const res = await callHandler({ media_url: newUrl });
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).queue).toBe('unchanged');
    expect(queueCalls.cancel).toHaveLength(0);
    expect(queueCalls.enqueue).toHaveLength(0);
  });

  test('FK column updated on daily_content_plans when reschedule completes', async () => {
    setScheduledRow();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await callHandler({ scheduled_at: future });
    // Last daily_content_plans update should include the scheduled_post_id column
    const updatesWithFk = ownedUpdates.filter((u) => u.table === 'daily_content_plans' && u.payload.scheduled_post_id === 'sp-1');
    expect(updatesWithFk.length).toBeGreaterThan(0);
  });

  test('non-POST method rejected with 405', async () => {
    const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/reschedule');
    const req: any = { method: 'GET', headers: {}, query: { id: 'plan-1' }, body: {} };
    const res = makeAssertable(createRes()) as any;
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

// PB-010: mark this suite as a MODULE for tsc.
// Without a top-level import/export, tsc treats the file as a global script, so
// its top-level `const`/`function` declarations collide with identically named
// declarations in sibling suites (TS2451/TS2393). Jest already loads every test
// file as its own CommonJS module, so this is a type-visibility fix only and
// changes no runtime behaviour.
export {};
