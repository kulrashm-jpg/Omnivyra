/**
 * DM send policy at the extension boundary — /api/extension/commands.
 *
 * The extension is the ONLY component that performs a browser DM, and
 * /api/extension/commands is the only place that hands it a command. Every DM
 * (row action 'dm' / 'direct_message', any chain step other than read-only
 * sync_dm_inbox, or a DM command smuggled onto a non-DM row) must be refused
 * BEFORE the claim, and the row failed as not-acted.
 *
 * Instagram: the tier comes from resolveAccountTier (server-verified only; the
 * REAL implementation runs here against rpa_sessions). A client-declared tier
 * — rpa_sessions.account_tier without account_tier_verified, or row metadata —
 * is ignored. The old gate keyed on the CURRENT chain step being 'dm', so
 * executor-built chains (open_thread / continue_thread / start_new_dm) skipped
 * it; that is pinned below.
 */
import { createFakeDb, COMMUNITY_STATUS_VOCABULARY, type FakeDb } from './helpers/communityExecutionFakeDb';

let mockDb: FakeDb = createFakeDb();
const claimCalls: string[] = [];

function rpcClaim(a: any) {
  claimCalls.push(a.p_action_id);
  const row = mockDb.tables.community_ai_actions.find((r) =>
    r.id === a.p_action_id && r.organization_id === a.p_organization_id && r.status === 'pending'
    && r.execution_mode === 'browser' && (r.dispatch_lease_id ?? null) === null);
  if (!row) return { data: [], error: null };
  row.dispatch_lease_id = a.p_lease_id;
  row.dispatch_lease_holder_id = a.p_holder_id;
  row.dispatch_lease_expires_at = new Date(Date.now() + 90_000).toISOString();
  return { data: [{ id: row.id, dispatch_lease_expires_at: row.dispatch_lease_expires_at }], error: null };
}

jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => mockDb.from(t),
    rpc: async (name: string, args: any) =>
      (name === 'claim_community_ai_browser_command' ? rpcClaim(args) : { data: null, error: { message: `unknown rpc ${name}` } }),
  },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockDb.from(t) }));
let currentSession: { userId: string; orgId: string; hmacNonce: string } | null = null;
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => (currentSession ? { session: currentSession } : null),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'browser' }),
  CAPABILITY_MAP_VERSION: 'cap-v1',
}));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false, recordOutcome: () => undefined }));
jest.mock('@/backend/services/extensionCommandSchema', () => ({
  validateCommandPayload: (_p: string, _a: string, payload: unknown) => ({ ok: true, payload }),
  COMMAND_SCHEMA_VERSION: 1,
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const commandsHandler = require('../../../pages/api/extension/commands').default;
const { RPA_SESSION_ENVELOPE_FORMAT } = require('../../services/rpaWorker/rpaSessionStore');
const { wouldDispatchDm } = require('../../services/dmDispatchSafety');
/* eslint-enable @typescript-eslint/no-var-requires */

const ORG = '00000000-0000-0000-0000-00000000000a';
const SESSION = { userId: 'user_a', orgId: ORG, hmacNonce: 'nonce-A' };

function nextRes() {
  const res: any = { statusCode: 0, body: undefined, responses: 0 };
  res.status = (c: number) => { if (res.responses) throw new Error('second response'); res.statusCode = c; return res; };
  res.json = (b: unknown) => { if (res.responses) throw new Error('second response'); res.responses += 1; res.body = b; return undefined; };
  res.setHeader = () => res;
  return res;
}

async function poll() {
  currentSession = SESSION;
  const res = nextRes();
  await commandsHandler({ method: 'GET', headers: { 'x-omnivyra-capability-version': 'cap-v1' }, body: {} }, res);
  expect(res.responses).toBe(1);
  return res;
}

let seq = 0;
function row(over: Record<string, any> = {}) {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-0000000000${String(seq).padStart(2, '0')}`,
    tenant_id: ORG, organization_id: ORG,
    platform: 'linkedin', action_type: 'dm', target_id: 'https://www.linkedin.com/messaging/thread/2-AAAAAAAAAAAAAAAA/',
    suggested_text: 'hello', execution_mode: 'browser', status: 'pending',
    approved_at: '2026-10-01T00:00:00Z', requires_human_approval: false, risk_level: 'low',
    cancel_requested_at: null, dispatch_lease_id: null, dispatch_lease_holder_id: null, dispatch_lease_expires_at: null,
    execution_correlation_id: null, command_chain: null, command_chain_index: 0, created_at: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const verifiedEnvelope = (verified: boolean) => ({
  format: RPA_SESSION_ENVELOPE_FORMAT, alg: 'aes-256-gcm',
  ciphertext: `${'a'.repeat(24)}:${'b'.repeat(32)}:cafe`, account_tier_verified: verified,
});

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [], extension_sessions: [], community_ai_execution_metric_events: [], rpa_sessions: [] });
  mockDb.statusCheck.community_ai_actions = COMMUNITY_STATUS_VOCABULARY;
  claimCalls.length = 0;
});

const DM_CHAINS: Array<[string, any]> = [
  ['no chain (bare dm → continue_thread into the open thread)', null],
  ['open_thread → continue_thread', [{ action_type: 'open_thread', payload: { threadUrl: 'https://www.linkedin.com/messaging/thread/2-AAAAAAAAAAAAAAAA/' } }, { action_type: 'continue_thread', payload: { text: 'hello' } }]],
  ['start_new_dm', [{ action_type: 'start_new_dm', payload: { recipientHandle: 'someone', text: 'hello' } }]],
  ['continue_thread at index 1', [{ action_type: 'open_thread', payload: {} }, { action_type: 'continue_thread', payload: { text: 'hello' } }]],
];

describe('DM rows are refused before any claim (no authoritative recipient mapping)', () => {
  it.each(DM_CHAINS)('linkedin dm, %s → not offered, not claimed, failed not-acted', async (_l, chain) => {
    const r = row({ command_chain: chain, command_chain_index: _l.includes('index 1') ? 1 : 0 });
    mockDb.tables.community_ai_actions.push(r);
    const res = await poll();
    expect(res.statusCode).toBe(200);
    expect(res.body.commands).toHaveLength(0);
    expect(claimCalls).toHaveLength(0);
    const after = mockDb.tables.community_ai_actions[0];
    expect(after.status).toBe('failed');
    expect(after.dispatch_lease_id ?? null).toBeNull();
    expect(after.execution_result).toMatchObject({ error: 'DM_RECIPIENT_MAPPING_UNAVAILABLE', may_have_acted: false });
  });

  it('a direct_message row is refused the same way', async () => {
    mockDb.tables.community_ai_actions.push(row({ action_type: 'direct_message' }));
    const res = await poll();
    expect(res.body.commands).toHaveLength(0);
    expect(claimCalls).toHaveLength(0);
  });

  it('a DM command smuggled onto a NON-DM row (forged chain) is refused', async () => {
    mockDb.tables.community_ai_actions.push(row({ action_type: 'reply', command_chain: [{ action_type: 'start_new_dm', payload: { recipientHandle: 'x', text: 'y' } }] }));
    const res = await poll();
    expect(res.body.commands).toHaveLength(0);
    expect(claimCalls).toHaveLength(0);
  });

  it('read-only DM inbox sync is NOT a send and is still dispatched', async () => {
    mockDb.tables.community_ai_actions.push(row({ command_chain: [{ action_type: 'sync_dm_inbox', payload: {} }] }));
    const res = await poll();
    expect(res.body.commands).toHaveLength(1);
    expect(res.body.commands[0].action).toBe('sync_dm_inbox');
  });

  it('a comment reply is unaffected', async () => {
    mockDb.tables.community_ai_actions.push(row({ action_type: 'reply', target_id: 'urn:li:comment:1' }));
    const res = await poll();
    expect(res.body.commands).toHaveLength(1);
    expect(res.body.commands[0].action).toBe('reply_comment');
  });

  it('a row claimed meanwhile by another session is never failed by the refusal (compare-and-set on pending + unleased)', async () => {
    const r = row();
    mockDb.tables.community_ai_actions.push(r);
    // Simulate the race: the refusal persist sees a leased row.
    const origFrom = mockDb.from;
    mockDb.from = (t: string) => {
      const q = origFrom(t);
      if (t === 'community_ai_actions') {
        const origUpdate = q.update;
        q.update = (p: any) => { mockDb.tables.community_ai_actions[0].dispatch_lease_id = 'lease-other'; return origUpdate(p); };
      }
      return q;
    };
    await poll();
    mockDb.from = origFrom;
    expect(mockDb.tables.community_ai_actions[0].status).toBe('pending');
  });
});

describe('Instagram DM tier — server-verified only; client-declared tier ignored', () => {
  const igChain = [{ action_type: 'continue_thread', payload: { threadUrl: 'https://www.instagram.com/direct/t/123/', text: 'hello' } }];

  it.each([
    ['no RPA session', null],
    ['client-declared business tier (account_tier set, envelope NOT verified)', { account_tier: 'business', storage_state: verifiedEnvelope(false) }],
    ['client-declared tier on a plaintext session', { account_tier: 'business', storage_state: { account_tier_verified: true } }],
  ])('%s → INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED (gate applies to executor-built chains too)', async (_l, session) => {
    if (session) mockDb.tables.rpa_sessions.push({ organization_id: ORG, platform: 'instagram', ...session });
    mockDb.tables.community_ai_actions.push(row({
      platform: 'instagram', target_id: 'https://www.instagram.com/direct/t/123/', command_chain: igChain,
      metadata: { account_tier: 'business', account_tier_verified: true },
    }));
    const res = await poll();
    expect(res.body.commands).toHaveLength(0);
    expect(claimCalls).toHaveLength(0);
    expect(mockDb.tables.community_ai_actions[0].execution_result).toMatchObject({ error: 'INSTAGRAM_DM_ACCOUNT_TIER_UNVERIFIED', may_have_acted: false });
  });

  it('even a server-VERIFIED business tier does not send: the recipient mapping is still missing', async () => {
    mockDb.tables.rpa_sessions.push({ organization_id: ORG, platform: 'instagram', account_tier: 'business', storage_state: verifiedEnvelope(true) });
    mockDb.tables.community_ai_actions.push(row({ platform: 'instagram', target_id: 'https://www.instagram.com/direct/t/123/', command_chain: igChain }));
    const res = await poll();
    expect(res.body.commands).toHaveLength(0);
    expect(mockDb.tables.community_ai_actions[0].execution_result).toMatchObject({ error: 'DM_RECIPIENT_MAPPING_UNAVAILABLE' });
  });
});

describe('wouldDispatchDm — pure classification', () => {
  it.each([
    ['dm', 'continue_thread', true], ['dm', 'start_new_dm', true], ['dm', 'open_thread', true], ['dm', 'search_user', true],
    ['dm', null, true], ['DM', 'continue_thread', true], ['direct_message', 'continue_thread', true],
    ['dm', 'sync_dm_inbox', false], ['reply', 'reply_comment', false], ['like', 'like_message', false],
    ['reply', 'start_new_dm', true], ['reply', 'continue_thread', true], ['post_create', 'create_post', false],
  ])('(%s, %s) → %s', (top, cmd, expected) => {
    expect(wouldDispatchDm(top, cmd)).toBe(expected);
  });
});
