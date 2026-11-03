/**
 * L-3 — enforcement point 2: the recipient recheck in GET /api/extension/commands,
 * before a browser command is claimed. Browser dispatch and every command-chain
 * step bypass runExecution, so this is their only consent gate.
 */
export {}; // a module, so its names do not collide with other script-style test files

type Row = Record<string, any>;
const rows: Row[] = [];
const rpcCalls: Array<{ name: string; args: any }> = [];
const persisted: any[] = [];

function chain(table: string) {
  const api: any = {
    select() { return api; }, eq() { return api; }, is() { return api; }, or() { return api; },
    order() { return api; }, limit() { return api; }, in() { return api; },
    maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    then(res: (v: unknown) => unknown) { return Promise.resolve({ data: table === 'community_ai_actions' ? rows : [], error: null }).then(res); },
    update() { const u: any = { eq: () => u, is: () => u, select: () => Promise.resolve({ data: [], error: null }), then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) }; return u; },
    insert() { return Promise.resolve({ data: null, error: null }); },
  };
  return api;
}
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      return { data: [{ id: args.p_action_id, dispatch_lease_expires_at: new Date(Date.now() + 90_000).toISOString() }], error: null };
    },
  },
}));
jest.mock('@/backend/middleware/extensionAuthMiddleware', () => ({
  requireExtensionAuth: async () => ({ session: { userId: 'u1', orgId: 'org-l3', hmacNonce: 'n1', expiresAt: Date.now() + 3600_000 } }),
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('@/backend/services/engagementCapabilityMap', () => ({
  resolveEngagementCapability: () => ({ status: 'api_verified', mode: 'browser' }), CAPABILITY_MAP_VERSION: 'cap-v1',
}));
jest.mock('@/backend/services/extensionReliabilityService', () => ({ isCurrentlyDisabled: () => false, recordOutcome: () => undefined }));
jest.mock('@/backend/services/extensionCommandSchema', () => ({
  validateCommandPayload: (_p: string, _a: string, payload: unknown) => ({ ok: true, payload }), COMMAND_SCHEMA_VERSION: 1,
}));
jest.mock('@/backend/services/rpaWorker/rpaAccountTier', () => ({ resolveAccountTier: async () => null }));
jest.mock('@/backend/services/communityAiExecutionResultService', () => ({
  recordExecutionMetric: () => undefined,
  persistExecutionResult: async (x: any) => { persisted.push(x); return { ok: true }; },
}));
const mockRecheck = jest.fn();
jest.mock('@/backend/services/communityRecipientRecheck', () => ({
  ...jest.requireActual('../../services/communityRecipientRecheck'),
  recheckCommunityRecipient: (...a: any[]) => mockRecheck(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const commandsHandler = require('../../../pages/api/extension/commands').default;

function mockRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
const poll = async () => {
  const res = mockRes();
  await commandsHandler({ method: 'GET', url: '/api/extension/commands', query: {}, headers: { 'x-omnivyra-capability-version': 'cap-v1', 'x-omnivyra-dispatch-renewal': '1' } }, res);
  return res;
};
const pending = (over: Row = {}): Row => ({
  id: 'act-1', organization_id: 'org-l3', platform: 'linkedin', action_type: 'reply',
  target_id: 'urn:li:comment:(urn:li:activity:1,2)', discovered_user_id: null, suggested_text: 'Thanks!',
  execution_mode: 'browser', status: 'pending', created_at: new Date().toISOString(),
  dispatch_lease_expires_at: null, execution_correlation_id: 'corr-1', command_chain: null, command_chain_index: 0, ...over,
});

beforeEach(() => { rows.length = 0; rpcCalls.length = 0; persisted.length = 0; mockRecheck.mockReset(); });

it('an opted-out recipient: the command is never claimed or offered, and the refusal is recorded terminally', async () => {
  rows.push(pending());
  mockRecheck.mockResolvedValue({ ok: false, code: 'RECIPIENT_RESTRICTED', reason: 'do not engage (linkedin)' });
  const res = await poll();
  expect(res.statusCode).toBe(200);
  expect(res.body.commands).toEqual([]);
  expect(rpcCalls.filter((c) => c.name === 'claim_community_ai_browser_command')).toEqual([]);
  expect(persisted).toHaveLength(1);
  expect(persisted[0]).toMatchObject({
    actionId: 'act-1', expectedFromStatuses: ['pending'], requireUnleased: true,
    result: { ok: false, status: 'skipped', error: 'RECIPIENT_RESTRICTED', may_have_acted: false },
  });
  expect(mockRecheck.mock.calls[0][0]).toMatchObject({ id: 'act-1', organization_id: 'org-l3', platform: 'linkedin', target_id: 'urn:li:comment:(urn:li:activity:1,2)' });
});

it('an unidentified recipient is refused the same way (L3-2)', async () => {
  rows.push(pending());
  mockRecheck.mockResolvedValue({ ok: false, code: 'RECIPIENT_UNRESOLVED', reason: 'no recipient' });
  const res = await poll();
  expect(res.body.commands).toEqual([]);
  expect(rpcCalls).toEqual([]);
  expect(persisted[0].result.error).toBe('RECIPIENT_UNRESOLVED');
});

it('an unreadable consent state leaves the row unclaimed and NOT terminal (it is retried on a later poll)', async () => {
  rows.push(pending());
  mockRecheck.mockResolvedValue({ ok: false, code: 'RECIPIENT_STATE_UNREADABLE', reason: 'read failed' });
  const res = await poll();
  expect(res.body.commands).toEqual([]);
  expect(rpcCalls).toEqual([]);
  expect(persisted).toEqual([]);
});

it('a command-chain step is rechecked too', async () => {
  rows.push(pending({ action_type: 'like', command_chain: [{ action_type: 'like', payload: { postUrn: 'urn:li:activity:1' } }], command_chain_index: 0 }));
  mockRecheck.mockResolvedValue({ ok: false, code: 'RECIPIENT_RESTRICTED', reason: 'blocked' });
  const res = await poll();
  expect(mockRecheck).toHaveBeenCalledTimes(1);
  expect(res.body.commands).toEqual([]);
});

it('positive control: an allowed recipient is claimed and offered', async () => {
  rows.push(pending());
  mockRecheck.mockResolvedValue({ ok: true, basis: 'recipient_allowed', recipient: { platform: 'linkedin', platformUserId: 'li-1', personId: null } });
  const res = await poll();
  expect(rpcCalls.map((c) => c.name)).toEqual(['claim_community_ai_browser_command']);
  expect(res.body.commands.map((c: any) => c.id)).toEqual(['act-1']);
  expect(persisted).toEqual([]);
});
