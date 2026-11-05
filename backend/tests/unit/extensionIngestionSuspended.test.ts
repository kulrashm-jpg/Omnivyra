/**
 * R-3: browser (extension) ingestion is suspended.
 *
 * Proves, per route, that nothing collected in a browser is stored and that
 * the server neither queues nor hands out collection commands — and that
 * the routes R-3 must NOT disable still work. Each block has a positive
 * control (the same input with the suspension off) so a pass cannot come
 * from a gate that would have refused anyway.
 */

process.env.EXTENSION_SESSION_SECRET = 'test-extension-session-secret-not-production';
delete process.env.DEV_EXTENSION_AUTH_BYPASS;
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

type Row = Record<string, unknown>;
const db = {
  calls: [] as string[],
  rows: { community_ai_actions: [] as Row[] } as Record<string, Row[]>,
  claimed: [] as string[],
  inserted: [] as string[],
};
function builder(table: string) {
  const api: any = {
    select() { return api; }, eq() { return api; }, is() { return api; }, or() { return api; },
    order() { return api; }, limit() { return api; }, in() { return api; }, gte() { return api; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: db.rows[table] ?? [], error: null }).then(res); },
    insert(v: unknown) { db.inserted.push(table); return { select: () => ({ maybeSingle: () => Promise.resolve({ data: v, error: null }), single: () => Promise.resolve({ data: v, error: null }) }), then: (r: any) => Promise.resolve({ data: null, error: null }).then(r) }; },
    update() {
      const u: any = {
        eq(c: string, v: unknown) { if (c === 'id') u.id = v; return u; }, is() { return u; },
        select() { return { maybeSingle: () => { if (table === 'community_ai_actions' && u.id) db.claimed.push(String(u.id)); return Promise.resolve({ data: u.id ? { id: u.id } : [], error: null }); } }; },
        then(r: any) { return Promise.resolve({ data: [], error: null }).then(r); },
      };
      return u;
    },
  };
  return api;
}
// On the foundation base the lease is taken by the atomic claim RPC (P-A), not an
// UPDATE; the fake records that claim in the same `db.claimed` the UPDATE fake used.
const fakeSupabase = { from: (t: string) => { db.calls.push(t); return builder(t); }, rpc: (n: string, args?: { p_action_id?: string }) => {
  db.calls.push(`rpc:${n}`);
  if (n === 'claim_community_ai_browser_command' && args?.p_action_id) {
    db.claimed.push(String(args.p_action_id));
    return Promise.resolve({ data: [{ id: args.p_action_id, dispatch_lease_expires_at: null }], error: null });
  }
  return Promise.resolve({ data: null, error: null });
} };
jest.mock('../../db/supabaseClient', () => ({ supabase: fakeSupabase }));
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: fakeSupabase }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

const ingested: unknown[] = [];
jest.mock('../../services/extensionEventIngestionService', () => ({ ingestExtensionEvent: async (x: unknown) => { ingested.push(x); return { id: 'e' }; } }));
const SESSION = { userId: 'user-r3', orgId: 'org-r3', expiresAt: Date.now() + 3600_000, hmacNonce: 'nonce-r3' };
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({ requireExtensionAuth: async () => ({ session: SESSION }) }));
jest.mock('../../middleware/extensionAuthMiddleware', () => ({ requireExtensionAuth: async () => ({ session: SESSION }) }));
jest.mock('@/backend/services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'user-r3' }) }));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({ CAPABILITY_MAP_VERSION: 'cap-test', resolveEngagementCapability: () => ({ status: 'api_verified' }) }));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false }));
jest.mock('@/backend/services/extensionCommandSchema', () => ({ COMMAND_SCHEMA_VERSION: 'schema-test', validateCommandPayload: (_p: string, _a: string, payload: unknown) => ({ ok: true, payload }) }));
jest.mock('@/backend/services/communityAiExecutionResultService', () => ({ recordExecutionMetric: () => undefined, persistExecutionResult: async () => ({ ok: true }) }));
jest.mock('@/backend/services/rpaWorker/rpaAccountTier', () => ({ resolveAccountTier: async () => 'standard' }));
// The foundation base also runs L-3 before the claim; this suite is about the R-3
// suspension, so the recipient recheck allows (as in extensionDispatchSafety.routes).
jest.mock('@/backend/services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));

let suspended = true;
jest.mock('../../services/extensionIngestionSuspension', () => {
  const actual = jest.requireActual('../../services/extensionIngestionSuspension');
  return { ...actual, get EXTENSION_BROWSER_INGESTION_SUSPENDED() { return suspended; } };
});
jest.mock('@/backend/services/extensionIngestionSuspension', () => {
  const actual = jest.requireActual('../../services/extensionIngestionSuspension');
  return { ...actual, get EXTENSION_BROWSER_INGESTION_SUSPENDED() { return suspended; } };
});

// Prompt 3 (OD-1): the session tenant's execution policy is open here; the
// policy gate itself is proven in extensionLeaseHandoutPolicyGate.test.ts.
jest.mock('@/backend/services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  getCommunityExecutionPolicy: jest.fn(async () => ({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: 'v1' })),
}));

import eventsHandler from '../../../pages/api/extension/events';
import dmsHandler from '../../../pages/api/extension/events/dms';
import commentsHandler from '../../../pages/api/extension/events/comments';
import platformSyncHandler from '../../../pages/api/engagement/platform-sync';
import commandsHandler from '../../../pages/api/extension/commands';
import { BROWSER_SYNC_SUSPENDED, BROWSER_SYNC_SUSPENDED_NOTICE } from '../../../lib/engagement/browserSyncSuspension';

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
async function call(handler: any, req: Record<string, unknown>) {
  const res = mockRes();
  await handler({ headers: {}, query: {}, ...req }, res);
  return res;
}
const reset = () => { db.calls.length = 0; db.claimed.length = 0; db.inserted.length = 0; ingested.length = 0; db.rows.community_ai_actions = []; };

beforeEach(() => { suspended = true; reset(); });

describe('upload routes refuse before auth, parsing or any DB access', () => {
  const uploads: Array<[string, any, Record<string, unknown>]> = [
    ['/api/extension/events', eventsHandler, { organization_id: 'org-r3', platform: 'linkedin', event_type: 'comment', platform_message_id: 'm1', data: { content: 'x' } }],
    ['/api/extension/events/dms', dmsHandler, { platform: 'linkedin', threads: [{ platform_thread_id: 't1', messages: [{ platform_message_id: 'm1', text: 'x' }] }] }],
    ['/api/extension/events/comments', commentsHandler, { platform: 'linkedin', posts: [{ post_urn: 'urn:li:activity:1' }], comments: [{ platform_comment_id: 'c1', text: 'x' }] }],
  ];

  it.each(uploads)('%s → 410 BROWSER_SYNC_SUSPENDED, nothing stored', async (url, handler, body) => {
    const res = await call(handler, { method: 'POST', url, body });
    expect(res.statusCode).toBe(410);
    expect(res.body).toMatchObject({ success: false, error: 'BROWSER_SYNC_SUSPENDED' });
    expect(res.body.message).toMatch(/browser sync is suspended/i);
    expect(db.calls).toEqual([]);
    expect(ingested).toEqual([]);
  });

  it('positive control: with the suspension off, /api/extension/events reaches ingestion', async () => {
    suspended = false;
    const res = await call(eventsHandler, { method: 'POST', url: '/api/extension/events', body: uploads[0][2] });
    expect(res.statusCode).not.toBe(410);
    expect(db.calls.length).toBeGreaterThan(0);
  });
});

describe('server-queued collection', () => {
  it('POST /api/engagement/platform-sync queues nothing (410)', async () => {
    const res = await call(platformSyncHandler, { method: 'POST', url: '/api/engagement/platform-sync', body: { organization_id: 'org-r3', platforms: ['linkedin', 'facebook'] } });
    expect(res.statusCode).toBe(410);
    expect(res.body.error).toBe('BROWSER_SYNC_SUSPENDED');
    expect(db.inserted).toEqual([]);
  });

  it('GET /api/engagement/platform-sync (freshness read) still works', async () => {
    const res = await call(platformSyncHandler, { method: 'GET', url: '/api/engagement/platform-sync', query: { organization_id: 'org-r3', platforms: 'linkedin' } });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  const queued = (action: string, id: string): Row => ({
    id, organization_id: 'org-r3', platform: 'linkedin', action_type: action, target_id: 'urn:li:activity:1',
    suggested_text: action === 'reply' ? 'thanks' : null, execution_mode: 'browser', status: 'pending',
    created_at: new Date().toISOString(), dispatch_lease_expires_at: null, command_chain: null, command_chain_index: 0,
    // D-01 / P-A: only a row with a recorded human approval is offered for execution.
    approved_at: new Date().toISOString(),
  });
  const poll = () => call(commandsHandler, { method: 'GET', url: '/api/extension/commands', headers: { 'x-omnivyra-capability-version': 'cap-test', 'x-omnivyra-dispatch-renewal': '1' } });

  it('an already-queued sync_*_inbox row is never offered or claimed; other commands are', async () => {
    db.rows.community_ai_actions = [queued('sync_comments_inbox', 'sync-1'), queued('sync_dm_inbox', 'sync-2'), queued('reply', 'reply-1')];
    const res = await poll();
    expect(res.statusCode).toBe(200);
    const ids = (res.body.commands as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual(['reply-1']);
    expect(db.claimed).toEqual(['reply-1']);
  });

  it('positive control: with the suspension off, the same sync rows WOULD be offered', async () => {
    suspended = false;
    db.rows.community_ai_actions = [queued('sync_comments_inbox', 'sync-1'), queued('sync_dm_inbox', 'sync-2')];
    const res = await poll();
    expect((res.body.commands as Array<{ id: string }>).map((c) => c.id).sort()).toEqual(['sync-1', 'sync-2']);
  });
});

describe('Command Center copy', () => {
  it('states plainly that browser sync is suspended', () => {
    expect(BROWSER_SYNC_SUSPENDED).toBe(true);
    expect(BROWSER_SYNC_SUSPENDED_NOTICE).toMatch(/^Browser sync is suspended\./);
  });
});
