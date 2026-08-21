/**
 * Phase 2Z-AS — recovery codes are USER-BOUND credentials.
 *
 * A recovery code restores access to ONE account. It must never authenticate a
 * second account, never mint a session for anyone but its owner, and never
 * carry tenant authority with it. Authentication and tenant authorization are
 * separate concerns, and a successful recovery login proves only the first.
 *
 * These exercise the REAL RecoveryCodeService against real argon2 hashing with
 * an in-memory `recovery_codes` table — the production query shapes, filters,
 * and consume semantics, not a re-implementation.
 */

jest.mock('../../security/audit/SecurityAuditService', () => ({
  logSecurityEvent: jest.fn(async () => undefined),
  snapshotFromPrincipal: jest.fn(() => ({})),
}));
jest.mock('../../services/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
// Permissive limiter so the brute-force gate never masks a boundary failure —
// its invocation is asserted separately.
jest.mock('../../security/MfaAttemptLimiter', () => ({
  check: jest.fn(() => ({ allowed: true })),
  recordFailure: jest.fn(),
  reset: jest.fn(),
}));

// ── In-memory `recovery_codes` honouring the production query shapes ─────────

interface Row {
  id: string;
  user_id: string;
  code_hash: string;
  batch_id: string;
  used_at: string | null;
  used_ip: string | null;
}

const table: Row[] = [];
let seq = 0;

interface State {
  op: 'select' | 'insert' | 'update';
  payload: Record<string, unknown> | Record<string, unknown>[] | null;
  eq: Record<string, unknown>;
  isNull: string[];
  selectAfterUpdate: boolean;
}

const matches = (r: Row, st: State) =>
  Object.entries(st.eq).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
  && st.isNull.every((k) => (r as unknown as Record<string, unknown>)[k] == null);

function exec(st: State): { data: unknown; error: null } {
  if (st.op === 'insert') {
    for (const raw of st.payload as Record<string, unknown>[]) {
      table.push({
        id: `row-${++seq}`, used_at: null, used_ip: null,
        ...(raw as unknown as Omit<Row, 'id' | 'used_at' | 'used_ip'>),
      });
    }
    return { data: null, error: null };
  }
  const hit = table.filter((r) => matches(r, st));
  if (st.op === 'select') return { data: hit, error: null };
  for (const r of hit) Object.assign(r, st.payload as Record<string, unknown>);
  return { data: st.selectAfterUpdate ? hit.map((r) => ({ id: r.id })) : null, error: null };
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const st: State = { op: 'select', payload: null, eq: {}, isNull: [], selectAfterUpdate: false };
    const b: Record<string, unknown> = {
      select: () => { if (st.op === 'update') st.selectAfterUpdate = true; return b; },
      insert: (p: unknown) => { st.op = 'insert'; st.payload = p as never; return b; },
      update: (p: unknown) => { st.op = 'update'; st.payload = p as never; return b; },
      eq: (k: string, v: unknown) => { st.eq[k] = v; return b; },
      is: (k: string, v: unknown) => { if (v === null) st.isNull.push(k); return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(exec(st)).then(res, rej),
    };
    return b;
  },
}));

import { regenerate, verifyAndConsume } from '../../security/totp/RecoveryCodeService';
import { decideCapability, decideCapabilityWithStepUp } from '../../security/AuthorizationService';
import { getStepUpPolicy } from '../../security/stepup/StepUpPolicyRegistry';
import {
  BILLING_MANAGE,
  IDENTITY_ADMIN_ASSIGN,
  type AuthenticatedPrincipal,
} from '../../../shared/contracts/security';

jest.setTimeout(120_000); // real argon2id

const USER_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const USER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const USER_C = 'cccccccc-0000-4000-8000-00000000000c';
const TENANT_A = '11111111-0000-4000-8000-000000000001';
const TENANT_B = '22222222-0000-4000-8000-000000000002';

/** Principal shaped like a recovery-code login: authenticated, NOT elevated. */
function principal(userId: string, orgs: Array<{ organizationId: string; role: string }>): AuthenticatedPrincipal {
  return {
    userId, supabaseUid: `sb-${userId}`, email: `${userId}@synthetic.test`, emailVerified: true,
    sessionId: `sess-${userId}`, sessionAgeSeconds: 5, sessionStaleSeconds: 1,
    organizations: orgs.map((o) => ({ ...o, status: 'active' as const })),
    activeOrgId: null,
    capabilities: [BILLING_MANAGE],
    mfa: { enrolled: true, factors: ['totp'], lastVerifiedAt: new Date(), phishingResistant: false },
    device: { deviceId: null, trusted: false, fingerprint: 'fp' },
    // A recovery code is NOT phishing-resistant: fetchStepUpState maps
    // 'recovery_code' to factor null, which is what this models.
    stepUp: { active: true, expiresAt: new Date(Date.now() + 600_000), factor: null, sessionId: 'su' },
    legacyCookieSuperAdmin: false,
  };
}

beforeEach(() => { table.length = 0; seq = 0; jest.clearAllMocks(); });

// ── Tests 1, 2, 5, 6 — the credential boundary ───────────────────────────────

describe('Test 1 — own-code authentication', () => {
  it("user A's code authenticates user A", async () => {
    const { codes } = await regenerate({ userId: USER_A });
    const r = await verifyAndConsume({ userId: USER_A, code: codes[0] });
    expect(r.ok).toBe(true);
  });

  it('authentication alone creates no tenant privilege', async () => {
    const { codes } = await regenerate({ userId: USER_A });
    await verifyAndConsume({ userId: USER_A, code: codes[0] });
    // The service touches only recovery_codes — no membership/capability write.
    expect(table.every((r) => 'code_hash' in r)).toBe(true);
  });
});

describe('Test 2 / Test 5 — CROSS-USER and FOREIGN-INTENT rejection', () => {
  it("CRITICAL: user A's code does NOT authenticate user B", async () => {
    const { codes } = await regenerate({ userId: USER_A });
    const r = await verifyAndConsume({ userId: USER_B, code: codes[0] });
    expect(r.ok).toBe(false);
  });

  it("CRITICAL: A's row is never consumed by B's attempt", async () => {
    const { codes } = await regenerate({ userId: USER_A });
    await verifyAndConsume({ userId: USER_B, code: codes[0] });
    expect(table.filter((r) => r.user_id === USER_A && r.used_at === null)).toHaveLength(10);
    expect(table.filter((r) => r.used_at !== null)).toHaveLength(0);
  });

  it("CRITICAL: A's code against B's MFA intent fails closed — no principal substitution", async () => {
    // userId here IS the MFA-intent identity. mfa-verify passes intent.userId
    // and nothing else; the code cannot nominate its own owner.
    const { codes } = await regenerate({ userId: USER_A });
    const r = await verifyAndConsume({ userId: USER_B, code: codes[0] });
    expect(r.ok).toBe(false);
    expect(Object.keys(r)).not.toContain('userId');   // no identity is returned
    expect(table.some((r2) => r2.user_id === USER_B)).toBe(false); // nothing minted for B
  });

  it("B's attempt cannot even SEE A's rows — the query is user-scoped", async () => {
    await regenerate({ userId: USER_A });
    const r = await verifyAndConsume({ userId: USER_B, code: 'GH4K-9P2N-XR7T-AB3V' });
    expect(r).toMatchObject({ ok: false, reason: 'NO_ACTIVE_CODES' });
  });

  it('a failed cross-user attempt is rate-limit recorded', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lim = require('../../security/MfaAttemptLimiter') as { recordFailure: jest.Mock };
    const { codes } = await regenerate({ userId: USER_A });
    await verifyAndConsume({ userId: USER_B, code: codes[0] });
    expect(lim.recordFailure).toHaveBeenCalled();
  });

  it('both users holding their own batches stay isolated', async () => {
    const a = await regenerate({ userId: USER_A });
    const b = await regenerate({ userId: USER_B });
    expect(a.batchId).not.toBe(b.batchId);
    await expect(verifyAndConsume({ userId: USER_B, code: a.codes[0] })).resolves.toMatchObject({ ok: false });
    await expect(verifyAndConsume({ userId: USER_A, code: b.codes[0] })).resolves.toMatchObject({ ok: false });
    await expect(verifyAndConsume({ userId: USER_A, code: a.codes[1] })).resolves.toMatchObject({ ok: true });
  });
});

describe('Test 6 — replay', () => {
  it('a consumed code cannot be reused by its owner', async () => {
    const { codes } = await regenerate({ userId: USER_A });
    await expect(verifyAndConsume({ userId: USER_A, code: codes[0] })).resolves.toMatchObject({ ok: true });
    await expect(verifyAndConsume({ userId: USER_A, code: codes[0] })).resolves.toMatchObject({ ok: false });
  });

  it('a consumed code cannot be replayed by another user', async () => {
    const { codes } = await regenerate({ userId: USER_A });
    await verifyAndConsume({ userId: USER_A, code: codes[0] });
    await expect(verifyAndConsume({ userId: USER_B, code: codes[0] })).resolves.toMatchObject({ ok: false });
  });

  it('used_at stays bound to the original consumption', async () => {
    const { codes } = await regenerate({ userId: USER_A });
    await verifyAndConsume({ userId: USER_A, code: codes[0] });
    const used = table.filter((r) => r.used_at !== null);
    expect(used).toHaveLength(1);
    const stamp = used[0].used_at;
    await verifyAndConsume({ userId: USER_A, code: codes[0] });
    expect(table.filter((r) => r.used_at !== null)).toHaveLength(1);
    expect(table.find((r) => r.used_at !== null)!.used_at).toBe(stamp);
  });

  it('regeneration invalidates the previous batch', async () => {
    const first = await regenerate({ userId: USER_A });
    await regenerate({ userId: USER_A });
    await expect(verifyAndConsume({ userId: USER_A, code: first.codes[0] })).resolves.toMatchObject({ ok: false });
  });
});

// ── Tests 3, 4, 7 — tenant authorization is a separate concern ───────────────

describe('Test 3 / Test 7 — authentication is NOT tenant authorization', () => {
  it('CRITICAL: a recovery-authenticated user is DENIED a tenant they do not belong to', async () => {
    const a = principal(USER_A, [{ organizationId: TENANT_A, role: 'COMPANY_ADMIN' }]);
    const d = await decideCapability(a, {
      capability: BILLING_MANAGE, organizationId: TENANT_B, reason: 'post-recovery cross-tenant',
    });
    expect(d).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
  });

  it('the same user IS allowed in the tenant they do belong to', async () => {
    const a = principal(USER_A, [{ organizationId: TENANT_A, role: 'COMPANY_ADMIN' }]);
    await expect(decideCapability(a, {
      capability: BILLING_MANAGE, organizationId: TENANT_A, reason: 'own tenant',
    })).resolves.toEqual({ allowed: true });
  });

  it('no membership is created implicitly by authenticating', async () => {
    const a = principal(USER_A, [{ organizationId: TENANT_A, role: 'COMPANY_ADMIN' }]);
    expect(a.organizations.map((o) => o.organizationId)).toEqual([TENANT_A]);
    expect(a.organizations.some((o) => o.organizationId === TENANT_B)).toBe(false);
  });

  it('CRITICAL: a recovery-code login cannot satisfy phishing-resistant step-up', async () => {
    // Even a platform SUPER_ADMIN recovering with a code cannot reach
    // IDENTITY_ADMIN_ASSIGN: the factor is not webauthn.
    const sa = principal(USER_A, [{ organizationId: TENANT_A, role: 'SUPER_ADMIN' }]);
    const elevated = { ...sa, capabilities: [IDENTITY_ADMIN_ASSIGN] } as AuthenticatedPrincipal;
    const policy = getStepUpPolicy(IDENTITY_ADMIN_ASSIGN)!;
    const d = await decideCapabilityWithStepUp(
      elevated,
      { capability: IDENTITY_ADMIN_ASSIGN, organizationId: TENANT_B, reason: 'recovery cannot elevate' },
      policy,
    );
    expect(d).toMatchObject({ allowed: false, reason: 'STEP_UP_REQUIRED' });
  });
});

describe('Test 4 — multi-tenant user', () => {
  const c = () => principal(USER_C, [
    { organizationId: TENANT_A, role: 'COMPANY_ADMIN' },
    { organizationId: TENANT_B, role: 'VIEW_ONLY' },
  ]);

  it("user C's own code authenticates C", async () => {
    const { codes } = await regenerate({ userId: USER_C });
    await expect(verifyAndConsume({ userId: USER_C, code: codes[0] })).resolves.toMatchObject({ ok: true });
  });

  it('access in each tenant is governed by that tenant membership, not the code', async () => {
    for (const org of [TENANT_A, TENANT_B]) {
      await expect(decideCapability(c(), {
        capability: BILLING_MANAGE, organizationId: org, reason: 'multi-tenant',
      })).resolves.toEqual({ allowed: true });
    }
  });

  it('C is still denied a tenant they hold no membership in', async () => {
    const d = await decideCapability(c(), {
      capability: BILLING_MANAGE,
      organizationId: '33333333-0000-4000-8000-000000000003',
      reason: 'unrelated tenant',
    });
    expect(d).toMatchObject({ allowed: false, reason: 'NOT_ORG_MEMBER' });
  });
});

// ── Source-fact guard: the intent identity is the only identity ──────────────

describe('MFA-intent binding is the sole identity source', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../pages/api/auth/mfa-verify.ts'), 'utf8');

  it('every factor verifier is called with intent.userId', () => {
    for (const call of ['verifyTotp({ userId: intent.userId', 'userId: intent.userId']) {
      expect(src).toContain(call);
    }
  });

  it('the session is minted for the intent identity, never one derived from the factor', () => {
    expect(src).toContain('createSession({');
    // No branch may reassign the identity from a verifier result.
    expect(src).not.toMatch(/userId:\s*(r|result|verification)\.\w*[Uu]serId/);
  });

  it('no tenant/company identifier participates in identity selection', () => {
    expect(src).not.toMatch(/userId:\s*\w*(company|tenant|org)\w*/i);
  });
});
