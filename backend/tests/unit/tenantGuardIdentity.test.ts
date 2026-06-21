/**
 * TenantGuard — deterministic-identity vs transient-infra error classification.
 * Regression coverage for the tenant-hardening fix: non-uuid principals must
 * reach NOT_A_MEMBER (→ fallbacks), while genuine infra failures stay
 * TENANT_LOOKUP_ERROR. Fully mocked — no production data.
 */

// ── Mocks (paths relative to this test file) ─────────────────────────────────
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: jest.fn().mockResolvedValue(false) }));
jest.mock('../../services/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('../../security/IdentityResolver', () => ({ resolvePrincipal: jest.fn() }));
jest.mock('../../security/audit/SecurityAuditService', () => ({ logSecurityEvent: jest.fn() }));
jest.mock('../../services/requestContext', () => ({ seedRequestContextFromRequest: jest.fn() }));

import { assertTenantAccess, isDeterministicIdentityError } from '../../security/TenantGuard';
import { supabase } from '../../db/supabaseClient';
import { isPlatformSuperAdmin } from '../../services/rbacService';

const UUID = '11111111-1111-1111-1111-111111111111';
const ORG = '22222222-2222-2222-2222-222222222222';

type Result = { data: any; error: any };
function chain(result: Result) {
  const p: any = {};
  p.select = () => p; p.eq = () => p; p.limit = () => p;
  p.maybeSingle = () => Promise.resolve(result);
  return p;
}
function mockReads(roleResult: Result, orgResult: Result = { data: { id: ORG, status: 'active' }, error: null }) {
  (supabase.from as jest.Mock).mockImplementation((table: string) =>
    table === 'companies' ? chain(orgResult) : chain(roleResult),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (isPlatformSuperAdmin as jest.Mock).mockResolvedValue(false);
});

describe('isDeterministicIdentityError', () => {
  it('true for uuid syntax (22P02 / message) and 22023', () => {
    expect(isDeterministicIdentityError({ code: '22P02', message: 'invalid input syntax for type uuid: "content_architect"' })).toBe(true);
    expect(isDeterministicIdentityError({ code: '22023', message: 'invalid_parameter_value' })).toBe(true);
    expect(isDeterministicIdentityError({ message: 'invalid input syntax for type uuid: "x"' })).toBe(true);
    expect(isDeterministicIdentityError({ message: 'invalid uuid' })).toBe(true);
  });
  it('false for transient/infra + null', () => {
    expect(isDeterministicIdentityError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isDeterministicIdentityError({ message: 'fetch failed' })).toBe(false);
    expect(isDeterministicIdentityError({ message: 'connection terminated' })).toBe(false);
    expect(isDeterministicIdentityError(null)).toBe(false);
  });
});

describe('assertTenantAccess — identity vs infra classification', () => {
  it('UUID member (active row) → success', async () => {
    mockReads({ data: { role: 'COMPANY_ADMIN', status: 'active' }, error: null });
    const r = await assertTenantAccess({ userId: UUID, organizationId: ORG });
    expect(r.ok).toBe(true);
  });

  it('unknown UUID (no row, no error) → NOT_A_MEMBER', async () => {
    mockReads({ data: null, error: null });
    const r = await assertTenantAccess({ userId: UUID, organizationId: ORG });
    expect(r).toMatchObject({ ok: false, reason: 'NOT_A_MEMBER' });
  });

  it("content_architect (22P02 uuid error) → NOT_A_MEMBER (reaches fallback)", async () => {
    mockReads({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid: "content_architect"' } });
    const r = await assertTenantAccess({ userId: 'content_architect', organizationId: ORG });
    expect(r).toMatchObject({ ok: false, reason: 'NOT_A_MEMBER' });
  });

  it('invalid-uuid principal (message only) → NOT_A_MEMBER (reaches fallback)', async () => {
    mockReads({ data: null, error: { message: 'invalid input syntax for type uuid: "bridge:abc"' } });
    const r = await assertTenantAccess({ userId: 'bridge:abc', organizationId: ORG });
    expect(r).toMatchObject({ ok: false, reason: 'NOT_A_MEMBER' });
  });

  it('Supabase timeout → TENANT_LOOKUP_ERROR', async () => {
    mockReads({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    const r = await assertTenantAccess({ userId: UUID, organizationId: ORG });
    expect(r).toMatchObject({ ok: false, reason: 'TENANT_LOOKUP_ERROR' });
  });

  it('DB transport failure → TENANT_LOOKUP_ERROR', async () => {
    mockReads({ data: null, error: { message: 'fetch failed' } });
    const r = await assertTenantAccess({ userId: UUID, organizationId: ORG });
    expect(r).toMatchObject({ ok: false, reason: 'TENANT_LOOKUP_ERROR' });
  });
});
