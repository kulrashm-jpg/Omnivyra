/**
 * Prompt 3 — the community approve route (OD-1, LD-8).
 *
 *   begin   → a 48-byte challenge bound to (approver, tenant, action, content) in the
 *             community_action passkey domain; nothing is written.
 *   approve → verify → redeem → one CAS UPDATE carrying the evidence; the 'approved'
 *             log row records the approved_at the DATABASE returned.
 *   No passkey → 401 PASSKEY_REQUIRED. requires_human_approval=false no longer refuses.
 *   Expired or evidence-less approvals are re-approvable; a current one is idempotent.
 */

import { createFakeDb, type FakeDb } from './helpers/communityExecutionFakeDb';

const SERVER_APPROVED_AT = '2026-11-05T08:00:00.123456+00:00';
let mockDb: FakeDb = createFakeDb();
/** Mirrors the server-stamp trigger: any approved_at written is replaced by the DB clock. */
let mockFailLogInsert = false;
const stampingFrom = (t: string) => {
  const q = mockDb.from(t);
  if (t === 'community_ai_action_logs' && mockFailLogInsert) {
    q.insert = () => Promise.resolve({ data: null, error: { code: '23514', message: 'secret-ish detail' } });
    return q;
  }
  if (t !== 'community_ai_actions') return q;
  const update = q.update.bind(q);
  q.update = (patch: Record<string, unknown>) =>
    update('approved_at' in patch && patch.approved_at ? { ...patch, approved_at: SERVER_APPROVED_AT } : patch);
  return q;
};
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => stampingFrom(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

let mockUser = '00000000-0000-4000-8000-0000000000a1';
jest.mock('../../../pages/api/community-ai/utils', () => ({
  requireTenantScope: async (req: any) => ({ tenantId: req.body.tenant_id, organizationId: req.body.organization_id }),
  enforceActionRole: async () => ({ userId: mockUser, role: 'COMPANY_ADMIN' }),
}));
jest.mock('../../services/rbac/communityAiCapabilities', () => ({ COMMUNITY_AI_CAPABILITIES: { APPROVE_ACTIONS: ['COMPANY_ADMIN'] } }));
const mockLogs: any[] = [];
jest.mock('../../services/communityAiActionLogService', () => ({
  logCommunityAiActionEvent: async (e: any) => { mockLogs.push(e); },
}));
jest.mock('../../services/telemetry/telemetryDispatcher', () => ({ trackEvent: () => undefined }));
jest.mock('../../services/requestAccessService', () => ({ requireAdminRateLimit: async () => true }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIpOrNull: () => null }));

const mockPk = { challenges: new Map<string, { userId: string | null; consumed: boolean }>() };
jest.mock('../../security/webauthn/WebAuthnAuthenticationService', () => ({
  beginAuthentication: async (input: { userId: string | null; challenge?: Uint8Array }) => {
    const challenge = Buffer.from(input.challenge as Uint8Array).toString('base64url');
    mockPk.challenges.set(challenge, { userId: input.userId, consumed: false });
    return { options: { challenge, rpId: 'test' } };
  },
  verifyAuthentication: async (input: { userId: string; response: { response: { clientDataJSON: string } } }) => {
    const challenge = JSON.parse(Buffer.from(input.response.response.clientDataJSON, 'base64url').toString('utf8')).challenge;
    const stored = mockPk.challenges.get(challenge);
    if (!stored) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'NOT_FOUND' };
    if (stored.consumed) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'ALREADY_CONSUMED' };
    if (stored.userId !== input.userId) return { ok: false, reason: 'CHALLENGE_REJECTED', detail: 'WRONG_USER_BINDING' };
    stored.consumed = true;
    return { ok: true, result: { userId: input.userId, credentialId: 'cred-1', verifiedAt: new Date() } };
  },
}));

import { communityApprovalBindingHash } from '../../services/communityApprovalBinding';
import { beginApprovalPasskey } from '../../services/leadOutreachExecution/approvalPasskey';

const handler = require('../../../pages/api/community-ai/actions/approve').default;

const ORG = '00000000-0000-4000-8000-0000000000b1';
const OTHER_USER = '00000000-0000-4000-8000-0000000000a2';
const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  tenant_id: ORG,
  organization_id: ORG,
  platform: 'linkedin',
  action_type: 'reply',
  target_id: 'urn:li:comment:1',
  suggested_text: 'Thanks for sharing',
  playbook_id: 'pb-1',
  discovered_user_id: null,
  status: 'pending',
  requires_human_approval: true,
  approved_at: null,
  approved_by: null,
  approved_content_hash: null,
  passkey_credential_id: null,
  passkey_verified_at: null,
  dispatch_lease_id: null,
  ...over,
});
const ACTION_ID = row().id as string;

const mockRes = () => {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
};
const call = async (body: Record<string, unknown>) => {
  const res = mockRes();
  await handler({ method: 'POST', body: { tenant_id: ORG, organization_id: ORG, action_id: ACTION_ID, ...body }, headers: {}, query: {} }, res);
  return res;
};
const assertion = (challenge: string) => ({
  id: 'cred-1', rawId: 'cred-1', type: 'public-key',
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge })).toString('base64url'), signature: 'valid', authenticatorData: 'x' },
  clientExtensionResults: {},
});
const stored = () => mockDb.tables.community_ai_actions[0];
const begin = async () => {
  const res = await call({ phase: 'begin' });
  expect(res.statusCode).toBe(200);
  return { challenge: String(res.body.passkey_options.challenge), hash: String(res.body.content_hash) };
};

beforeEach(() => {
  mockDb = createFakeDb({ community_ai_actions: [row()] });
  mockLogs.length = 0;
  mockFailLogInsert = false;
  mockPk.challenges.clear();
  mockUser = '00000000-0000-4000-8000-0000000000a1';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('community approve — begin phase', () => {
  it('issues a 48-byte challenge bound to the stored content; writes nothing', async () => {
    const { challenge, hash } = await begin();
    expect(Buffer.from(challenge, 'base64url')).toHaveLength(48);
    const expected = communityApprovalBindingHash(row() as any);
    expect(expected.ok && expected.hash).toBe(hash);
    expect(mockDb.ops.filter((o) => o.op !== 'select')).toEqual([]);
    expect(stored().status).toBe('pending');
  });
});

describe('community approve — approve phase', () => {
  it('the approved event cannot be written → 500 APPROVAL_RECORD_FAILED (code only logged); the row stays re-approvable', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockFailLogInsert = true;
    const first = await begin();
    const res = await call({ passkey: assertion(first.challenge) });
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'APPROVAL_RECORD_FAILED', code: 'APPROVAL_RECORD_FAILED' });
    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).toContain('APPROVAL_RECORD_FAILED');
    expect(logged).not.toContain('secret-ish');
    expect(logged).not.toContain(ACTION_ID);
    expect(mockDb.tables.community_ai_action_logs ?? []).toHaveLength(0);

    // The approver retries: the evidence-without-event row is not "current", so it re-approves.
    mockFailLogInsert = false;
    expect((await call({})).statusCode).toBe(401);
    const second = await begin();
    const retry = await call({ passkey: assertion(second.challenge) });
    expect(retry.statusCode).toBe(200);
    const approved = (mockDb.tables.community_ai_action_logs ?? []).filter((l) => l.event_type === 'approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].event_payload).toMatchObject({ user_id: mockUser, reapproval: true });
  });

  it('no passkey → 401 PASSKEY_REQUIRED, row unchanged', async () => {
    const res = await call({});
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: 'PASSKEY_REQUIRED', code: 'passkey_required' });
    expect(stored()).toMatchObject({ status: 'pending', approved_at: null });
  });

  it('begin → verify → redeem → CAS: evidence persisted, the server approved_at logged', async () => {
    const { challenge, hash } = await begin();
    const res = await call({ passkey: assertion(challenge), expected_content_hash: hash });
    expect(res.statusCode).toBe(200);
    expect(stored()).toMatchObject({
      status: 'approved',
      approved_at: SERVER_APPROVED_AT,
      approved_by: mockUser,
      approved_content_hash: hash,
      passkey_credential_id: 'cred-1',
    });
    expect(typeof stored().passkey_verified_at).toBe('string');
    const approved = (mockDb.tables.community_ai_action_logs ?? []).filter((l) => l.event_type === 'approved');
    expect(approved).toHaveLength(1);
    // The DB's value at ms precision, as the claim's log match formats it.
    expect(approved[0].event_payload).toMatchObject({ user_id: mockUser, timestamp: '2026-11-05T08:00:00.123Z', approved_content_hash: hash });
  });

  it('an assertion is single use: replayed against a re-pended row it is refused', async () => {
    const { challenge } = await begin();
    expect((await call({ passkey: assertion(challenge) })).statusCode).toBe(200);
    // Force the row back to approvable (legacy-shaped), then replay the same assertion.
    Object.assign(stored(), { passkey_credential_id: null });
    const res = await call({ passkey: assertion(challenge) });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('passkey_replayed');
  });

  it('an outreach-domain challenge (no subject) never approves a community action', async () => {
    const h = communityApprovalBindingHash(row() as any);
    const opts = await beginApprovalPasskey({ userId: mockUser, organizationId: ORG, taskId: ACTION_ID, action: 'approve', bindingHash: (h as any).hash });
    const res = await call({ passkey: assertion(String(opts.challenge)) });
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('passkey_wrong_binding');
    expect(stored().status).toBe('pending');
  });

  it('a challenge begun by another approver is refused', async () => {
    const { challenge } = await begin();
    mockUser = OTHER_USER;
    const res = await call({ passkey: assertion(challenge) });
    expect(res.statusCode).toBe(401);
    expect(stored().status).toBe('pending');
  });

  it('content changed after begin → 409 APPROVAL_STALE before the passkey is spent', async () => {
    const { challenge, hash } = await begin();
    Object.assign(stored(), { suggested_text: 'edited' });
    const res = await call({ passkey: assertion(challenge), expected_content_hash: hash });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('APPROVAL_STALE');
    expect([...mockPk.challenges.values()].every((c) => !c.consumed)).toBe(true);
  });

  it('LD-8: requires_human_approval=false no longer refuses (APPROVAL_NOT_REQUIRED is gone)', async () => {
    mockDb = createFakeDb({ community_ai_actions: [row({ requires_human_approval: false })] });
    const { challenge } = await begin();
    const res = await call({ passkey: assertion(challenge) });
    expect(res.statusCode).toBe(200);
    expect(stored().status).toBe('approved');
  });

  it('LD-8: a legacy approval with no evidence is re-approvable, and gets new evidence', async () => {
    mockDb = createFakeDb({ community_ai_actions: [row({ status: 'approved', approved_at: '2026-10-30T00:00:00.000Z', approved_by: OTHER_USER })] });
    const { challenge, hash } = await begin();
    const res = await call({ passkey: assertion(challenge) });
    expect(res.statusCode).toBe(200);
    expect(stored()).toMatchObject({ status: 'approved', approved_at: SERVER_APPROVED_AT, approved_by: mockUser, approved_content_hash: hash });
  });

  it('LD-8: an expired evidenced approval is re-approvable', async () => {
    const h = (communityApprovalBindingHash(row() as any) as any).hash;
    mockDb = createFakeDb({ community_ai_actions: [row({
      status: 'approved', approved_at: '2026-10-01T00:00:00.000Z', approved_by: OTHER_USER,
      approved_content_hash: h, passkey_credential_id: 'old', passkey_verified_at: '2026-10-01T00:00:00.000Z',
    })] });
    const { challenge } = await begin();
    expect((await call({ passkey: assertion(challenge) })).statusCode).toBe(200);
    expect(stored()).toMatchObject({ approved_by: mockUser, passkey_credential_id: 'cred-1' });
  });

  it('a current evidenced approval is returned idempotently and never rewritten', async () => {
    const h = (communityApprovalBindingHash(row() as any) as any).hash;
    const now = new Date().toISOString();
    mockDb = createFakeDb({
      community_ai_actions: [row({
        status: 'approved', approved_at: now, approved_by: OTHER_USER,
        approved_content_hash: h, passkey_credential_id: 'old', passkey_verified_at: now,
      })],
      community_ai_action_logs: [{
        action_id: ACTION_ID, tenant_id: ORG, organization_id: ORG, event_type: 'approved',
        event_payload: { user_id: OTHER_USER, timestamp: now },
      }],
    });
    const res = await call({});
    expect(res.statusCode).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(stored()).toMatchObject({ approved_by: OTHER_USER, passkey_credential_id: 'old' });
    expect(mockDb.ops.filter((o) => o.op === 'update')).toEqual([]);
  });

  it('an evidenced approval whose approved log row is missing (never claimable) is re-approvable', async () => {
    const h = (communityApprovalBindingHash(row() as any) as any).hash;
    const now = new Date().toISOString();
    mockDb = createFakeDb({ community_ai_actions: [row({
      status: 'approved', approved_at: now, approved_by: OTHER_USER,
      approved_content_hash: h, passkey_credential_id: 'old', passkey_verified_at: now,
    })] });
    expect((await call({})).statusCode).toBe(401);
    const { challenge } = await begin();
    expect((await call({ passkey: assertion(challenge) })).statusCode).toBe(200);
    expect(stored()).toMatchObject({ approved_by: mockUser, passkey_credential_id: 'cred-1' });
  });

  it('a browser row awaiting the extension stays pending when re-approved', async () => {
    mockDb = createFakeDb({ community_ai_actions: [row({ status: 'pending', approved_at: '2026-10-30T00:00:00.000Z', approved_by: OTHER_USER })] });
    const { challenge } = await begin();
    expect((await call({ passkey: assertion(challenge) })).statusCode).toBe(200);
    expect(stored()).toMatchObject({ status: 'pending', approved_by: mockUser });
  });

  it('a terminal row is not approvable', async () => {
    mockDb = createFakeDb({ community_ai_actions: [row({ status: 'executed' })] });
    const res = await call({ phase: 'begin' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('ACTION_NOT_PENDING');
  });

  it('another tenant\'s row → 403 TENANT_SCOPE_VIOLATION', async () => {
    const other = '00000000-0000-4000-8000-0000000000b9';
    mockDb = createFakeDb({ community_ai_actions: [row({ tenant_id: other, organization_id: other })] });
    const res = await call({ phase: 'begin' });
    expect(res.statusCode).toBe(403);
  });

  it('an unknown phase is refused', async () => {
    expect((await call({ phase: 'skip' })).statusCode).toBe(400);
  });
});
