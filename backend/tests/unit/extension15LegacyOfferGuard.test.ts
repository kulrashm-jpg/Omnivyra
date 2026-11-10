/**
 * Extension 1.5 vs the 1.4 offer (EXTENSION-1.5.0-CONTRACT.md §4): a session whose user
 * has an active 1.5 binding is never offered LinkedIn reply/like on GET
 * /api/extension/commands (they go through the v15 route, own content first); a
 * session without one (1.4.x), or whose binding cannot be read, is unaffected.
 * Harness copied from extensionDispatchSafety.routes.test.ts.
 */
import { createHash } from 'crypto';
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

const binding: { r: any } = { r: { ok: true, urn: null } };
jest.mock('@/backend/services/extension15', () => ({ getActiveBinding: async () => binding.r }));

let mockDb: FakeDb = createFakeDb();
const policy = { execution_enabled: true, require_human_approval: false };
/** Hook run inside the claim RPC before its predicate is evaluated (race injection). */
let beforeClaim: ((args: any) => void) | null = null;
/** Hook run before the action-result persist (reaper race injection). */
let beforePersist: (() => void) | null = null;
const rpcCalls: string[] = [];

function nowIso() { return new Date().toISOString(); }

/** Emulates claim_community_ai_browser_command (one atomic UPDATE ... RETURNING). */
function rpcClaim(a: any) {
  if (beforeClaim) beforeClaim(a);
  if (!policy.execution_enabled) return { data: [], error: null };
  const row = mockDb.tables.community_ai_actions.find((r) =>
    r.id === a.p_action_id
    && r.organization_id === a.p_organization_id
    && r.status === 'pending'
    && r.execution_mode === 'browser'
    && (r.dispatch_lease_id ?? null) === null
    && (r.cancel_requested_at ?? null) === null
    && (r.approved_at != null
      || (r.requires_human_approval !== true && (r.risk_level ?? '') !== 'high' && !policy.require_human_approval)));
  if (!row) return { data: [], error: null };
  row.dispatch_lease_id = a.p_lease_id;
  row.dispatch_lease_holder_id = a.p_holder_id;
  row.dispatch_lease_expires_at = new Date(Date.now() + a.p_lease_ttl_seconds * 1000).toISOString();
  return { data: [{ id: row.id, dispatch_lease_expires_at: row.dispatch_lease_expires_at }], error: null };
}

/** Emulates record_community_ai_late_dispatch_result (status never changes). */
function rpcLate(a: any) {
  const row = mockDb.tables.community_ai_actions.find((r) =>
    r.id === a.p_action_id && r.organization_id === a.p_organization_id && r.status === 'uncertain'
    && r.dispatch_lease_id === a.p_lease_id && r.dispatch_lease_holder_id === a.p_holder_id
    && ((r.execution_result?.late_results ?? []).length < 20));
  if (!row) return { data: 'not_matched', error: null };
  const er = { ...(row.execution_result || {}) };
  er.late_results = [...(er.late_results || []), { ...a.p_report, received_at: nowIso() }];
  row.execution_result = er;
  return { data: 'recorded', error: null };
}

/** Emulates the reaper's lease phases (uncertain; lease id/holder kept). */
function reap() {
  for (const r of mockDb.tables.community_ai_actions) {
    const expired = r.dispatch_lease_expires_at != null && r.dispatch_lease_expires_at < nowIso();
    if ((r.status === 'pending' && r.execution_mode === 'browser' && expired)
      || (['dispatched', 'acknowledged'].includes(r.status) && expired)) {
      r.execution_result = {
        source: 'lease_reaper', status: 'uncertain', may_have_acted: true,
        error_code: r.status === 'pending' ? 'DISPATCH_LEASE_EXPIRED' : 'DISPATCH_LEASE_EXPIRED_IN_FLIGHT',
        prior_status: r.status,
      };
      r.status = 'uncertain';
    }
  }
}

// L-3: these tests exercise other mechanics with fixtures that carry no
// resolvable recipient; the recipient recheck itself is proven in
// communityL3RecipientRecheck / communityL3RecheckEnforcement /
// communityL3RecheckBrowserClaim. Here every recipient is treated as allowed.
jest.mock('@/backend/services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: async () => ({ ok: true, basis: 'recipient_allowed', recipient: null }),
}));
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: async (name: string, args: any) => {
      rpcCalls.push(name);
      if (name === 'claim_community_ai_browser_command') return rpcClaim(args);
      if (name === 'record_community_ai_late_dispatch_result') return rpcLate(args);
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
  },
}));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    const q = mockDb.from(t);
    if (t !== 'community_ai_actions' || !beforePersist) return q;
    const origUpdate = q.update;
    q.update = (p: any) => { const hook = beforePersist; beforePersist = null; if (hook) hook(); return origUpdate(p); };
    return q;
  },
}));

let currentSession: { userId: string; orgId: string; hmacNonce: string } | null = null;
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => (currentSession ? { session: currentSession } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'browser' }),
  CAPABILITY_MAP_VERSION: 'cap-v1',
}));
jest.mock('@/backend/services/extensionReliabilityService', () => ({
  isCurrentlyDisabled: () => false,
  recordOutcome: () => undefined,
}));
jest.mock('@/backend/services/extensionCommandSchema', () => ({
  validateCommandPayload: (_p: string, _a: string, payload: unknown) => ({ ok: true, payload }),
  COMMAND_SCHEMA_VERSION: 1,
}));
jest.mock('@/backend/services/rpaWorker/rpaAccountTier', () => ({ resolveAccountTier: async () => null }));
jest.mock('@/backend/services/engagementOutboundMirrorService', () => ({
  mirrorOutboundDmAction: async () => ({ error: null, thread_id: null }),
}));
// action-result persists through the executor barrel; the lightweight result
// service has the identical persist contract (and the same never-revive guard).
jest.mock('@/backend/services/communityAiActionExecutor', () =>
  jest.requireActual('../../services/communityAiExecutionResultService'));

/* eslint-disable @typescript-eslint/no-var-requires */
// Prompt 3 (OD-1): the session tenant's execution policy is open here; the
// policy gate itself is proven in extensionLeaseHandoutPolicyGate.test.ts.
jest.mock('@/backend/services/communityAiPlatformPolicyService', () => ({
  ...jest.requireActual('../../services/communityAiPlatformPolicyService'),
  getCommunityExecutionPolicy: jest.fn(async () => ({ ok: true, policy: { execution_enabled: true, auto_rules_enabled: false }, version: 'v1' })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const commandsHandler = require('../../../pages/api/extension/commands').default;
/* eslint-enable @typescript-eslint/no-var-requires */
const ORG = '00000000-0000-0000-0000-00000000000a';
const SESSION_A = { userId: 'user_a', orgId: ORG, hmacNonce: 'nonce-A' };
function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
async function poll() {
  currentSession = SESSION_A;
  const res = mockRes();
  await commandsHandler({ method: 'GET', headers: { 'x-omnivyra-capability-version': 'cap-v1' }, body: {} }, res);
  return res;
}
const action = (id: string, over: Record<string, any> = {}) => ({
  id, tenant_id: ORG, organization_id: ORG, platform: 'linkedin', action_type: 'reply', target_id: `urn:li:comment:${id}`,
  suggested_text: 'hello', execution_mode: 'browser', status: 'pending', approved_at: '2026-10-01T00:00:00Z',
  requires_human_approval: false, risk_level: 'low', cancel_requested_at: null, dispatch_lease_id: null,
  dispatch_lease_holder_id: null, dispatch_lease_expires_at: null, dispatch_acknowledged_at: null,
  execution_correlation_id: null, command_chain: null, command_chain_index: 0, created_at: '2026-10-01T00:00:00Z', ...over,
});
const offeredIds = (res: any) => (res.body?.commands ?? []).map((c: any) => c.id).sort();

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [
    action('00000000-0000-0000-0000-0000000000a1'),
    action('00000000-0000-0000-0000-0000000000a2', { action_type: 'like' }),
    action('00000000-0000-0000-0000-0000000000a3', { platform: 'twitter' }),
    action('00000000-0000-0000-0000-0000000000a4', { platform: 'LinkedIn', action_type: ' Reply ' }),
  ], extension_sessions: [], community_ai_execution_metric_events: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  policy.execution_enabled = true;
  rpcCalls.length = 0;
});

it('a 1.5-bound session is not offered LinkedIn reply/like here (not even claimed); other platforms are unaffected', async () => {
  binding.r = { ok: true, urn: 'urn:li:fsd_profile:ACoAAme0001' };
  const res = await poll();
  expect(res.statusCode).toBe(200);
  expect(offeredIds(res)).not.toEqual(expect.arrayContaining(['00000000-0000-0000-0000-0000000000a1']));
  expect(offeredIds(res)).not.toEqual(expect.arrayContaining(['00000000-0000-0000-0000-0000000000a2']));
  // F1: a mixed-case row ('LinkedIn' / ' Reply ') is skipped too.
  expect(offeredIds(res)).not.toEqual(expect.arrayContaining(['00000000-0000-0000-0000-0000000000a4']));
  const claimedLinkedIn = mockDb.tables.community_ai_actions.filter((r) => String(r.platform).toLowerCase() === 'linkedin' && r.dispatch_lease_id);
  expect(claimedLinkedIn).toEqual([]);
});

it.each([
  ['no binding (1.4.x)', { ok: true, urn: null }],
  ['an unreadable binding (never takes writes away from 1.4.x)', { ok: false, status: 503, code: 'BINDING_UNREADABLE' }],
])('%s: LinkedIn reply/like are offered as before', async (_n, r) => {
  binding.r = r;
  const res = await poll();
  expect(res.statusCode).toBe(200);
  expect(offeredIds(res)).toEqual(expect.arrayContaining(['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2']));
});
