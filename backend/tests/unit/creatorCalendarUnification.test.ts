/**
 * Tests for creator calendar unification — autonomous auto-schedule on
 * render completion (backend/services/creator/creatorRowScheduler.ts).
 *
 *   - scheduleRenderedAutonomousPost: image/carousel/infographic whose asset
 *     has rendered get ONE scheduled_posts row with a deterministic
 *     `creator-render:<id>` idempotency_key, media from rendered_asset.urls,
 *     lifecycle render_ready → scheduled, scheduled_post_id back-pointer set.
 *   - duplicate protection: already-scheduled short-circuit + no-media skip.
 *   - scheduleRenderedAutonomousRowById: end-to-end on a render_ready
 *     autonomous row; skips video (attachment) rows; skips not-ready rows.
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

type EnqueueArgs = Parameters<typeof import('../../scheduler/schedulerService')['enqueueScheduledPostAt']>;
const enqueueMock = jest.fn(async (..._a: EnqueueArgs) => 'enqueued');
jest.mock('../../scheduler/schedulerService', () => ({
  enqueueScheduledPostAt: (...args: EnqueueArgs) => enqueueMock(...args),
}));

jest.mock('../../services/platformIntelligenceService', () => ({
  listPlatformCatalog: jest.fn(async () => ({ platforms: [{ canonical_key: 'instagram' }, { canonical_key: 'linkedin' }] })),
  getPlatformRules: jest.fn(async () => ({ content_rules: [] })),
}));

import {
  scheduleRenderedAutonomousPost,
  scheduleRenderedAutonomousRowById,
} from '../../services/creator/creatorRowScheduler';

const RENDERED_CONTENT = {
  creator_lifecycle_state: 'render_ready',
  creator_lifecycle_history: [{ to: 'render_ready' }],
  rendered_asset: { urls: ['https://cdn.test/image.png'], export_ready: true },
  marketing_package: { caption: 'AI launch visual', hashtags: ['#ai', '#omnivyra'] },
};

const ROW = {
  id: 'plan-1',
  campaign_id: 'campaign-1',
  date: '2099-01-15',
  scheduled_time: '09:00',
  topic: 'Product launch',
  title: 'Launch',
  content_type: 'image',
};

beforeEach(() => {
  jest.clearAllMocks();
  captured.inserts.length = 0;
  captured.updates.length = 0;
  resetDbState();
});

describe('scheduleRenderedAutonomousPost (autonomous core)', () => {
  test('render_ready image → one insert (creator-render key, rendered media), lifecycle scheduled', async () => {
    const result = await scheduleRenderedAutonomousPost({
      row: ROW,
      attachedContent: { ...RENDERED_CONTENT },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'feed_post',
    });

    expect(result.status).toBe('scheduled');
    expect(result.scheduledPostId).toBe('sp-1');

    const inserts = captured.inserts.filter((i) => i.table === 'scheduled_posts');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload.idempotency_key).toBe('creator-render:plan-1');
    expect(inserts[0].payload.media_urls).toEqual(['https://cdn.test/image.png']);
    expect(inserts[0].payload.status).toBe('scheduled');

    expect(enqueueMock).toHaveBeenCalledTimes(1);

    const planUpdate = captured.updates.find((u) => u.table === 'daily_content_plans');
    expect(planUpdate?.payload.content_status).toBe('scheduled');
    expect(planUpdate?.payload.scheduled_post_id).toBe('sp-1'); // calendar key
  });

  test('no rendered media → skipped, no insert', async () => {
    const result = await scheduleRenderedAutonomousPost({
      row: ROW,
      attachedContent: { ...RENDERED_CONTENT, rendered_asset: { urls: [] } },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'feed_post',
    });
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no_rendered_media');
    expect(captured.inserts).toHaveLength(0);
  });

  test('already-scheduled row short-circuits (no insert)', async () => {
    const result = await scheduleRenderedAutonomousPost({
      row: ROW,
      attachedContent: { ...RENDERED_CONTENT, creator_lifecycle_state: 'scheduled', scheduled_post_id: 'sp-prev' },
      userId: 'user-1',
      campaignId: 'campaign-1',
      platform: 'instagram',
      socialAccountId: 'acc-1',
      dbPlatform: 'instagram',
      dbContentType: 'feed_post',
    });
    expect(result.status).toBe('already_scheduled');
    expect(result.scheduledPostId).toBe('sp-prev');
    expect(captured.inserts).toHaveLength(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('scheduleRenderedAutonomousRowById (render-complete entry point)', () => {
  test('render_ready autonomous row schedules end-to-end', async () => {
    dbState.daily_content_plans_row = {
      id: 'plan-1', campaign_id: 'campaign-1', date: '2099-01-15', scheduled_time: '09:00',
      platform: 'instagram', content_type: 'carousel', title: 'Launch', topic: 'Product launch',
      content: { ...RENDERED_CONTENT }, content_status: 'render_ready',
    };
    const result = await scheduleRenderedAutonomousRowById('plan-1');
    expect(result.status).toBe('scheduled');
    expect(result.scheduledPostId).toBe('sp-1');
    expect(captured.inserts.filter((i) => i.table === 'scheduled_posts')).toHaveLength(1);
  });

  test('video (attachment) row is skipped, never inserted', async () => {
    dbState.daily_content_plans_row = {
      id: 'plan-2', campaign_id: 'campaign-1', date: '2099-01-15', scheduled_time: '09:00',
      platform: 'instagram', content_type: 'reel',
      content: { creator_lifecycle_state: 'awaiting_media_upload' }, content_status: 'awaiting_media_upload',
    };
    const result = await scheduleRenderedAutonomousRowById('plan-2');
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('not_autonomous_format');
    expect(captured.inserts).toHaveLength(0);
  });

  test('not-yet-rendered autonomous row is skipped (eligibility), no insert', async () => {
    dbState.daily_content_plans_row = {
      id: 'plan-3', campaign_id: 'campaign-1', date: '2099-01-15', scheduled_time: '09:00',
      platform: 'instagram', content_type: 'image',
      content: { creator_lifecycle_state: 'render_failed' }, content_status: 'render_failed',
    };
    const result = await scheduleRenderedAutonomousRowById('plan-3');
    expect(result.status).toBe('skipped');
    expect(captured.inserts).toHaveLength(0);
  });
});
