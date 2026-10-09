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
 */
import type { NextApiRequest } from 'next';
import inviteHandler from '../../../pages/api/users/invite';
import listHandler from '../../../pages/api/users/index';
import roleHandler from '../../../pages/api/users/[userId]/role';
import removeHandler from '../../../pages/api/users/[userId]/index';
import { logUserManagementAudit } from '../../services/campaignAuditService';
import { inviteUser } from '../../services/userManagementService';
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
jest.mock('../../services/campaignAuditService', () => ({
  ...jest.requireActual('../../services/campaignAuditService'),
  logUserManagementAudit: jest.fn(),
}));

const TARGET_A = 'trgt-a-00-0000-0000-00000000000a';
const TARGET_B = 'trgt-b-00-0000-0000-00000000000b';
const IDENTITY_TABLES = ['users', 'unified_persons', 'user_company_roles'];

const roleRow = (user_id: string, company_id: string, role: string, status = 'active') =>
  ({ user_id, company_id, role, status });

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
    it('Super admin can invite user', async () => {
      const res = await invoke(inviteHandler, {
        method: 'POST',
        as: 'SUPER',
        query: { companyId: CO_B },
        body: { email: 'New@Example.test', companyId: CO_B, role: 'CONTENT_MANAGER' },
      });

      expect(res.status).toBe(200);
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
      await invoke(inviteHandler, {
        method: 'POST',
        as: 'SUPER',
        query: { companyId: CO_A },
        body: { email: 'audit@example.test', companyId: CO_A, role: 'CONTENT_MANAGER' },
      });

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

      const outcome = await invoke(inviteHandler, {
        method: 'POST',
        as: 'SUPER',
        query: { companyId: CO_A },
        body: { email: 'identity-fail@example.test', companyId: CO_A, role: 'CONTENT_CREATOR' },
      }).then(
        (res) => ({ status: res.status as number | null }),
        () => ({ status: null as number | null }),
      );

      expect(outcome.status).not.toBe(200);
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
