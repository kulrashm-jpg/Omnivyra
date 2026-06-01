/**
 * Regression tests for the unified calendar feed
 * (pages/api/calendar/activity-events.ts) — the SINGLE source of truth that
 * BOTH the dashboard calendar (useDashboardState) and the per-campaign
 * calendar (useCampaignCalendar) read.
 *
 * Validates feed convergence:
 *   - scheduled creator rows surface (with the user-selected asset_type).
 *   - pending video rows surface as WAITING_FOR_ASSET with daily_plan_id +
 *     execution_id + scheduled_for (the upload deep-link payload).
 *   - autonomous render_ready rows are NEVER emitted as pending (image/
 *     carousel/infographic don't show "Awaiting Video Upload").
 *   - feed consistency: no row appears both pending and scheduled.
 *   - the same feed narrows correctly by campaignId (campaign-calendar use).
 */

// ── Canned DB responses, keyed by query shape ──
const scheduledImagePost = {
  id: 'sp-1',
  campaign_id: 'camp-1',
  platform: 'instagram',
  title: 'Launch visual',
  content: 'AI launch visual caption',
  scheduled_for: '2099-06-15T09:00:00.000Z',
  repurpose_index: 1,
  repurpose_total: 1,
  content_type: 'feed_post', // platform-native
  repurpose_parent_execution_id: 'exec-img',
  status: 'scheduled',
  media_urls: ['https://cdn.test/img.png'],
  media_types: ['image'],
};

const videoPendingRow = {
  id: 'plan-v',
  campaign_id: 'camp-1',
  platform: 'instagram',
  content_type: 'reel',
  content_status: 'awaiting_media_upload',
  content: {
    creator_lifecycle_state: 'awaiting_media_upload',
    theme_treatment: { summary: 'Reel brief', CTA_direction: 'Watch now', hook_scene: { text: 'Open with the pain point' } },
    creator_guidance: { production_notes: 'Shoot vertical', talking_points: ['Point A', 'Point B'] },
    marketing_package: { cta: 'Watch now', caption: 'Reel caption', hashtags: ['#reel'] },
  },
  scheduled_post_id: null,
  title: 'Reel teaser',
  topic: 'Reel topic',
  date: '2099-06-16',
  scheduled_time: '10:30',
  execution_id: 'exec-v',
};

const autonomousRenderReadyRow = {
  id: 'plan-img',
  campaign_id: 'camp-1',
  platform: 'instagram',
  content_type: 'image',
  content_status: 'render_ready',
  content: { creator_lifecycle_state: 'render_ready' },
  scheduled_post_id: null,
  title: 'Rendered image',
  topic: 'Image topic',
  date: '2099-06-17',
  scheduled_time: '09:00',
  execution_id: 'exec-img2',
};

jest.mock('../../db/supabaseClient', () => {
  const responses: Record<string, { data: any; error: any }> = {
    campaign_versions: { data: [{ campaign_id: 'camp-1' }], error: null },
    user_company_roles: { data: [{ user_id: 'user-1' }], error: null },
    scheduled_posts_campaign: { data: [scheduledImagePost], error: null },
    scheduled_posts_standalone: { data: [], error: null },
    daily_content_plans_assettype: { data: [{ scheduled_post_id: 'sp-1', content_type: 'image' }], error: null },
    daily_content_plans_pending: { data: [videoPendingRow, autonomousRenderReadyRow], error: null },
  };
  return {
    supabase: {
      from: (table: string) => {
        const ctx = { table, isScheduledPostNull: false, hasUserIn: false };
        const resolveFor = () => {
          if (table === 'campaign_versions') return responses.campaign_versions;
          if (table === 'user_company_roles') return responses.user_company_roles;
          if (table === 'scheduled_posts') return ctx.hasUserIn ? responses.scheduled_posts_standalone : responses.scheduled_posts_campaign;
          if (table === 'daily_content_plans') return ctx.isScheduledPostNull ? responses.daily_content_plans_pending : responses.daily_content_plans_assettype;
          return { data: [], error: null };
        };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          in: (col: string) => { if (col === 'user_id') ctx.hasUserIn = true; return builder; },
          is: (col: string, val: any) => { if (col === 'scheduled_post_id' && val === null) ctx.isScheduledPostNull = true; return builder; },
          gte: () => builder,
          lte: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (resolve: any, reject: any) => Promise.resolve(resolveFor()).then(resolve, reject),
        };
        return builder;
      },
    },
  };
});

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: jest.fn(async () => ({ userId: 'user-1' })),
}));

import handler from '../../../pages/api/calendar/activity-events';
import { CanonicalContentState } from '../../../lib/shared/contentLifecycle';

function createRes() {
  return {
    statusCode: 200,
    body: null as any,
    status: jest.fn(function status(this: any, code: number) { this.statusCode = code; return this; }),
    json: jest.fn(function json(this: any, body: unknown) { this.body = body; return this; }),
    setHeader: jest.fn(),
  };
}

async function callFeed(query: Record<string, string>) {
  const req: any = { method: 'GET', query: { companyId: 'company-1', start: '2099-01-01', end: '2099-12-31', ...query } };
  const res = createRes() as any;
  await handler(req, res);
  return res;
}

describe('calendar activity-events — unified feed', () => {
  test('scheduled creator row surfaces with user-selected asset_type', async () => {
    const res = await callFeed({});
    expect(res.statusCode).toBe(200);
    const events = res.body as any[];
    const scheduled = events.find((e) => e.scheduled_post_id === 'sp-1');
    expect(scheduled).toBeTruthy();
    expect(scheduled.asset_type).toBe('image'); // recovered from daily_content_plans
    expect(scheduled.canonical_state).toBe(CanonicalContentState.SCHEDULED);
    expect(scheduled.pending).toBe(false);
  });

  test('pending video row surfaces as WAITING_FOR_ASSET with upload deep-link payload', async () => {
    const res = await callFeed({});
    const events = res.body as any[];
    const pending = events.find((e) => e.daily_plan_id === 'plan-v');
    expect(pending).toBeTruthy();
    expect(pending.pending).toBe(true);
    expect(pending.canonical_state).toBe(CanonicalContentState.PENDING_CREATOR);
    expect(pending.content_type).toBe('reel');
    expect(pending.execution_id).toBe('exec-v'); // workspace deep-link
    expect(pending.scheduled_for).toBeTruthy();   // card shows a time
    expect(pending.scheduled_post_id).toBeNull();
  });

  test('pending video row carries the structured VIDEO CREATION BRIEF inline', async () => {
    const res = await callFeed({});
    const events = res.body as any[];
    const pending = events.find((e) => e.daily_plan_id === 'plan-v');
    expect(pending.theme_treatment).toMatchObject({ hook_scene: { text: 'Open with the pain point' } });
    expect(pending.creator_guidance).toMatchObject({ talking_points: ['Point A', 'Point B'] });
    expect(pending.marketing_package).toMatchObject({ caption: 'Reel caption', hashtags: ['#reel'] });
  });

  test('AI scheduled row does NOT carry creator brief blocks (drawer never shows a brief for AI assets)', async () => {
    const res = await callFeed({});
    const events = res.body as any[];
    const scheduled = events.find((e) => e.scheduled_post_id === 'sp-1');
    expect(scheduled.theme_treatment).toBeUndefined();
    expect(scheduled.creator_guidance).toBeUndefined();
    expect(scheduled.marketing_package).toBeUndefined();
  });

  test('autonomous render_ready row is NEVER emitted as pending', async () => {
    const res = await callFeed({});
    const events = res.body as any[];
    // The image render_ready row (no scheduled_post yet) must not appear in the
    // pending feed and has no scheduled_posts row → absent entirely.
    expect(events.some((e) => e.daily_plan_id === 'plan-img')).toBe(false);
    expect(events.some((e) => e.pending === true && e.content_type === 'image')).toBe(false);
  });

  test('feed consistency: no row is both pending and scheduled', async () => {
    const res = await callFeed({});
    const events = res.body as any[];
    for (const e of events) {
      if (e.pending === true) expect(e.scheduled_post_id).toBeNull();
      if (e.scheduled_post_id) expect(e.pending).toBe(false);
    }
  });

  test('same feed serves the per-campaign calendar (campaignId filter)', async () => {
    const res = await callFeed({ campaignId: 'camp-1' });
    const events = res.body as any[];
    // Both the scheduled creator row and the pending video row are scoped to
    // camp-1 — the per-campaign calendar reads the identical feed.
    expect(events.find((e) => e.scheduled_post_id === 'sp-1')).toBeTruthy();
    expect(events.find((e) => e.daily_plan_id === 'plan-v')).toBeTruthy();
    expect(events.every((e) => e.campaign_id === 'camp-1')).toBe(true);
  });
});
