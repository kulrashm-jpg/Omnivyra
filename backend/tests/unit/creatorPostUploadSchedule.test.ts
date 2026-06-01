/**
 * Tests for creator post-upload auto-scheduling
 * (backend/services/creator/creatorRowScheduler.ts).
 *
 *   - scheduleCreatorAttachmentPost: happy path inserts ONE scheduled_posts
 *     row with a deterministic idempotency_key, enqueues, flips lifecycle to
 *     'scheduled', and writes scheduled_post_id (calendar sync key).
 *   - duplicate protection: already-scheduled short-circuit (no insert) +
 *     23505 idempotency collision recovery (no duplicate).
 *   - autoScheduleReadyCreatorRowById: end-to-end on a ready row; skips
 *     non-attachment (autonomous) rows; skips when no social account; skips
 *     when the row isn't eligible — never throwing, never inserting on skip.
 */

const captured = {
  inserts: [] as Array<{ table: string; payload: Record<string, any> }>,
  updates: [] as Array<{ table: string; payload: Record<string, any> }>,
};

type DbState = {
  daily_content_plans_row: any;
  campaign_row: any;
  company_user_row: any;
  social_accounts_rows: any[];
  scheduled_posts_insert: { data: any; error: any };
  scheduled_posts_existing: { data: any; error: any };
};

let dbState: DbState;

function resetDbState() {
  dbState = {
    daily_content_plans_row: null,
    campaign_row: { id: 'campaign-1', user_id: 'user-1', company_id: 'company-1' },
    company_user_row: { user_id: 'user-1' },
    social_accounts_rows: [{ id: 'acc-1', platform: 'instagram' }],
    scheduled_posts_insert: { data: { id: 'sp-1' }, error: null },
    scheduled_posts_existing: { data: { id: 'sp-existing' }, error: null },
  };
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn((table: string) => {
    let mode: 'select' | 'insert' | 'update' | null = null;
    let insertPayload: Record<string, any> | null = null;
    let updatePayload: Record<string, any> | null = null;

    const resolveResult = () => {
      if (mode === 'insert') {
        captured.inserts.push({ table, payload: insertPayload! });
        return dbState.scheduled_posts_insert;
      }
      if (mode === 'update') {
        captured.updates.push({ table, payload: updatePayload! });
        return { data: null, error: null };
      }
      // select
      if (table === 'daily_content_plans') return { data: dbState.daily_content_plans_row, error: null };
      if (table === 'campaigns') return { data: dbState.campaign_row, error: null };
      if (table === 'user_company_roles') return { data: dbState.company_user_row, error: null };
      if (table === 'social_accounts') return { data: dbState.social_accounts_rows, error: null };
      if (table === 'scheduled_posts') return dbState.scheduled_posts_existing;
      return { data: null, error: null };
    };

    const api: any = {
      select: jest.fn((_cols?: string) => { if (mode === null) mode = 'select'; return api; }),
      insert: jest.fn((p: Record<string, any>) => { mode = 'insert'; insertPayload = p; return api; }),
      update: jest.fn((p: Record<string, any>) => { mode = 'update'; updatePayload = p; return api; }),
      eq: jest.fn(() => api),
      or: jest.fn(() => api),
      is: jest.fn(() => api),
      limit: jest.fn(() => api),
      maybeSingle: jest.fn(async () => resolveResult()),
      then: (resolve: any, reject: any) => Promise.resolve(resolveResult()).then(resolve, reject),
    };
    return api;
  }),
}));

const enqueueMock = jest.fn(async () => 'enqueued');
jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: (...args: any[]) => enqueueMock(...args),
}));

jest.mock('../../services/platformIntelligenceService', () => ({
  listPlatformCatalog: jest.fn(async () => ({ platforms: [{ canonical_key: 'instagram' }, { canonical_key: 'linkedin' }] })),
  getPlatformRules: jest.fn(async () => ({ content_rules: [] })),
}));

import {
  scheduleCreatorAttachmentPost,
  autoScheduleReadyCreatorRowById,
} from '../../services/creator/creatorRowScheduler';

const READY_CONTENT = {
  creator_lifecycle_state: 'ready_for_schedule',
  creator_lifecycle_history: [{ to: 'awaiting_media_upload' }, { to: 'media_uploaded' }, { to: 'ready_for_schedule' }],
  uploaded_media_url: 'https://cdn.test/clip.mp4',
  upload_validation: { valid: true },
  marketing_package: { caption: 'Launch teaser', hashtags: ['#launch', '#omnivyra'] },
};

const ROW = {
  id: 'plan-1',
  campaign_id: 'campaign-1',
  date: '2099-01-15',
  scheduled_time: '09:00',
  topic: 'Product launch',
  title: 'Launch',
  content_type: 'reel',
};

beforeEach(() => {
  jest.clearAllMocks();
  captured.inserts.length = 0;
  captured.updates.length = 0;
  resetDbState();
});

describe('scheduleCreatorAttachmentPost (shared core)', () => {
  test('happy path: one insert with idempotency_key, enqueue, lifecycle → scheduled', async () => {
    const result = await scheduleCreatorAttachmentPost({
      row: ROW,
      attachedContent: { ...READY_CONTENT },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'reel',
    });

    expect(result.status).toBe('scheduled');
    expect(result.scheduledPostId).toBe('sp-1');

    const inserts = captured.inserts.filter((i) => i.table === 'scheduled_posts');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload.idempotency_key).toBe('creator-upload:plan-1');
    expect(inserts[0].payload.status).toBe('scheduled');
    expect(inserts[0].payload.media_urls).toEqual(['https://cdn.test/clip.mp4']);
    expect(inserts[0].payload.content).toBe('Launch teaser');

    expect(enqueueMock).toHaveBeenCalledTimes(1);

    const planUpdate = captured.updates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('scheduled');
    expect(planUpdate?.payload.scheduled_post_id).toBe('sp-1'); // calendar sync key
    expect(JSON.parse(planUpdate!.payload.content).scheduled_post_id).toBe('sp-1');
  });

  test('duplicate protection: already-scheduled row short-circuits (no insert)', async () => {
    const result = await scheduleCreatorAttachmentPost({
      row: ROW,
      attachedContent: { ...READY_CONTENT, creator_lifecycle_state: 'scheduled', scheduled_post_id: 'sp-prev' },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'reel',
    });

    expect(result.status).toBe('already_scheduled');
    expect(result.scheduledPostId).toBe('sp-prev');
    expect(captured.inserts.filter((i) => i.table === 'scheduled_posts')).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  test('idempotency collision (23505) recovers existing post, no duplicate', async () => {
    dbState.scheduled_posts_insert = { data: null, error: { code: '23505', message: 'duplicate key value violates uidx_scheduled_posts_idempotency_key' } };

    const result = await scheduleCreatorAttachmentPost({
      row: ROW,
      attachedContent: { ...READY_CONTENT },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'reel',
    });

    expect(result.status).toBe('scheduled');
    expect(result.scheduledPostId).toBe('sp-existing'); // recovered, not duplicated
    // The lifecycle still flips to scheduled, pointing at the recovered post.
    const planUpdate = captured.updates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.scheduled_post_id).toBe('sp-existing');
  });

  test('transient insert error leaves row at ready_for_schedule', async () => {
    dbState.scheduled_posts_insert = { data: null, error: { code: '500', message: 'db down' } };

    const result = await scheduleCreatorAttachmentPost({
      row: ROW,
      attachedContent: { ...READY_CONTENT },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'reel',
    });

    expect(result.status).toBe('error');
    const planUpdate = captured.updates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('ready_for_schedule');
    expect(planUpdate?.payload.failure_type).toBe('transient');
  });
});

describe('autoScheduleReadyCreatorRowById (post-upload entry point)', () => {
  test('ready attachment row schedules end-to-end', async () => {
    dbState.daily_content_plans_row = {
      id: 'plan-1',
      campaign_id: 'campaign-1',
      date: '2099-01-15',
      scheduled_time: '09:00',
      platform: 'instagram',
      content_type: 'reel',
      title: 'Launch',
      topic: 'Product launch',
      content: { ...READY_CONTENT },
      content_status: 'ready_for_schedule',
    };

    const result = await autoScheduleReadyCreatorRowById('plan-1');
    expect(result.status).toBe('scheduled');
    expect(result.scheduledPostId).toBe('sp-1');
    expect(captured.inserts.filter((i) => i.table === 'scheduled_posts')).toHaveLength(1);
  });

  test('autonomous row (image) is skipped, never inserted', async () => {
    dbState.daily_content_plans_row = {
      id: 'plan-2', campaign_id: 'campaign-1', date: '2099-01-15', scheduled_time: '09:00',
      platform: 'instagram', content_type: 'image',
      content: { creator_lifecycle_state: 'render_ready' }, content_status: 'render_ready',
    };
    const result = await autoScheduleReadyCreatorRowById('plan-2');
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not_attachment_format');
    expect(captured.inserts).toHaveLength(0);
  });

  test('not-yet-uploaded row is skipped (eligibility gate), no insert', async () => {
    dbState.daily_content_plans_row = {
      id: 'plan-3', campaign_id: 'campaign-1', date: '2099-01-15', scheduled_time: '09:00',
      platform: 'instagram', content_type: 'reel',
      content: { creator_lifecycle_state: 'awaiting_media_upload' }, content_status: 'awaiting_media_upload',
    };
    const result = await autoScheduleReadyCreatorRowById('plan-3');
    expect(result.status).toBe('skipped');
    expect(captured.inserts).toHaveLength(0);
  });

  test('no connected social account → skipped, row stays ready, no insert', async () => {
    dbState.social_accounts_rows = [];
    dbState.daily_content_plans_row = {
      id: 'plan-4', campaign_id: 'campaign-1', date: '2099-01-15', scheduled_time: '09:00',
      platform: 'instagram', content_type: 'reel',
      content: { ...READY_CONTENT }, content_status: 'ready_for_schedule',
    };
    const result = await autoScheduleReadyCreatorRowById('plan-4');
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_social_account');
    expect(captured.inserts).toHaveLength(0);
  });
});
