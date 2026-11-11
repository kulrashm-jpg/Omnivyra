/**
 * Existence oracle (2026-11-11, non-blocking): duplicating ANOTHER tenant's
 * collection answered 403 "cross-tenant duplication denied", which confirmed
 * the id exists. It is now the same 404 as a missing id, and nothing is copied.
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const owners: Record<string, string> = { 'coll-a': CO_A, 'coll-b': CO_B };
const duplicateCollectionRecord = jest.fn(async () => ({ id: 'copy' }));

jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: 'u-a', defaultCompanyId: CO_A }),
  enforceCompanyAccess: async () => ({ userId: 'u-a' }),
}));
jest.mock('../../services/creator/collectionService', () => ({
  listCollections: jest.fn(async () => []),
  createCollectionRecord: jest.fn(),
  duplicateCollectionRecord: (...a: unknown[]) => (duplicateCollectionRecord as unknown as (...x: unknown[]) => unknown)(...a),
  getCollectionCompanyId: async (id: string) => owners[id] ?? null,
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/creator-templates/collections/index';

async function duplicate(id: string) {
  const res = { code: 0, body: {} as Record<string, unknown> };
  const r = {
    status: (c: number) => { res.code = c; return r; },
    json: (b: Record<string, unknown>) => { res.body = b; return r; },
    setHeader: () => r,
  };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'POST', query: {}, body: { company_id: CO_A, duplicate_of: id }, headers: {}, cookies: {} }, r);
  return res;
}

beforeEach(() => duplicateCollectionRecord.mockClear());

it("duplicating another tenant's collection is the SAME 404 as a missing one, and copies nothing", async () => {
  const theirs = await duplicate('coll-b');
  const missing = await duplicate('coll-missing');
  expect(theirs.code).toBe(404);
  expect([theirs.code, theirs.body]).toEqual([missing.code, missing.body]);
  expect(duplicateCollectionRecord).not.toHaveBeenCalled();
});

it('duplicating an own collection still works', async () => {
  expect((await duplicate('coll-a')).code).toBe(201);
  expect(duplicateCollectionRecord).toHaveBeenCalledTimes(1);
});
