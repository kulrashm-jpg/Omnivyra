/**
 * e9/05 2026-11-13: normalizePermissionRole did no conditioning (no trim / case folding) and returned unmatched input
 * verbatim, while user_company_roles has NO role CHECK - so ' admin ', 'company admin' or 'CompanyAdmin' missed every
 * comparison. It now conditions exactly like normalizeRole; the mapping is unchanged.
 */
import { normalizePermissionRole, normalizeRole, Role } from '../../services/rbacPrimitives';

it.each([
  [' admin ', Role.COMPANY_ADMIN], ['Admin', Role.COMPANY_ADMIN], ['COMPANYADMIN', Role.COMPANY_ADMIN],
  ['company admin', Role.COMPANY_ADMIN], ['Company_Admin', Role.COMPANY_ADMIN], [' super_admin', Role.SUPER_ADMIN],
  ['content manager', Role.CONTENT_CREATOR], ['ContentPlanner', Role.CONTENT_CREATOR], ['content_planner', Role.CONTENT_CREATOR],
  ['viewer', Role.VIEW_ONLY], [' content_engager ', Role.VIEW_ONLY], ['VIEW_ONLY', Role.VIEW_ONLY],
])('%j -> %s', (raw, expected) => {
  expect(normalizePermissionRole(raw)).toBe(expected);
});

it('agrees with normalizeRole on every alias normalizeRole knows (same conditioning, same mapping)', () => {
  for (const raw of [' admin ', 'COMPANYADMIN', 'company admin', 'content_manager', 'CONTENTPLANNER', 'content planner', 'viewer', 'CONTENT_ENGAGER', 'SUPER_ADMIN', 'content_reviewer']) {
    expect(normalizePermissionRole(raw)).toBe(normalizeRole(raw));
  }
});

it('an unmatched value comes back CONDITIONED (not verbatim) and never matches a role by accident', () => {
  expect(normalizePermissionRole('  some role ')).toBe('SOME_ROLE');
  expect(Object.values(Role)).not.toContain(normalizePermissionRole('garbage'));
  expect(normalizePermissionRole('')).toBe('');
});
