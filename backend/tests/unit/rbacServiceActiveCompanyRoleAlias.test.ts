/**
 * e9 2026-11-14: rbacService re-exports getActiveCompanyRole - the same function as getCompanyRoleIncludingInvited
 * (whose body returns ACTIVE memberships only), so 55 can move call sites and by-name mocks without behaviour change.
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no db'); } } }));

import * as rbacService from '../../services/rbacService';
import * as rbacPrimitives from '../../services/rbacPrimitives';

it('getActiveCompanyRole is the identical function (an alias, not a second implementation)', () => {
  expect(typeof rbacService.getActiveCompanyRole).toBe('function');
  expect(rbacService.getActiveCompanyRole).toBe(rbacPrimitives.getCompanyRoleIncludingInvited);
  expect(rbacService.getCompanyRoleIncludingInvited).toBe(rbacPrimitives.getCompanyRoleIncludingInvited);
});
