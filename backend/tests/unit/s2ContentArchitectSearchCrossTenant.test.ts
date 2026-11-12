/**
 * S2 tenant seam: pages/api/content-architect/search.ts is a PLATFORM search that spans tenants by design.
 * Its tenant-table reads stay on the service client under the reviewed allow-list entry
 * `content-architect-search` (backend/db/crossTenantAllowList.ts). That is only safe because the route is
 * gated to a Content Architect session BEFORE any read; this suite pins that gate, and pins that the
 * allow-list entry names exactly this file and the tables it reads.
 */
const calls: string[] = [];
jest.mock('../../db/supabaseClient', () => {
  const builder = (table: string) => {
    calls.push(table);
    const b: any = {};
    for (const m of ['select', 'eq', 'ilike', 'in', 'limit']) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});
const mockIsArchitect = jest.fn((_req: unknown) => false);
jest.mock('../../services/contentArchitectService', () => ({ isContentArchitectSession: (req: unknown) => mockIsArchitect(req) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/content-architect/search';
import { CROSS_TENANT_ALLOW_LIST } from '../../db/crossTenantAllowList';

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}
const get = (q: string) => ({ method: 'GET', url: '/x', headers: {}, query: { q }, body: {} }) as any;

beforeEach(() => { calls.length = 0; mockIsArchitect.mockReset(); });

describe('content-architect/search (S2: reviewed cross-tenant platform search)', () => {
  it('a caller WITHOUT a Content Architect session is refused (403) before ANY database read', async () => {
    mockIsArchitect.mockReturnValue(false);
    const res = mockRes();
    await handler(get('acme'), res);
    expect(res.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  it('CONTROL: a Content Architect session reaches the cross-tenant reads', async () => {
    mockIsArchitect.mockReturnValue(true);
    const res = mockRes();
    await handler(get('acme'), res);
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(expect.arrayContaining(['company_profiles', 'campaigns', 'recommendation_snapshots']));
  });

  it('the allow-list entry names exactly this file and only the tables the route reads', () => {
    const e = CROSS_TENANT_ALLOW_LIST.find((x) => x.id === 'content-architect-search');
    expect(e).toBeDefined();
    expect(e!.file).toBe('pages/api/content-architect/search.ts');
    expect([...e!.tables].sort()).toEqual(['campaign_versions', 'campaigns', 'company_profiles', 'recommendation_snapshots']);
  });
});
