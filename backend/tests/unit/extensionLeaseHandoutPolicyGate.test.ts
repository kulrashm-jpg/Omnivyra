/**
 * GET /api/extension/commands is the last server-side point before the
 * browser extension sends a reply, like or DM. The executor's gates are
 * re-applied there, so a command prepared before execution was switched off is
 * not handed out. Prompt 3 (OD-1): the policy is the SESSION TENANT's own
 * (community_execution_policy_decision for (org, org)); missing, unreadable or
 * disabled all refuse, a human approval of record is required whatever the
 * policy says, and every refusal writes one governance refusal record (claim
 * point 'browser'). The policy service is the real one. Read-only inbox syncs
 * are the one recorded exemption from this pre-check (never from the claim).
 */

type Row = Record<string, any>;

const ORG = 'org-1';
const db: { actions: Row[]; policy: Row | 'error' } = { actions: [], policy: {} };
const policyCalls: Row[] = [];
const refusals: Row[] = [];

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

const from = (t: string) => {
  if (t === 'community_ai_actions') return actionsQuery();
  // extension_sessions heartbeat (best-effort, fire-and-forget)
  const q: any = { update: () => q, eq: () => q, select: () => q, limit: async () => ({ data: [{ id: 's' }], error: null }), insert: async () => ({ error: null }) };
  return q;
};

// W1 (CR-X-01): the only claim is claim_community_ai_browser_command. This fake
// grants it to an unclaimed pending row; the SQL's own approval and kill-switch
// checks are covered by the real-schema suites.
const rpc = async (name: string, args: Row) => {
  if (name === 'community_execution_policy_decision') {
    policyCalls.push(args);
    return db.policy === 'error' ? { data: null, error: { code: '42501' } } : { data: [db.policy], error: null };
  }
  if (name !== 'claim_community_ai_browser_command') return { data: null, error: { message: 'unexpected rpc ' + name } };
  const hit = db.actions.find((r) => r.id === args.p_action_id && r.status === 'pending' && r.dispatch_lease_id == null);
  if (!hit) return { data: [], error: null };
  hit.dispatch_lease_id = args.p_lease_id;
  hit.dispatch_lease_expires_at = new Date(Date.now() + 90_000).toISOString();
  return { data: [{ id: hit.id, dispatch_lease_expires_at: hit.dispatch_lease_expires_at }], error: null };
};
jest.mock('@/backend/db/supabaseClient', () => ({ supabase: { from: (t: string) => from(t), rpc: (n: string, a: Row) => rpc(n, a) } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => from(t), rpc: (n: string, a: Row) => rpc(n, a) } }));
// W1's L-3 recipient recheck is not under test here: allowed.
jest.mock('@/backend/services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: { platform: 'linkedin', platformUserId: 'li-1', personId: null } }),
}));
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
jest.mock('@/backend/services/communityExecutionRefusal', () => ({
  recordCommunityExecutionRefusal: async (input: Row) => { refusals.push(input); return true; },
}));

import route from '../../../pages/api/extension/commands';
import { __resetCommunityAiPlatformPolicyCacheForTests } from '../../services/communityAiPlatformPolicyService';

const reply = (over: Row = {}): Row => ({
  id: 'reply-1', tenant_id: ORG, organization_id: ORG, status: 'pending', execution_mode: 'browser', platform: 'linkedin',
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

const ALLOW: Row = { allowed: true, code: null, auto_rules_enabled: true, policy_version: '2026-11-01T00:00:00Z' };
const REFUSE = (code: string): Row => ({ allowed: false, code, auto_rules_enabled: null, policy_version: null });

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
  db.policy = ALLOW;
  policyCalls.length = 0;
  refusals.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('extension lease handout honours the community platform policy', () => {
  it('control: an enabled policy hands out and claims a prepared reply', async () => {
    db.actions = [reply()];
    expect(await poll()).toEqual({ status: 200, ids: ['reply-1'] });
    expect(claimed('reply-1')).toBe(true);
    expect(policyCalls).toEqual([{ p_org: ORG, p_tenant: ORG }]);
    expect(refusals).toEqual([]);
  });

  it.each(['POLICY_EXECUTION_DISABLED', 'PLATFORM_KILL_SWITCH', 'POLICY_MISSING'])(
    'tenant policy refuses (%s): a prepared reply and a DM chain are not handed out or claimed; each refusal recorded',
    async (code) => {
      db.policy = REFUSE(code);
      db.actions = [reply(), dmChain()];
      expect(await poll()).toEqual({ status: 200, ids: [] });
      expect(claimed('reply-1')).toBe(false);
      expect(claimed('dm-1')).toBe(false);
      expect(refusals.map((r) => [r.actionId, r.claimPoint, r.code, r.organizationId, r.tenantId])).toEqual([
        ['reply-1', 'browser', code, ORG, ORG],
        ['dm-1', 'browser', code, ORG, ORG],
      ]);
    },
  );

  // R-3 (live): browser ingestion is suspended, so a read-only inbox sync is
  // never handed out on any line, whatever the policy. Round 3 asserted the
  // pre-R-3 behaviour; the policy gate's read-only exemption is kept but cannot
  // re-enable collection (CR-X-01).
  it('R-3: a read-only inbox sync is never handed out, even with execution enabled', async () => {
    db.actions = [inboxSync()];
    expect((await poll()).ids).toEqual([]);
    expect(claimed('sync-1')).toBe(false);
  });

  it('execution switched off: neither a reply nor an inbox sync is handed out', async () => {
    db.policy = REFUSE('POLICY_EXECUTION_DISABLED');
    db.actions = [reply(), inboxSync()];
    expect((await poll()).ids).toEqual([]);
    expect(claimed('reply-1')).toBe(false);
    expect(claimed('sync-1')).toBe(false);
  });

  it('D-01: a row without approved_at is held whatever the policy says; an approved row goes out', async () => {
    db.policy = ALLOW;
    db.actions = [reply({ id: 'unapproved', approved_at: null }), reply({ id: 'approved' })];
    expect((await poll()).ids).toEqual(['approved']);
    expect(claimed('unapproved')).toBe(false);
    expect(refusals).toEqual([expect.objectContaining({ actionId: 'unapproved', code: 'HUMAN_APPROVAL_REQUIRED', claimPoint: 'browser' })]);
  });

  it('unreadable policy fails closed: outbound held (inbox sync held by R-3)', async () => {
    db.policy = 'error';
    db.actions = [reply(), dmChain(), inboxSync()];
    expect((await poll()).ids).toEqual([]);
    expect(claimed('reply-1')).toBe(false);
    expect(claimed('dm-1')).toBe(false);
  });

  it('a later chain step is gated again (continue_thread after open_thread)', async () => {
    db.policy = REFUSE('POLICY_EXECUTION_DISABLED');
    db.actions = [dmChain({ command_chain_index: 1 })];
    expect((await poll()).ids).toEqual([]);
  });

  it('F6: a refusal is recorded under the row scope (its own tenant and organization), never the session scope', async () => {
    db.policy = REFUSE('POLICY_EXECUTION_DISABLED');
    db.actions = [reply({ id: 'legacy-scope', tenant_id: 'tenant-legacy' })];
    await poll();
    expect(refusals.map((r) => [r.actionId, r.organizationId, r.tenantId])).toEqual([['legacy-scope', ORG, 'tenant-legacy']]);
  });

  it('the read-only exemption is exactly the two inbox syncs (a recorded owner decision)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(require('path').join(__dirname, '../../../pages/api/extension/commands.ts'), 'utf8');
    expect(src).toMatch(/const READ_ONLY_EXTENSION_ACTIONS: ReadonlySet<string> = new Set\(\['sync_dm_inbox', 'sync_comments_inbox'\]\);/);
    expect(src).toMatch(/RECORDED EXEMPTION/);
  });
});
