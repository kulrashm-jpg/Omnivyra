/**
 * User lifecycle management — /api/users/* against the REAL authorization chain.
 *
 * Only the database and the identity provider are faked (routeAuthHarness).
 * withRBAC, enforceRole, getUserRole, isSuperAdmin, resolveUserContext and
 * userManagementService.requireUserAdminAccess all run for real, so the
 * authorization assertions below exercise production code. The previous
 * version of this suite re-implemented enforceRole/getUserRole/isSuperAdmin
 * inside the test, so its authorization assertions only tested the mock.
 *
 * Invariants covered:
 *  - only an ACTIVE super admin bypasses company scope;
 *  - a cross-company request is rejected and writes nothing;
 *  - a non-admin role is rejected and writes nothing;
 *  - the service re-checks the company the request actually acts on
 *    (body.companyId), independently of the company withRBAC authorized;
 *  - identity creation fails closed: no users / user_company_roles row is
 *    written when the unified_persons step fails.
 *
 * POLICY PENDING (COMPANY_ADMIN): the routes allow [SUPER_ADMIN, ADMIN], but
 * getUserRole normalizes ADMIN and COMPANY_ADMIN rows to COMPANY_ADMIN, so a
 * company admin is rejected (403 FORBIDDEN_ROLE) even in its own company. The
 * tests in "COMPANY_ADMIN in its own company" pin that CURRENT fail-closed
 * behaviour; they are not a statement of intended policy. Allowing company
 * admins must first add a role allowlist to invite / role update: today the
 * role is written verbatim from the request body, and an active SUPER_ADMIN
 * row in any company is platform super admin.
 *
 * Closure-015 (merged onto this suite):
 *  - POST /api/users/invite is RETIRED (015I, F-3): it stays behind withRBAC,
 *    answers 410 ENDPOINT_RETIRED and writes nothing. The invite behaviour this
 *    suite used to prove through the route is proven on inviteUser directly.
 *  - Role change (015E) and membership removal (015F) additionally require
 *    IDENTITY_ADMIN_ASSIGN / IDENTITY_ADMIN_DELETE via requireCapability
 *    (platform write authority + passkey step-up). That one gate is replaced
 *    by a recording mock here — the harness has no passkey/trusted-device
 *    model — and its real behaviour is pinned by the closure015e/015f suites.
 *    Everything before it (withRBAC, rate limit) and after it (service) runs
 *    for real, and this suite asserts which capability each route asks for and
 *    that a refusal writes nothing.
 */
import type { NextApiRequest } from 'next';
import inviteHandler from '../../../pages/api/users/invite';
import listHandler from '../../../pages/api/users/index';
import roleHandler from '../../../pages/api/users/[userId]/role';
import removeHandler from '../../../pages/api/users/[userId]/index';
import { logUserManagementAudit } from '../../services/campaignAuditService';
import { inviteUser } from '../../services/userManagementService';
import { requireCapability } from '../../security/requireCapability';
import { IDENTITY_ADMIN_ASSIGN, IDENTITY_ADMIN_DELETE } from '../../../shared/contracts/security';
import { resolveUserContext } from '../../services/userContextService';
import {
  seed, invoke, failTable, rows, writeCalls, CO_A, CO_B, USER_A, USER_B, USER_SUPER, TOKENS,
} from '../helpers/routeAuthHarness';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }) }));
jest.mock('../../security/requireCapability', () => ({
  requireCapability: jest.fn(async () => ({ ok: true, principal: { userId: 'test-actor' } })),
}));
jest.mock('../../services/campaignAuditService', () => ({
  ...jest.requireActual('../../services/campaignAuditService'),
  logUserManagementAudit: jest.fn(),
}));

const TARGET_A = 'trgt-a-00-0000-0000-00000000000a';
const TARGET_B = 'trgt-b-00-0000-0000-00000000000b';
const IDENTITY_TABLES = ['users', 'unified_persons', 'user_company_roles'];

const roleRow = (user_id: string, company_id: string, role: string, status = 'active') =>
  ({ id: `ucr-${user_id}-${company_id}`, user_id, company_id, role, status });

const requireCapabilityMock = requireCapability as jest.MockedFunction<typeof requireCapability>;
const superRequester = () => resolveUserContext({
  headers: { authorization: `Bearer ${TOKENS.SUPER}` },
} as unknown as NextApiRequest);

describe('User lifecycle management (real authorization chain)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed({
      users: [
        { id: TARGET_A, email: 'target-a@example.test' },
        { id: TARGET_B, email: 'target-b@example.test' },
      ],
      user_company_roles: [
        roleRow(TARGET_A, CO_A, 'CONTENT_CREATOR'),
        roleRow(TARGET_B, CO_B, 'CONTENT_MANAGER'),
      ],
    });
  });

  describe('active super admin', () => {
    it('the retired invite route answers 410 and writes nothing, even for a super admin', async () => {
      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: 'SUPER',
        query: { companyId: CO_B },
        body: { email: 'New@Example.test', companyId: CO_B, role: 'CONTENT_MANAGER' },
      });

      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: 'ENDPOINT_RETIRED', replacement: '/api/admin/invite-user' });
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
      expect(logUserManagementAudit).not.toHaveBeenCalled();
    });

    it('Super admin can invite user (service)', async () => {
      const result = await inviteUser('New@Example.test', CO_B, 'CONTENT_MANAGER', await superRequester());

      expect(result).toMatchObject({ ok: true, role: 'CONTENT_MANAGER' });
      const person = rows('unified_persons').find((p) => p.primary_email === 'new@example.test');
      expect(person).toMatchObject({ company_id: CO_B });
      const user = rows('users').find((u) => u.email === 'new@example.test');
      expect(user).toMatchObject({ unified_person_id: person!.id });
      expect(rows('user_company_roles')).toContainEqual(
        expect.objectContaining({ user_id: user!.id, company_id: CO_B, role: 'CONTENT_MANAGER' }),
      );
    });

    it('Role update works', async () => {
      const res = await invoke(roleHandler, {
        method: 'PATCH',
        as: 'SUPER',
        query: { userId: TARGET_A },
        body: { role: 'CONTENT_MANAGER', companyId: CO_A },
      });

      expect(res.status).toBe(200);
      expect(rows('user_company_roles').find((r) => r.user_id === TARGET_A)?.role).toBe('CONTENT_MANAGER');
      expect(requireCapabilityMock).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.objectContaining({ capability: IDENTITY_ADMIN_ASSIGN, organizationId: CO_A, resourceId: TARGET_A }),
      );
    });

    it('a refused IDENTITY_ADMIN_ASSIGN gate writes nothing', async () => {
      requireCapabilityMock.mockImplementationOnce(async (_req, res) => {
        res.status(403).json({ error: 'STEP_UP_REQUIRED' });
        return { ok: false } as Awaited<ReturnType<typeof requireCapability>>;
      });

      const res = await invoke(roleHandler, {
        method: 'PATCH',
        as: 'SUPER',
        query: { userId: TARGET_A },
        body: { role: 'CONTENT_MANAGER', companyId: CO_A },
      });

      expect(res.status).toBe(403);
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
      expect(rows('user_company_roles').find((r) => r.user_id === TARGET_A)?.role).toBe('CONTENT_CREATOR');
    });

    it('Remove user works', async () => {
      const res = await invoke(removeHandler, {
        method: 'DELETE',
        as: 'SUPER',
        query: { userId: TARGET_A, companyId: CO_A },
      });

      expect(res.status).toBe(200);
      expect(rows('user_company_roles').some((r) => r.user_id === TARGET_A)).toBe(false);
      expect(rows('user_company_roles').some((r) => r.user_id === TARGET_B)).toBe(true);
      expect(requireCapabilityMock).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.objectContaining({ capability: IDENTITY_ADMIN_DELETE, resourceId: `${CO_A}:${TARGET_A}` }),
      );
    });

    it('List users scoped to company', async () => {
      const res = await invoke(listHandler, { method: 'GET', as: 'SUPER', query: { companyId: CO_A } });

      expect(res.status).toBe(200);
      const ids = (res.body?.users ?? []).map((u: { user_id: string }) => u.user_id);
      expect(ids).toEqual(expect.arrayContaining([USER_A, USER_SUPER, TARGET_A]));
      expect(ids).not.toContain(TARGET_B);
      expect(ids).not.toContain(USER_B);
    });

    it('Audit logs created', async () => {
      await inviteUser('audit@example.test', CO_A, 'CONTENT_MANAGER', await superRequester());

      expect(logUserManagementAudit).toHaveBeenCalledWith(
        'USER_INVITED',
        expect.objectContaining({ actor_user_id: USER_SUPER, company_id: CO_A, role: 'CONTENT_MANAGER' }),
      );
    });
  });

  describe('denials write nothing', () => {
    it('Admin cannot invite user in other company', async () => {
      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: 'A',
        query: { companyId: CO_B },
        body: { email: 'other@example.test', companyId: CO_B, role: 'CONTENT_CREATOR' },
      });

      expect(res.status).toBe(403);
      expect(res.body?.error).toBe('COMPANY_SCOPE_VIOLATION');
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
    });

    it('Content role cannot invite user (403)', async () => {
      seed({ user_company_roles: [roleRow(USER_B, CO_A, 'CONTENT_CREATOR')] });

      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: 'B',
        query: { companyId: CO_A },
        body: { email: 'blocked@example.test', companyId: CO_A, role: 'CONTENT_PLANNER' },
      });

      expect(res.status).toBe(403);
      expect(res.body?.error).toBe('FORBIDDEN_ROLE');
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
    });

    it('an inactive SUPER_ADMIN row grants no cross-company access', async () => {
      seed({ user_company_roles: [roleRow(USER_B, CO_B, 'SUPER_ADMIN', 'inactive')] });

      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: 'B',
        query: { companyId: CO_A },
        body: { email: 'escalate@example.test', companyId: CO_A, role: 'COMPANY_ADMIN' },
      });

      expect(res.status).toBe(403);
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
    });

    it('an unauthenticated request is rejected', async () => {
      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: null,
        query: { companyId: CO_A },
        body: { email: 'anon@example.test', companyId: CO_A, role: 'CONTENT_CREATOR' },
      });

      expect(res.status).toBe(401);
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
    });

    it('the service re-checks the company it acts on, not only the one withRBAC authorized', async () => {
      const requester = await resolveUserContext({
        headers: { authorization: `Bearer ${TOKENS.A}` },
      } as unknown as NextApiRequest);

      const result = await inviteUser('mismatch@example.test', CO_B, 'CONTENT_CREATOR', requester);

      expect(result).toEqual({ ok: false, status: 403, error: 'COMPANY_SCOPE_VIOLATION' });
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
    });
  });

  describe('identity creation', () => {
    it('fails closed: no user or role row is written when unified_persons fails', async () => {
      failTable('unified_persons');
      const requester = await superRequester();

      // The route is retired (410), so the identity-creation path is exercised on the service.
      const outcome = await inviteUser('identity-fail@example.test', CO_A, 'CONTENT_CREATOR', requester).then(
        (result) => ({ ok: result.ok as boolean | null }),
        () => ({ ok: null as boolean | null }),
      );

      expect(outcome.ok).not.toBe(true);
      expect(writeCalls(['users', 'user_company_roles'])).toEqual([]);
      expect(rows('users').some((u) => u.email === 'identity-fail@example.test')).toBe(false);
      expect(logUserManagementAudit).not.toHaveBeenCalled();
    });
  });

  describe('COMPANY_ADMIN in its own company (policy pending — current fail-closed behaviour)', () => {
    it('Admin can invite user in own company: currently rejected with FORBIDDEN_ROLE', async () => {
      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: 'A',
        query: { companyId: CO_A },
        body: { email: 'own@example.test', companyId: CO_A, role: 'CONTENT_CREATOR' },
      });

      expect(res.status).toBe(403);
      expect(res.body?.error).toBe('FORBIDDEN_ROLE');
      expect(writeCalls(IDENTITY_TABLES)).toEqual([]);
    });

    it('listing its own company: currently rejected with FORBIDDEN_ROLE', async () => {
      const res = await invoke(listHandler, { method: 'GET', as: 'A', query: { companyId: CO_A } });

      expect(res.status).toBe(403);
      expect(res.body?.error).toBe('FORBIDDEN_ROLE');
    });
  });
});
