/**
 * GOV-SECURITY condition: isTenantCompanyAdmin over REAL role rows (only the
 * database read is doubled; the role mapping is the production normalizeRole).
 */
const filters: Array<[string, unknown]> = [];
let response: { data: unknown; error: unknown; status: number } = { data: [], error: null, status: 200 };
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table !== 'user_company_roles') throw new Error(`unexpected table ${table}`);
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (k: string, v: unknown) => { filters.push([k, v]); return chain; };
    chain.limit = async () => response;
    return chain;
  },
}));
import { isTenantCompanyAdmin } from '../../services/compliance/tenantDataAck';

const USER = '00000000-0000-4000-8000-0000000000a1';
const ORG = '00000000-0000-4000-8000-0000000000aa';
const rows = (...roles: string[]) => ({ data: roles.map((role) => ({ role })), error: null, status: 200 });
beforeEach(() => { filters.length = 0; response = { data: [], error: null, status: 200 }; });

it('the read is THIS user, in THIS company, ACTIVE memberships only', async () => {
  response = rows('COMPANY_ADMIN');
  await isTenantCompanyAdmin(USER, ORG);
  expect(filters).toEqual([['user_id', USER], ['company_id', ORG], ['status', 'active']]);
});

it('COMPANY_ADMIN -> true; legacy "admin" / "ADMIN" normalise to COMPANY_ADMIN -> true', async () => {
  for (const r of ['COMPANY_ADMIN', 'admin', 'ADMIN', 'company admin']) {
    response = rows(r);
    expect(await isTenantCompanyAdmin(USER, ORG)).toBe(true);
  }
});

it('a SUPER_ADMIN row alone -> false (a platform operator does not accept for a tenant)', async () => {
  response = rows('SUPER_ADMIN');
  expect(await isTenantCompanyAdmin(USER, ORG)).toBe(false);
});

it('non-admin roles -> false', async () => {
  for (const r of ['CONTENT_CREATOR', 'VIEWER', 'CONTENT_REVIEWER', 'unknown_role']) {
    response = rows(r);
    expect(await isTenantCompanyAdmin(USER, ORG)).toBe(false);
  }
});

it('COMPANY_ADMIN of ANOTHER company -> false: no row matches this company (the company filter is part of the query)', async () => {
  // The database answers per (user, company, active); an admin row for another
  // company is not returned for THIS company's query, so the answer is empty.
  response = rows();
  expect(await isTenantCompanyAdmin(USER, ORG)).toBe(false);
  expect(filters).toContainEqual(['company_id', ORG]);
});

it('an unreadable role is NULL, never false and never true (204 and errors are not answers)', async () => {
  for (const r of [{ data: null, error: null, status: 204 }, { data: null, error: { code: 'x' }, status: 500 }, { data: {}, error: null, status: 200 }]) {
    response = r;
    expect(await isTenantCompanyAdmin(USER, ORG)).toBeNull();
  }
});
