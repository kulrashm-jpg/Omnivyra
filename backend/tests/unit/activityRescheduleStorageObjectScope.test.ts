/**
 * P1-B — POST /api/activity-workspace/[id]/reschedule must only ever delete a
 * storage object that belongs to the authorized activity, and only when the
 * URL naming it came from a configured storage origin.
 *
 * THE DEFECT: the prior object key was taken from the row's
 * `content.uploaded_media_url`, which is tenant-writable (this route's own
 * `media_url` field writes it; commit-daily-plan stores the content JSON
 * verbatim). `extractStorageObjectPath` accepted every host — it only looked
 * for `/media-uploads/` in the pathname — and the delete ran with no scope
 * check at all, on the service-role client, where storage RLS does not apply.
 * A member of one company could therefore point their own row at another
 * tenant's object URL and have the server delete it.
 *
 * THE INVARIANT under test: an object is deleted ONLY when the caller is
 * authenticated, authorized for the activity's server-derived company, the
 * key matches the authorized activity/company layout (isActivityObjectPath),
 * AND the URL host is a configured storage origin. The path alone never
 * authorizes, and caller-supplied company identity is never used.
 *
 * The real enforceCompanyAccess -> TenantGuard chain runs; only the database,
 * the identity provider, the queue and telemetry are fake. Every storage
 * remove is recorded, so a rejection case can assert ZERO side effects.
 */
import {
  seed, invoke, rows, CO_A, CO_B, CAMPAIGN_A, USER_A,
} from '../helpers/routeAuthHarness';

const mockEvents: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => {
  const h = jest.requireActual('../helpers/routeAuthHarness');
  const supabase = {
    ...h.fakeSupabase,
    from: (t: string) => { mockEvents.push(`db:${t}`); return h.fakeSupabase.from(t); },
    storage: { from: (bucket: string) => ({ remove: jest.fn(async (p: string[]) => { mockEvents.push(`storage:remove:${bucket}:${p.join(',')}`); return { data: null, error: null }; }) }) },
  };
  return { supabase, default: supabase, getSupabase: () => supabase, supabaseAdmin: supabase };
});
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const b = jest.requireActual('../helpers/routeAuthHarness').writeOwnerModule().ownedDbTable(t);
    const update = b.update;
    b.update = (p: unknown) => { mockEvents.push(`db:update:${t}`); return update(p); };
    return b;
  },
}));
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => jest.requireActual('../helpers/routeAuthHarness').identityModule());
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/mediaUploadValidationService', () => ({
  validateMediaUpload: jest.fn(async () => { mockEvents.push('media:validate'); return { valid: true, validated_at: 'now', details: {} }; }),
}));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));
jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async (id: string) => { mockEvents.push(`queue:cancel:${id}`); return { db_cancelled: 1, queue_removed: 1, errors: [] }; }),
  enqueueScheduledPostAt: jest.fn(async (id: string) => { mockEvents.push(`queue:enqueue:${id}`); return 'enqueued'; }),
  atomicCancelAndReEnqueueScheduledPost: jest.fn(async (input: { scheduledPostId: string; userId: string; socialAccountId: string }) => {
    mockEvents.push(`queue:reenqueue:${input.scheduledPostId}:${input.userId}:${input.socialAccountId}`);
    return { ok: true, locked: true, enqueue: 'enqueued', cancel: {}, idempotency_key: 'k' };
  }),
}));

import handler from '../../../pages/api/activity-workspace/[id]/reschedule';

// The route derives its allowed storage origin from the deployment's Supabase
// configuration. Pin it here so the suite is hermetic regardless of the
// caller's environment (placeholder host — never a real project).
const STORAGE_ORIGIN = 'https://placeholder.supabase.co';
process.env.SUPABASE_URL = STORAGE_ORIGIN;
process.env.NEXT_PUBLIC_SUPABASE_URL = STORAGE_ORIGIN;

const PUBLIC_PREFIX = '/storage/v1/object/public/media-uploads/';
const own = (objectKey: string) => `${STORAGE_ORIGIN}${PUBLIC_PREFIX}${objectKey}`;

const PLAN_A = 'plan-a-0-0000-0000-00000000000a';
const OTHER_ACTIVITY = 'plan-z-9-0000-0000-00000000000z';
const POST_A = '0a000000-0000-4000-8000-00000000000a';
const ORIGINAL_AT = '2027-03-10T14:30:00.000Z';
const NEW_AT = '2027-04-02T09:00:00.000Z';
const NEW_MEDIA = own(`${PLAN_A}/video/new.mp4`);

/** The activity's OWN object, in both layouts the upload paths mint. */
const OWN_TUS_KEY = `${PLAN_A}/video/old.mp4`;
const OWN_DIRECT_KEY = `${CO_A}/${PLAN_A}/video/old.mp4`;

function world(priorUploadedUrl: string) {
  seed({
    daily_content_plans: [{
      id: PLAN_A, campaign_id: CAMPAIGN_A, content_type: 'reel', platform: 'instagram', content_status: 'scheduled',
      scheduled_time: '14:30', date: '2027-03-10', execution_id: null, week_number: 1,
      content: { creator_lifecycle_state: 'scheduled', scheduled_post_id: POST_A, uploaded_media_url: priorUploadedUrl },
    }],
    scheduled_posts: [
      { id: POST_A, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-a', status: 'scheduled', scheduled_for: ORIGINAL_AT, media_urls: ['a.mp4'] },
    ],
  });
}

const call = (body: Record<string, unknown>, as: 'A' | 'B' | null = 'A') =>
  invoke(handler as never, { method: 'POST', query: { id: PLAN_A }, body, as });
const removes = () => mockEvents.filter((e) => e.startsWith('storage:remove:'));
const storageSideEffects = () => mockEvents.filter((e) => e.startsWith('storage:'));

beforeEach(() => { mockEvents.length = 0; });

describe('the activity\'s own prior object is still deleted', () => {
  it.each([
    ['TUS layout <activityId>/<subdir>/<file>', OWN_TUS_KEY],
    ['direct layout <companyId>/<activityId>/<subdir>/<file>', OWN_DIRECT_KEY],
  ])('%s -> deleted exactly once', async (_n, key) => {
    world(own(key));
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true });
    expect(removes()).toEqual([`storage:remove:media-uploads:${key}`]);
    expect(rows('daily_content_plans')[0].content).toContain(NEW_MEDIA);
  });

  it('replacing media with the SAME url deletes nothing (unchanged behaviour)', async () => {
    const url = own(OWN_TUS_KEY);
    world(url);
    const r = await call({ media_url: url });
    expect(r.status).toBe(200);
    expect(storageSideEffects()).toEqual([]);
  });
});

describe('objects outside the authorized activity are never deleted', () => {
  const FOREIGN = {
    'another company\'s object (direct layout under company B)': own(`${CO_B}/${OTHER_ACTIVITY}/video/secret.mp4`),
    'another company\'s object naming THIS activity id under company B': own(`${CO_B}/${PLAN_A}/video/secret.mp4`),
    'another activity of the SAME company (direct layout)': own(`${CO_A}/${OTHER_ACTIVITY}/video/secret.mp4`),
    'another activity of the SAME company (TUS layout)': own(`${OTHER_ACTIVITY}/video/secret.mp4`),
    'a bucket-root key belonging to nobody': own('orphan.mp4'),
    'the caller\'s company id used as the activity id': own(`${CO_A}/video/secret.mp4`),
  };

  it.each(Object.entries(FOREIGN))('%s -> NOT deleted, zero storage side effects', async (_n, priorUrl) => {
    world(priorUrl);
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(storageSideEffects()).toEqual([]);
  });
});

describe('the URL host is authorization, not the URL path', () => {
  const HOSTILE = {
    'attacker host carrying a perfectly valid key for THIS activity':
      `https://evil.test${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'attacker host carrying a valid key in the direct layout':
      `https://evil.test${PUBLIC_PREFIX}${OWN_DIRECT_KEY}`,
    'lookalike host that merely ends with the configured hostname':
      `https://placeholder.supabase.co.evil.test${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'lookalike host that merely contains the configured hostname':
      `https://evil.test/placeholder.supabase.co${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'credentials-in-userinfo trick pointing at an attacker host':
      `https://placeholder.supabase.co@evil.test${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'right host, wrong scheme':
      `http://placeholder.supabase.co${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'right host, wrong port':
      `https://placeholder.supabase.co:8443${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
  };

  it.each(Object.entries(HOSTILE))('%s -> NOT deleted, zero storage side effects', async (_n, priorUrl) => {
    world(priorUrl);
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(storageSideEffects()).toEqual([]);
  });
});

describe('unparseable and pathless values fail closed', () => {
  // DECISION: a value that is not an absolute URL is NOT resolved against the
  // storage origin. With no verifiable host there is nothing to authorize, so
  // no object is named and nothing is deleted.
  const MALFORMED = {
    'not a URL at all': 'this is not a url',
    'scheme-only garbage': 'https://',
    'a bare colon-colon string': '::::',
    'a relative path that looks like a public object URL': `${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'a bare object key with no host': OWN_TUS_KEY,
    'a protocol-relative URL on an attacker host': `//evil.test${PUBLIC_PREFIX}${OWN_TUS_KEY}`,
    'a data URL': 'data:text/plain;base64,aGVsbG8=',
    'a file URL naming a local path': 'file:///etc/media-uploads/passwd',
  };

  it.each(Object.entries(MALFORMED))('%s -> NOT deleted, zero storage side effects', async (_n, priorUrl) => {
    world(priorUrl);
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(storageSideEffects()).toEqual([]);
  });
});

describe('traversal, in both raw and encoded form, is refused', () => {
  const TRAVERSAL = {
    'raw .. escaping into another activity of the same company':
      own(`${PLAN_A}/video/../../${OTHER_ACTIVITY}/video/secret.mp4`),
    'raw .. escaping the bucket entirely':
      own(`${PLAN_A}/../../../../../../secret.mp4`),
    // A standalone %2e%2e segment is collapsed by the WHATWG URL parser itself
    // (new URL(...).pathname already reads `.../OTHER_ACTIVITY/...`), so these two
    // reach the scope check as a plain foreign key.
    'percent-encoded .. (collapsed by the URL parser into a foreign key)':
      own(`${PLAN_A}/video/%2e%2e/%2e%2e/${OTHER_ACTIVITY}/video/secret.mp4`),
    'percent-encoded .. with the activity id prefix intact':
      own(`${PLAN_A}/%2e%2e/${OTHER_ACTIVITY}/video/secret.mp4`),
    'percent-encoded separator smuggling a second bucket path':
      own(`${PLAN_A}/video/%2f%2e%2e%2fsecret.mp4`),
    // An encoded separator INSIDE one segment is not collapsed by the parser. The
    // key is never percent-decoded: a key carrying `%` is refused outright, even
    // when decoding it would name a path under this very activity.
    'encoded separators that would decode to a path inside this activity':
      own(`${PLAN_A}%2Fvideo%2Fold.mp4`),
    'an encoded traversal hidden inside a single segment':
      own(`${PLAN_A}/video/%2e%2e%2f${OTHER_ACTIVITY}%2fsecret.mp4`),
  };

  it.each(Object.entries(TRAVERSAL))('%s -> NOT deleted, zero storage side effects', async (_n, priorUrl) => {
    world(priorUrl);
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(storageSideEffects()).toEqual([]);
  });
});

describe('authorization happens before any deletion', () => {
  it('the company resolution and the membership read both precede the remove', async () => {
    world(own(OWN_TUS_KEY));
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    const removeAt = mockEvents.findIndex((e) => e.startsWith('storage:remove:'));
    expect(removeAt).toBeGreaterThan(-1);
    const campaignsAt = mockEvents.indexOf('db:campaigns');
    const membershipAt = mockEvents.indexOf('db:user_company_roles');
    expect(campaignsAt).toBeGreaterThan(-1);
    expect(membershipAt).toBeGreaterThan(-1);
    expect(campaignsAt).toBeLessThan(removeAt);
    expect(membershipAt).toBeLessThan(removeAt);
  });

  it('a member of another company cannot reschedule this row and deletes nothing', async () => {
    world(own(OWN_TUS_KEY));
    const r = await call({ media_url: NEW_MEDIA }, 'B');
    expect(r.status).toBe(403);
    expect(storageSideEffects()).toEqual([]);
    expect(mockEvents.filter((e) => e === 'media:validate')).toEqual([]);
  });

  it('an anonymous caller cannot reschedule this row and deletes nothing', async () => {
    world(own(OWN_TUS_KEY));
    const r = await call({ media_url: NEW_MEDIA }, null);
    expect(r.status).toBe(401);
    expect(storageSideEffects()).toEqual([]);
  });

  it('an unauthorized caller cannot delete even a hostile prior url', async () => {
    world(`https://evil.test${PUBLIC_PREFIX}${OWN_TUS_KEY}`);
    const r = await call({ media_url: NEW_MEDIA }, null);
    expect(r.status).toBe(401);
    expect(storageSideEffects()).toEqual([]);
  });
});

describe('the rest of the route is unchanged', () => {
  it('retime-only: the post is retimed and re-enqueued, and nothing is deleted', async () => {
    world(own(OWN_TUS_KEY));
    const r = await call({ scheduled_at: NEW_AT });
    expect(r.status).toBe(200);
    expect(rows('scheduled_posts').find((p) => p.id === POST_A)!.scheduled_for).toBe(NEW_AT);
    expect(mockEvents).toContain(`queue:reenqueue:${POST_A}:${USER_A}:sa-a`);
    expect(storageSideEffects()).toEqual([]);
  });

  it('media replace + retime: media swapped, post retimed, own prior object deleted', async () => {
    world(own(OWN_TUS_KEY));
    const r = await call({ media_url: NEW_MEDIA, scheduled_at: NEW_AT });
    expect(r.status).toBe(200);
    expect(mockEvents).toContain('media:validate');
    expect(rows('scheduled_posts').find((p) => p.id === POST_A)!.scheduled_for).toBe(NEW_AT);
    expect(removes()).toEqual([`storage:remove:media-uploads:${OWN_TUS_KEY}`]);
  });

  it('media replace + retime with a foreign prior url still performs the reschedule', async () => {
    world(`https://evil.test${PUBLIC_PREFIX}${CO_B}/${OTHER_ACTIVITY}/video/secret.mp4`);
    const r = await call({ media_url: NEW_MEDIA, scheduled_at: NEW_AT });
    expect(r.status).toBe(200);
    expect(rows('scheduled_posts').find((p) => p.id === POST_A)!.scheduled_for).toBe(NEW_AT);
    expect(rows('daily_content_plans')[0].content).toContain(NEW_MEDIA);
    expect(storageSideEffects()).toEqual([]);
  });

  it('a row with no prior media url deletes nothing', async () => {
    world('');
    const r = await call({ media_url: NEW_MEDIA });
    expect(r.status).toBe(200);
    expect(storageSideEffects()).toEqual([]);
  });
});
