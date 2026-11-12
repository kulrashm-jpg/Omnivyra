/**
 * 05 (2026-11-12): an ORDINAL guard fails OPEN on an unknown role - `undefined < n`
 * is false, so `if (RANK[role] < RANK.editor) throw` lets a role missing from the
 * map through. groundingAccess has no production caller today; this pins the
 * fail-closed form so a future caller passing a tenant Role string is refused.
 */
import { assertCanWrite, AuthorizationError } from '../../services/companyProfile/grounding/groundingAccess';

const ctx = (role: string) => ({ userId: 'u1', memberships: [{ companyId: 'co1', role: role as any }] });

it('an UNKNOWN role (e.g. a tenant Role string) is REFUSED write, never granted', () => {
  for (const r of ['CONTENT_MANAGER', 'COMPANY_ADMIN', 'nope', '']) {
    expect(() => assertCanWrite(ctx(r), 'co1')).toThrow(AuthorizationError);
  }
});

it('controls: viewer refused; editor and admin allowed', () => {
  expect(() => assertCanWrite(ctx('viewer'), 'co1')).toThrow(AuthorizationError);
  expect(assertCanWrite(ctx('editor'), 'co1')).toBe('editor');
  expect(assertCanWrite(ctx('admin'), 'co1')).toBe('admin');
});
