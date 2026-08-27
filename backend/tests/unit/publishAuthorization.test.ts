/**
 * R2-IMPL B1 — per-post publish authorization (PURE).
 *
 * Locks the governance change: publication is authorized by facts about the
 * POST, not by campaign-global planning completeness. The decisive property is
 * that a released post publishes while its unreleased sibling weeks do not —
 * previously impossible, because `campaign_readiness.readiness_state='ready'`
 * demanded the ENTIRE campaign be planned and scheduled.
 */

import {
  authorizePostPublish,
  isPostPublishAuthorized,
  RELEASABLE_POST_STATUSES,
  type PublishAuthorizationFacts,
} from '../../../lib/campaign/publishAuthorization';

const released = (over: Partial<PublishAuthorizationFacts> = {}): PublishAuthorizationFacts => ({
  campaign_id: 'camp-1',
  campaign_status: 'active',
  post_status: 'scheduled',
  platform_post_id: null,
  has_content: true,
  ...over,
});

describe('campaign gate (unchanged by B1)', () => {
  it('authorizes a released post on an ACTIVE campaign', () => {
    const r = authorizePostPublish(released());
    expect(r.authorized).toBe(true);
    expect(r.code).toBe('AUTHORIZED');
  });

  it('blocks when the campaign is not active', () => {
    for (const status of ['planning', 'draft', 'paused', 'completed', 'archived', '', null]) {
      const r = authorizePostPublish(released({ campaign_status: status }));
      expect(r.authorized).toBe(false);
      expect(r.code).toBe('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
    }
  });

  it('blocks when the campaign row was unreadable (status null ⇒ not active)', () => {
    expect(authorizePostPublish(released({ campaign_status: null })).code)
      .toBe('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
  });

  it('is case/whitespace tolerant on campaign status', () => {
    expect(authorizePostPublish(released({ campaign_status: ' ACTIVE ' })).authorized).toBe(true);
  });

  it('a standalone post (no campaign) is not subject to the campaign gate', () => {
    const r = authorizePostPublish({ campaign_id: null, post_status: 'scheduled', has_content: true });
    expect(r.authorized).toBe(true);
  });
});

describe('release gate — THE replacement for campaign-global readiness', () => {
  it('releasable statuses are exactly scheduled | publishing | failed', () => {
    expect([...RELEASABLE_POST_STATUSES].sort()).toEqual(['failed', 'publishing', 'scheduled']);
  });

  it('blocks a post that was never released (draft — the column default)', () => {
    const r = authorizePostPublish(released({ post_status: 'draft' }));
    expect(r.authorized).toBe(false);
    expect(r.code).toBe('PUBLISH_BLOCKED_POST_NOT_RELEASED');
    expect(r.reason).toMatch(/draft/);
  });

  it('blocks pending, cancelled, unknown and absent statuses', () => {
    for (const s of ['pending', 'cancelled', 'weird', '', null, undefined]) {
      expect(authorizePostPublish(released({ post_status: s })).code)
        .toBe('PUBLISH_BLOCKED_POST_NOT_RELEASED');
    }
  });

  it('allows `failed` so BullMQ retries are not rejected', () => {
    expect(authorizePostPublish(released({ post_status: 'failed' })).authorized).toBe(true);
  });

  it('allows `publishing` (attempt in flight)', () => {
    expect(authorizePostPublish(released({ post_status: 'publishing' })).authorized).toBe(true);
  });
});

describe('idempotency', () => {
  it('an already-published post is skipped, flagged, and NOT a failure', () => {
    const r = authorizePostPublish(released({ platform_post_id: 'urn:li:share:1' }));
    expect(r.authorized).toBe(false);
    expect(r.code).toBe('PUBLISH_ALREADY_PUBLISHED');
    expect(r.already_published).toBe(true);
  });

  it('a THREAD ROOT with a platform_post_id still proceeds (children may be pending)', () => {
    const r = authorizePostPublish(released({ platform_post_id: 'urn:li:share:1', is_thread_start: true }));
    expect(r.authorized).toBe(true);
  });

  it('an inactive campaign outranks already-published (most-terminal first)', () => {
    const r = authorizePostPublish(released({ campaign_status: 'planning', platform_post_id: 'x' }));
    expect(r.code).toBe('PUBLISH_BLOCKED_CAMPAIGN_NOT_ACTIVE');
  });
});

describe('content presence', () => {
  it('blocks an empty post', () => {
    expect(authorizePostPublish(released({ has_content: false })).code)
      .toBe('PUBLISH_BLOCKED_POST_NO_CONTENT');
  });

  it('does not evaluate content when the caller omits the fact', () => {
    expect(authorizePostPublish({ campaign_id: null, post_status: 'scheduled' }).authorized).toBe(true);
  });
});

describe('PARTIAL RELEASE — the core acceptance criterion (AC2/AC3/AC4)', () => {
  /**
   * Six-week campaign. Weeks 1-2 released (approved → scheduled). Weeks 3-6
   * still planning, so the release seam never scheduled them and they have
   * either no scheduled_posts row at all or a draft one.
   *
   * campaign_readiness would be `partial` here (C5 = 2/6). Under the old gate
   * that blocked EVERYTHING. It must now block only the unreleased weeks.
   */
  const CAMPAIGN = { campaign_id: 'camp-6wk', campaign_status: 'active', has_content: true };

  const week = (n: number, post_status: string | null) =>
    authorizePostPublish({ ...CAMPAIGN, post_status });

  it('Week 1 (released) → publishable', () => {
    expect(week(1, 'scheduled').authorized).toBe(true);
  });

  it('Week 2 (released) → publishable', () => {
    expect(week(2, 'scheduled').authorized).toBe(true);
  });

  it('Weeks 3-6 (unreleased) → NOT publishable', () => {
    // Week 3 has a draft row; weeks 4-6 have no row at all (status absent).
    expect(week(3, 'draft').authorized).toBe(false);
    for (const n of [4, 5, 6]) expect(week(n, null).authorized).toBe(false);
  });

  it('the released weeks are NOT blocked by the unreleased ones', () => {
    // The predicate takes no campaign-wide completeness input at all — proven
    // structurally: no field in the fact set describes other weeks.
    const facts = Object.keys(released());
    expect(facts).not.toContain('readiness_state');
    expect(facts).not.toContain('campaign_readiness');
    expect(week(1, 'scheduled').authorized).toBe(true);
  });
});

describe('half-planned campaign safety (AC5 / §9)', () => {
  it('an ACTIVE campaign does NOT mean "publish everything"', () => {
    const active = { campaign_id: 'c', campaign_status: 'active', has_content: true };
    // Every non-released shape stays blocked despite the active campaign.
    for (const s of ['draft', 'pending', 'cancelled', null, undefined, '']) {
      expect(authorizePostPublish({ ...active, post_status: s }).authorized).toBe(false);
    }
    // Empty content stays blocked too.
    expect(authorizePostPublish({ ...active, post_status: 'scheduled', has_content: false }).authorized).toBe(false);
  });
});

describe('determinism + convenience wrapper', () => {
  it('same facts → same verdict', () => {
    expect(authorizePostPublish(released())).toEqual(authorizePostPublish(released()));
  });

  it('isPostPublishAuthorized mirrors authorizePostPublish', () => {
    expect(isPostPublishAuthorized(released())).toBe(true);
    expect(isPostPublishAuthorized(released({ post_status: 'draft' }))).toBe(false);
  });
});
