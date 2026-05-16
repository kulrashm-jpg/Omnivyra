/**
 * Tests for /api/activity-workspace/[id]/unschedule.
 *
 *   - happy path: scheduled → upload_failed; queue cancelled; scheduled_posts cancelled
 *   - 409 if row not in scheduled state
 *   - 409 for non-attachment-required format
 *   - concurrency conflict → 409
 *   - uploaded_media_url / theme_treatment / creator_guidance preserved on row
 */

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

const ownedUpdates: Array<{ table: string; payload: Record<string, any> }> = [];
let supabaseRows: Record<string, unknown> = {};
const queueCancelCalls: Array<{ id: string; reason?: string }> = [];

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      const filters: Record<string, any> = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        maybeSingle: jest.fn(async () => ({ data: supabaseRows[`${table}:single`] ?? null, error: null })),
      };
      return api;
    }),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let updatePayload: Record<string, any> | null = null;
    const api: any = {
      update: jest.fn((p: Record<string, any>) => { updatePayload = p; return api; }),
      eq: jest.fn(() => api),
      then(resolve: any) {
        if (updatePayload) ownedUpdates.push({ table, payload: updatePayload });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1', companyId: 'company-1' })),
}));

jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async (id: string, options: any) => {
    queueCancelCalls.push({ id, reason: options?.reason });
    return { db_cancelled: 1, queue_removed: 1, errors: [] };
  }),
  enqueueScheduledPostAt: jest.fn(),
  tryAcquireScheduledPostQueueLock: jest.fn(async () => ({ acquired: true, release: async () => undefined, mode: 'advisory' })),
}));

function setRow(opts: {
  lifecycle?: string;
  contentType?: string;
  scheduledPostId?: string | null;
  revisionLength?: number;
  preservedFields?: Record<string, unknown>;
}) {
  const history = Array.from({ length: opts.revisionLength ?? 4 }, (_, i) => ({ to: `state-${i}` }));
  supabaseRows = {
    'daily_content_plans:single': {
      id: 'plan-1',
      campaign_id: 'campaign-1',
      content_type: opts.contentType ?? 'reel',
      content: {
        creator_lifecycle_state: opts.lifecycle ?? 'scheduled',
        scheduled_post_id: opts.scheduledPostId === undefined ? 'sp-1' : opts.scheduledPostId,
        uploaded_media_url: 'https://supabase.test/storage/v1/object/public/media-uploads/x/y.mp4',
        theme_treatment: { hook_scene: { text: 'hook' } },
        creator_guidance: { production_notes: 'note' },
        marketing_package: { caption: 'caption', hashtags: ['#tag'] },
        creator_lifecycle_history: history,
        ...(opts.preservedFields ?? {}),
      },
      content_status: opts.lifecycle ?? 'scheduled',
      platform: 'instagram',
    },
    'campaigns:single': { company_id: 'company-1' },
  };
}

async function callHandler(body: Record<string, any> = {}, query: Record<string, string> = { id: 'plan-1' }) {
  const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/unschedule');
  const req: any = { method: 'POST', query, body };
  const res = createRes() as any;
  await handler(req, res);
  return res;
}

describe('unschedule API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ownedUpdates.length = 0;
    queueCancelCalls.length = 0;
  });

  test('happy path: scheduled → upload_failed; queue cancelled; uploaded_media_url preserved', async () => {
    setRow({ revisionLength: 4 });
    const res = await callHandler({ reason: 'change of plans' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).to).toBe('upload_failed');
    expect((res.body as any).from).toBe('scheduled');

    // Queue cancel was invoked with the user_unscheduled reason
    expect(queueCancelCalls).toHaveLength(1);
    expect(queueCancelCalls[0].id).toBe('sp-1');
    expect(queueCancelCalls[0].reason).toMatch(/user_unscheduled/);

    // scheduled_posts was marked cancelled
    const postUpdate = ownedUpdates.find((u) => u.table === 'scheduled_posts');
    expect(postUpdate?.payload.status).toBe('cancelled');

    // daily plan row transitioned + preserved uploaded fields
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('upload_failed');
    const updatedContent = JSON.parse(planUpdate!.payload.content);
    expect(updatedContent.creator_lifecycle_state).toBe('upload_failed');
    expect(updatedContent.uploaded_media_url).toBe('https://supabase.test/storage/v1/object/public/media-uploads/x/y.mp4');
    expect(updatedContent.theme_treatment.hook_scene.text).toBe('hook');
    expect(updatedContent.creator_guidance.production_notes).toBe('note');
    expect(updatedContent.marketing_package.caption).toBe('caption');
    expect(updatedContent.unscheduled_at).toBeTruthy();
    expect(updatedContent.unschedule_reason).toBe('change of plans');
    // History entry captures reason
    const lastHistory = (updatedContent.creator_lifecycle_history as Array<Record<string, unknown>>).slice(-1)[0];
    expect(String(lastHistory.reason)).toMatch(/user_unscheduled/);
  });

  test('rejects with 409 when row is not in scheduled state', async () => {
    setRow({ lifecycle: 'awaiting_media_upload' });
    const res = await callHandler();
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('UNSCHEDULE_INVALID_STATE');
    expect(queueCancelCalls).toHaveLength(0);
  });

  test('rejects with 409 for non-attachment-required format', async () => {
    setRow({ contentType: 'infographic', lifecycle: 'render_ready' });
    const res = await callHandler();
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('UNSCHEDULE_NOT_VALID_FOR_FORMAT');
    expect(queueCancelCalls).toHaveLength(0);
  });

  test('concurrency conflict: expected_revision mismatch → 409, no queue cancel, no DB writes', async () => {
    setRow({ revisionLength: 4 });
    const res = await callHandler({ expected_revision: 2 });
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res.body as any).code).toBe('CONCURRENT_UPLOAD_CONFLICT');
    expect(queueCancelCalls).toHaveLength(0);
    expect(ownedUpdates).toHaveLength(0);
  });

  test('row-not-found returns 404', async () => {
    supabaseRows = { 'daily_content_plans:single': null, 'campaigns:single': { company_id: 'company-1' } };
    const res = await callHandler({}, { id: 'missing' });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('handles missing scheduled_post_id gracefully (no queue cancel, row still transitions)', async () => {
    setRow({ scheduledPostId: null });
    const res = await callHandler();
    expect(res.status).toHaveBeenCalledWith(200);
    expect((res.body as any).success).toBe(true);
    expect(queueCancelCalls).toHaveLength(0);
    const planUpdate = ownedUpdates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('upload_failed');
  });

  test('non-POST returns 405', async () => {
    const { default: handler } = await import('../../../pages/api/activity-workspace/[id]/unschedule');
    const req: any = { method: 'GET', query: { id: 'plan-1' }, body: {} };
    const res = createRes() as any;
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
