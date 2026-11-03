/**
 * GET /api/extension/commands is the last server-side point before the
 * browser extension sends a reply, like or DM. The executor's platform gates
 * (runExecution: execution_enabled, require_human_approval) are re-applied
 * there, so a command prepared before execution was switched off, or before
 * human approval became required, is not handed out. The policy service is the
 * real one: an unreadable policy must fail closed. Read-only inbox syncs are
 * never gated.
 */

type Row = Record<string, any>;

const ORG = 'org-1';
const db: { actions: Row[]; policy: Row[] | 'error' } = { actions: [], policy: [] };

function actionsQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let limit = Infinity;
  const q: any = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q; },
    or: () => { filters.push((r) => r.dispatch_lease_expires_at == null); return q; },
    order: () => q,
    limit: (n: number) => { limit = n; return q; },
    update: (p: Row) => { patch = p; return q; },
    maybeSingle: async () => {
      const hit = db.actions.find((r) => filters.every((f) => f(r)));
      if (hit && patch) Object.assign(hit, patch);
      return { data: hit ? { id: hit.id } : null, error: null };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: db.actions.filter((r) => filters.every((f) => f(r))).slice(0, limit).map((r) => ({ ...r })), error: null }).then(ok, ko),
  };
  return q;
}

function policyQuery() {
  const q: any = {
    select: () => q,
    order: () => q,
    limit: async () => (db.policy === 'error' ? { data: null, error: { code: '42501' } } : { data: db.policy, error: null }),
  };
  return q;
}

const from = (t: string) => {
  if (t === 'community_ai_actions') return actionsQuery();
  if (t === 'community_ai_platform_policy') return policyQuery();
  // extension_sessions heartbeat (best-effort, fire-and-forget)
  const q: any = { update: () => q, eq: () => q, select: () => q, limit: async () => ({ data: [{ id: 's' }], error: null }), insert: async () => ({ error: null }) };
  return q;
};

jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => from(t) } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => from(t) } }));
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => ({ session: { userId: 'user-1', orgId: ORG, hmacNonce: 'nonce' } }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({
  CAPABILITY_MAP_VERSION: 'cap-test', resolveEngagementCapability: () => ({ status: 'api_verified' }),
}));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false }));
jest.mock('@/backend/services/extensionCommandSchema', () => ({
  COMMAND_SCHEMA_VERSION: 'schema-test', validateCommandPayload: (_p: string, _a: string, payload: Row) => ({ ok: true, payload }),
}));
jest.mock('@/backend/services/communityAiExecutionResultService', () => ({
  recordExecutionMetric: async () => undefined, persistExecutionResult: async () => ({ ok: true }),
}));
jest.mock('@/backend/services/rpaWorker/rpaAccountTier', () => ({ resolveAccountTier: async () => 'business' }));

import route from '../../../pages/api/extension/commands';
import { __resetCommunityAiPlatformPolicyCacheForTests } from '../../services/communityAiPlatformPolicyService';

const reply = (over: Row = {}): Row => ({
  id: 'reply-1', organization_id: ORG, status: 'pending', execution_mode: 'browser', platform: 'linkedin',
  action_type: 'reply', target_id: 'comment-1', suggested_text: 'Thanks!', created_at: '2026-11-03T10:00:00Z',
  dispatch_lease_id: null, dispatch_lease_expires_at: null, execution_correlation_id: 'corr-1',
  command_chain: null, command_chain_index: 0, approved_at: '2026-11-03T09:59:00Z', ...over,
});
const dmChain = (over: Row = {}): Row => reply({
  id: 'dm-1', action_type: 'dm', target_id: 'https://www.linkedin.com/messaging/thread/1/',
  command_chain: [{ action_type: 'open_thread', payload: { threadUrl: 'x' } }, { action_type: 'continue_thread', payload: { text: 'hi' } }],
  ...over,
});
const inboxSync = (over: Row = {}): Row => reply({
  id: 'sync-1', action_type: 'dm', target_id: 'sync-dm-inbox:linkedin', suggested_text: null,
  command_chain: [{ action_type: 'sync_dm_inbox', payload: { navigate: true } }], ...over,
});

const policyRow = (over: Row = {}): Row[] => [{
  execution_enabled: true, auto_rules_enabled: true, require_human_approval: false, updated_at: '2026-11-01T00:00:00Z', updated_by: null, ...over,
}];

async function poll(): Promise<{ status: number; ids: string[] }> {
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: any) => { res.body = p; return res; };
  await (route as any)({ method: 'GET', headers: { 'x-omnivyra-capability-version': 'cap-test' }, query: {}, body: {} }, res);
  return { status: res.statusCode, ids: (res.body?.commands ?? []).map((c: Row) => c.id) };
}

const claimed = (id: string) => db.actions.find((r) => r.id === id)?.dispatch_lease_id != null;

beforeEach(() => {
  __resetCommunityAiPlatformPolicyCacheForTests();
  db.actions = [];
  db.policy = policyRow();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('extension lease handout honours the community platform policy', () => {
  it('control: an enabled policy hands out and claims a prepared reply', async () => {
    db.actions = [reply()];
    expect(await poll()).toEqual({ status: 200, ids: ['reply-1'] });
    expect(claimed('reply-1')).toBe(true);
  });

  it('execution switched off: a prepared reply and a DM chain are not handed out or claimed', async () => {
    db.policy = policyRow({ execution_enabled: false });
    db.actions = [reply(), dmChain()];
    expect(await poll()).toEqual({ status: 200, ids: [] });
    expect(claimed('reply-1')).toBe(false);
    expect(claimed('dm-1')).toBe(false);
  });

  it('execution switched off: a read-only inbox sync is still handed out', async () => {
    db.policy = policyRow({ execution_enabled: false });
    db.actions = [reply(), inboxSync()];
    expect((await poll()).ids).toEqual(['sync-1']);
    expect(claimed('reply-1')).toBe(false);
  });

  it('human approval required: a row without approved_at is held, an approved row goes out', async () => {
    db.policy = policyRow({ require_human_approval: true });
    db.actions = [reply({ id: 'unapproved', approved_at: null }), reply({ id: 'approved' })];
    expect((await poll()).ids).toEqual(['approved']);
    expect(claimed('unapproved')).toBe(false);
  });

  it('unreadable policy fails closed: outbound held, inbox sync still handed out', async () => {
    db.policy = 'error';
    db.actions = [reply(), dmChain(), inboxSync()];
    expect((await poll()).ids).toEqual(['sync-1']);
    expect(claimed('reply-1')).toBe(false);
    expect(claimed('dm-1')).toBe(false);
  });

  it('a later chain step is gated again (continue_thread after open_thread)', async () => {
    db.policy = policyRow({ execution_enabled: false });
    db.actions = [dmChain({ command_chain_index: 1 })];
    expect((await poll()).ids).toEqual([]);
  });
});
