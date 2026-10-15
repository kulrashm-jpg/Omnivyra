/**
 * Closure-010 — POST /api/scheduler/retry is TENANT authority (owner decision):
 * the post owner's retry of their own definitely-failed post. It is NOT a
 * platform recovery route and must not need publish.recovery.manage, step-up
 * or platform SUPER_ADMIN authority; those stay on the platform recovery routes.
 *
 * Real route; the database is the routeAuthHarness fake (compare-and-set
 * predicates are evaluated at write time against the current row, so races are
 * real interleavings, not mocks); the scheduler's queue calls are spies.
 * In-memory: proves the route's decisions and ordering, not Postgres RLS.
 */
import * as fs from 'fs';
import * as path from 'path';
import { seed, invoke, rows, calls, USER_A, USER_B, USER_SUPER, CAMPAIGN_A } from '../helpers/routeAuthHarness';

const mockQueue: string[] = [];
let mockBeforeCancel: (() => void) | null = null;

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => jest.requireActual('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../services/supabaseAuthService', () => jest.requireActual('../helpers/routeAuthHarness').authModule());
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../scheduler/schedulerService', () => ({
  cancelScheduledPostQueueEntry: jest.fn(async (id: string) => {
    mockQueue.push(`cancel:${id}`);
    if (mockBeforeCancel) { const hook = mockBeforeCancel; mockBeforeCancel = null; hook(); }
    return { db_cancelled: 0, queue_removed: 0, errors: [] };
  }),
  enqueueScheduledPostAt: jest.fn(async (id: string, userId: string, accountId: string) => {
    mockQueue.push(`enqueue:${id}:${userId}:${accountId}`);
    return 'enqueued';
  }),
}));

import retryRoute from '../../../pages/api/scheduler/retry';

type Row = Record<string, unknown>;
const POST = '0a000000-0000-4000-8000-0000000000aa';
const TEAMMATE = 'user-t-00-0000-0000-00000000000t'; // another member of company A, not the post owner

function world(over: Row = {}) {
  seed({
    scheduled_posts: [{
      id: POST, campaign_id: CAMPAIGN_A, user_id: USER_A, social_account_id: 'sa-a', status: 'failed',
      platform: 'linkedin', error_code: 'LINKEDIN_RATE_LIMIT', error_message: 'rate limited',
      platform_post_id: null, parent_post_id: null, scheduled_for: '2027-01-01T00:00:00.000Z', ...over,
    }],
  });
}
const retry = (as: 'A' | 'B' | 'SUPER' | null, body: Row = { scheduled_post_id: POST }) =>
  invoke(retryRoute as never, { method: 'POST', body, as });
const post = () => rows('scheduled_posts').find((p) => p.id === POST) as Row;
const snapshot = () => JSON.parse(JSON.stringify(post()));
/** A concurrent writer: REPLACES the stored row (the harness hands out live references). */
const concurrentWrite = (patch: Row) => {
  const t = rows('scheduled_posts');
  const i = t.findIndex((p) => p.id === POST);
  t[i] = { ...t[i], ...patch };
};
const postWrites = () => calls().filter((c) => c.table === 'scheduled_posts' && c.op === 'update');

beforeEach(() => {
  mockQueue.length = 0;
  mockBeforeCancel = null;
});

describe('authentication and identity', () => {
  it('unauthenticated → 401 before any post read, cancel, reset or enqueue', async () => {
    world();
    const before = snapshot();
    const r = await retry(null);
    expect(r.status).toBe(401);
    expect(calls().filter((c) => c.table === 'scheduled_posts')).toEqual([]);
    expect(mockQueue).toEqual([]);
    expect(post()).toEqual(before);
  });

  it('the owner retries a definitely-failed post: reset to scheduled, prior job retired, re-queued under the SESSION user', async () => {
    world();
    const r = await retry('A');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'requeued', enqueue: 'enqueued' });
    expect(post()).toMatchObject({ status: 'scheduled', error_code: null, error_message: null });
    expect(mockQueue).toEqual([`cancel:${POST}`, `enqueue:${POST}:${USER_A}:sa-a`]);
  });

  it('a reconciled-not-published post is retryable (the deliberate next step after reconciliation)', async () => {
    world({ error_code: 'PUBLISH_RECONCILED_NOT_PUBLISHED' });
    const r = await retry('A');
    expect(r.status).toBe(200);
    expect(post()).toMatchObject({ status: 'scheduled' });
  });

  it.each([
    ['another member of the SAME company (not the owner)', 'A' as const, TEAMMATE],
    ['the platform SUPER_ADMIN (a member of the same company; retry has no platform exception)', 'SUPER' as const, USER_A],
    ['another tenant', 'B' as const, USER_A],
  ])('%s → 404 (existence not disclosed), no change, no queue operation', async (_n, as, owner) => {
    world({ user_id: owner });
    const before = snapshot();
    const r = await retry(as);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(post()).toEqual(before);
    expect(postWrites()).toEqual([]);
    expect(mockQueue).toEqual([]);
  });

  it('a caller-supplied owner / user id cannot override the session: still 404 on a teammate\'s post', async () => {
    world({ user_id: TEAMMATE });
    const r = await retry('A', { scheduled_post_id: POST, user_id: TEAMMATE, owner_id: TEAMMATE, company_id: 'anything' });
    expect(r.status).toBe(404);
    expect(mockQueue).toEqual([]);
  });

  it('a caller-supplied user id on the caller\'s OWN post is ignored: the job is queued under the session user', async () => {
    world();
    await retry('A', { scheduled_post_id: POST, user_id: USER_B });
    expect(mockQueue).toContain(`enqueue:${POST}:${USER_A}:sa-a`);
    expect(mockQueue.join(' ')).not.toContain(USER_B);
  });
});

describe('only a definitely-failed outcome is retryable — everything else is refused before anything is touched', () => {
  it.each([
    ['published', { status: 'published', platform_post_id: 'li-1', error_code: null }, 'POST_ALREADY_PUBLISHED'],
    ['a published identity left beside a failure write (failed + platform_post_id)', { platform_post_id: 'li-1' }, 'POST_ALREADY_PUBLISHED'],
    ['processing (publishing)', { status: 'publishing', error_code: null }, 'NOT_RETRYABLE'],
    ['claimed (PUBLISH_CLAIMED:<token>)', { status: 'publishing', error_code: 'PUBLISH_CLAIMED:tok-1' }, 'NOT_RETRYABLE'],
    ['platform call started (publishing)', { status: 'publishing', error_code: 'PUBLISH_CALL_STARTED' }, 'NOT_RETRYABLE'],
    ['platform call started, recorded on a failed row', { error_code: 'PUBLISH_CALL_STARTED' }, 'PUBLISH_OUTCOME_UNCERTAIN'],
    ['uncertain outcome', { error_code: 'PUBLISH_OUTCOME_UNCERTAIN' }, 'PUBLISH_OUTCOME_UNCERTAIN'],
    ['still scheduled', { status: 'scheduled', error_code: null }, 'NOT_RETRYABLE'],
    ['cancelled', { status: 'cancelled', error_code: null }, 'NOT_RETRYABLE'],
    ['a thread child', { parent_post_id: '0a000000-0000-4000-8000-0000000000ff' }, 'THREAD_CHILD_NOT_RETRYABLE'],
    ['no connected account', { social_account_id: null }, 'NO_SOCIAL_ACCOUNT'],
  ] as const)('%s → 409 %s, no cancel, no reset, no enqueue', async (_n, over, expectedCode) => {
    world(over);
    const before = snapshot();
    const r = await retry('A');
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: expectedCode });
    expect(post()).toEqual(before);
    expect(postWrites()).toEqual([]);
    expect(mockQueue).toEqual([]);
  });
});

describe('races: the compare-and-set and the claim fencing hold', () => {
  it('two concurrent retries: exactly one resets and re-queues; the other gets 409', async () => {
    world();
    const [r1, r2] = await Promise.all([retry('A'), retry('A')]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(mockQueue.filter((e) => e.startsWith('enqueue:'))).toHaveLength(1);
    expect(post()).toMatchObject({ status: 'scheduled' });
  });

  it('a delivery claims the post between the check and the reset: the claim is NOT overwritten (409), nothing queued', async () => {
    world();
    mockBeforeCancel = () => concurrentWrite({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:worker-1' });
    const r = await retry('A');
    expect(r.status).toBe(409);
    expect(post()).toMatchObject({ status: 'publishing', error_code: 'PUBLISH_CLAIMED:worker-1' });
    expect(mockQueue.filter((e) => e.startsWith('enqueue:'))).toEqual([]);
  });

  it('the outcome becomes uncertain between the check and the reset: the marker is NOT cleared (409)', async () => {
    world();
    mockBeforeCancel = () => concurrentWrite({ error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    const r = await retry('A');
    expect(r.status).toBe(409);
    expect(post()).toMatchObject({ status: 'failed', error_code: 'PUBLISH_OUTCOME_UNCERTAIN' });
    expect(mockQueue.filter((e) => e.startsWith('enqueue:'))).toEqual([]);
  });

  it('a published identity lands between the check and the reset: the reset refuses it (409), the identity is kept', async () => {
    world();
    mockBeforeCancel = () => concurrentWrite({ platform_post_id: 'li-late' });
    const r = await retry('A');
    expect(r.status).toBe(409);
    expect(post()).toMatchObject({ status: 'failed', platform_post_id: 'li-late' });
    expect(mockQueue.filter((e) => e.startsWith('enqueue:'))).toEqual([]);
  });
});

describe('policy separation (source-level pin)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../pages/api', rel), 'utf8');

  it('tenant retry carries no platform recovery capability, step-up gate or platform authority', () => {
    const src = read('scheduler/retry.ts');
    expect(src).not.toMatch(/PUBLISH_RECOVERY_MANAGE|requirePlatformWriteAuthority|requireCapability\s*\(/);
    // Every read and write is pinned to the session user: one user pin per
    // scheduled_posts statement (read, claim, release, reset, restore — Closure-014C).
    const statements = src.match(/\.from\('scheduled_posts'\)/g)?.length ?? 0;
    expect(statements).toBe(5);
    expect(src.match(/\.eq\('user_id', user\.id\)/g)?.length).toBe(statements);
  });

  it.each(['super-admin/publish/reconcile.ts', 'super-admin/threads/[threadId]/resume.ts', 'super-admin/threads/[threadId]/reconcile.ts'])(
    'platform recovery %s keeps publish.recovery.manage + platform write authority',
    (rel) => {
      const src = read(rel);
      expect(src).toMatch(/capability:\s*PUBLISH_RECOVERY_MANAGE/);
      expect(src).toMatch(/requirePlatformWriteAuthority\(res, guard\.principal/);
      expect(src).not.toMatch(/requireStepUp\s*:\s*false/);
    },
  );
});
