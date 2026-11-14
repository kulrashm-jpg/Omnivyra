/**
 * e9 2026-11-14: getActiveCompanyRole is the canonical name; getCompanyRoleIncludingInvited is a DEPRECATED alias
 * of the SAME function (its name contradicts its body: active memberships only). Pinned so the alias can never
 * drift into a second implementation before the mechanical call-site rename.
 */
import fs from 'fs';
import path from 'path';
import { getActiveCompanyRole, getCompanyRoleIncludingInvited } from '../../services/rbacPrimitives';

describe('getActiveCompanyRole / deprecated alias', () => {
  it('the alias IS the canonical function (one implementation)', () => {
    expect(getCompanyRoleIncludingInvited).toBe(getActiveCompanyRole);
  });
  it('the alias carries @deprecated and the body filters status = active', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/rbacPrimitives.ts'), 'utf8');
    expect(src).toMatch(/@deprecated Use getActiveCompanyRole[\s\S]*export const getCompanyRoleIncludingInvited = getActiveCompanyRole;/);
    const body = src.slice(src.indexOf('export const getActiveCompanyRole'), src.indexOf('@deprecated Use getActiveCompanyRole'));
    expect(body).toMatch(/\.eq\('status', 'active'\)/);
  });
});
