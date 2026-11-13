/**
 * D2 (e1 2026-11-13): profile lists were UNION-merged on every save, so a user could never delete an item. A user
 * save may now name lists to REPLACE; AI saves keep the union; the route refuses a bulk removal unless confirmed
 * (05: more than 5 items, or more than half of the list - a single removal never needs confirmation).
 */
const mockSaveProfile = jest.fn(async (p: any) => p);
const mockExisting: { current: any } = { current: null };
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => mockExisting.current),
  saveProfile: (p: unknown) => mockSaveProfile(p),
  calculateCompanyProfileCompleteness: jest.fn(),
  toLimitedCompanyProfile: jest.fn(() => null),
  upsertCompanyProfileGovernanceSettings: jest.fn(() => ({})),
  getCompanyProfileReviewStatus: jest.fn(() => ({})),
}));
jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn(async () => ({ userId: 'u-1', role: 'COMPANY_ADMIN' })),
  isContentArchitectSession: jest.fn(() => false),
}));
jest.mock('../../db/supabaseClient', () => {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'or', 'neq']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return { supabase: { from: () => b } };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/company-profile/index';
import { buildSavePayload, assessListReplace, isBulkRemoval } from '../../services/companyProfile/savePayload';

const STORED = { company_id: 'c-1', goals: 'A, B, C', goals_list: ['A', 'B', 'C'], target_audience_list: ['X', 'Y'] } as any;
const NOW = '2026-11-13T00:00:00.000Z';

async function post(body: Record<string, unknown>) {
  const out = { code: 0, body: {} as any };
  const r = { status: (c: number) => { out.code = c; return r; }, json: (b: any) => { out.body = b; return r; }, setHeader: () => r, getHeader: () => undefined };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'POST', query: { companyId: 'c-1' }, body: { companyId: 'c-1', ...body }, headers: {}, cookies: {} }, r);
  return out;
}

beforeEach(() => { mockSaveProfile.mockClear(); mockExisting.current = { ...STORED }; });

describe('buildSavePayload list rules', () => {
  it('without replace_lists a list is the UNION (unchanged: nothing ever dropped)', () => {
    const p = buildSavePayload({ goals_list: ['A'] } as any, STORED, 'c-1', 'user', null, NOW, 0);
    expect(p.goals_list).toEqual(['A', 'B', 'C']);
  });
  it('a USER save that names a list REPLACES it (an item can be deleted; dedup kept)', () => {
    const p = buildSavePayload({ goals_list: ['A', 'C', 'a'], replace_lists: ['goals_list'] } as any, STORED, 'c-1', 'user', null, NOW, 0);
    expect(p.goals_list).toEqual(['a', 'C']);
    expect(p.target_audience_list).toEqual(['X', 'Y']); // a list not named keeps the union
  });
  it('an AI save (ai_refined) never replaces, even if replace_lists is present', () => {
    const p = buildSavePayload({ goals_list: ['A'], replace_lists: ['goals_list'] } as any, STORED, 'c-1', 'ai_refined', NOW, NOW, 0);
    expect(p.goals_list).toEqual(['A', 'B', 'C']);
  });
  it('replace_lists is never a persisted column', () => {
    const p = buildSavePayload({ goals_list: ['A'], replace_lists: ['goals_list'] } as any, STORED, 'c-1', 'user', null, NOW, 0);
    expect(p).not.toHaveProperty('replace_lists');
  });
});

describe('bulk-removal rule', () => {
  it.each([
    [3, 1, false], [2, 1, false], [1, 1, false], // a single removal never needs confirmation
    [3, 2, true], [4, 2, false], [10, 5, false], [10, 6, true], [20, 6, true],
  ])('stored %i, removed %i -> bulk %s', (stored, removed, bulk) => {
    expect(isBulkRemoval(stored, removed)).toBe(bulk);
  });
  it('assessListReplace compares against the STORED list case-insensitively', () => {
    expect(assessListReplace(STORED, { replace_lists: ['goals_list'], goals_list: ['a', 'b'] })).toEqual([
      { field: 'goals_list', stored: 3, removed: ['C'], bulk: false },
    ]);
  });
});

describe('POST /api/company-profile with replace_lists', () => {
  it('a single deletion saves with the list REPLACED', async () => {
    const r = await post({ goals_list: ['A', 'B'], replace_lists: ['goals_list'] });
    expect(r.code).toBe(200);
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
    expect(mockSaveProfile.mock.calls[0][0]).toMatchObject({ goals_list: ['A', 'B'], replace_lists: ['goals_list'] });
  });
  it('a BULK removal without confirmation is refused 409 with the items it would remove; nothing saved', async () => {
    const r = await post({ goals_list: ['A'], replace_lists: ['goals_list'] });
    expect(r.code).toBe(409);
    expect(r.body).toMatchObject({ code: 'BULK_LIST_REMOVAL_UNCONFIRMED', retryable: false, lists: [{ field: 'goals_list', stored: 3, removed: ['B', 'C'] }] });
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });
  it('the same bulk removal WITH confirm_bulk_removal saves (and the flag is not passed on)', async () => {
    const r = await post({ goals_list: ['A'], replace_lists: ['goals_list'], confirm_bulk_removal: true });
    expect(r.code).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0]).not.toHaveProperty('confirm_bulk_removal');
  });
  it('an unknown list, or a named list not sent as an array, is refused 400', async () => {
    expect((await post({ replace_lists: ['competitors_list'], competitors_list: [] })).body).toMatchObject({ code: 'INVALID_REPLACE_LISTS', invalid: ['competitors_list'] });
    expect((await post({ replace_lists: ['goals_list'], goals: 'A' })).body).toMatchObject({ code: 'INVALID_REPLACE_LISTS', invalid: ['goals_list'] });
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });
  it('a save without replace_lists is unchanged (no 400/409 path, union downstream)', async () => {
    const r = await post({ goals_list: ['A'] });
    expect(r.code).toBe(200);
    expect(mockSaveProfile.mock.calls[0][0]).not.toHaveProperty('replace_lists');
  });
});
