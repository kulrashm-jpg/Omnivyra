/**
 * Market Pulse scan CONSOLE is admin-only on the SERVER (owner ruling 2026-11-13, via e9).
 *
 * The Executive room (/market-pulse) is the one customer entry and stays member-readable (context, people,
 * watchlist, collaboration, personalization, findings/[id]/shown). The console routes - start / cancel scans, run
 * detail, history, automation, finding actions, and the legacy V1 job routes - answer 403 MARKET_PULSE_ADMIN_REQUIRED
 * to anyone but COMPANY_ADMIN / SUPER_ADMIN (and the platform CONTENT_ARCHITECT session). The UI button shows only
 * for CompanyContext.isAdmin (same role set), so no button opens a page that 403s.
 *
 * Membership itself (resolveCompanyAccess / enforceCompanyAccess) is faked to grant a chosen role; downstream data
 * access is a permissive fake. Each route is asserted only on whether the console gate let the request through.
 */
type Row = Record<string, any>;
const CO = 'c0a00000-0000-4000-8000-00000000000a';
let role = 'COMPANY_ADMIN';

function table() {
  const row: Row = { id: 'x1', company_id: 'c0a00000-0000-4000-8000-00000000000a', status: 'PENDING', run_id: 'r1', regions: ['GLOBAL'], context_payload: {} };
  const q: any = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'range', 'gte', 'lte', 'or', 'update', 'upsert', 'insert', 'delete', 'filter', 'contains']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: row, error: null });
  q.single = async () => ({ data: row, error: null });
  q.then = (ok: any, ko: any) => Promise.resolve({ data: [row], error: null, count: 1 }).then(ok, ko);
  return q;
}
jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production', ENABLE_AUTO_WORKERS: false, REDIS_URL: '', NEXT_PUBLIC_APP_URL: 'http://localhost' } }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => table(), rpc: async () => ({ data: null, error: null }) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: () => table(), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: async () => ({ userId: 'u1', role }),
  isContentArchitectSession: () => false,
  checkContentArchitectAccess: () => undefined,
}));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: 'u1' }), resolveUserContext: async () => ({ userId: 'u1' }) }));
// Keep every route from doing real work past the gate.
jest.mock('../../queue/jobQueue', () => ({ jobQueue: { add: async () => ({ id: 'j' }) } }));
jest.mock('../../middleware/queueBackpressure', () => ({ safeEnqueue: async () => ({ id: 'j' }) }));

const call = async (path: string, method: string) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const handler = require(`../../../pages/api/market-pulse/${path}`).default;
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  res.end = () => res;
  try {
    await handler({ method, query: { companyId: CO, id: 'f0000000-0000-4000-8000-000000000001' }, headers: {}, body: { companyId: CO, action: 'resolve', objective: 'growth', regions: ['GLOBAL'] } }, res);
  } catch { /* downstream work past the gate may throw on the permissive fake; only the gate is asserted */ }
  return res;
};
const gated = (res: any) => res.statusCode === 403 && res.body?.code === 'MARKET_PULSE_ADMIN_REQUIRED';

const CONSOLE: Array<[string, string]> = [
  ['run', 'POST'], ['history', 'GET'], ['automation', 'GET'], ['automation', 'POST'],
  ['runs/[id]/index', 'GET'], ['runs/[id]/cancel', 'POST'],
  ['findings/[id]/action', 'POST'], ['findings/[id]/generate-response', 'POST'], ['findings/[id]/promote', 'POST'],
  ['job/create', 'POST'], ['job/[id]', 'GET'], ['job/[id]/cancel', 'POST'],
];
const MEMBER_LEVEL: Array<[string, string]> = [
  ['findings/[id]/shown', 'POST'], ['context', 'GET'], ['people', 'GET'], ['watchlist', 'GET'], ['collaboration', 'GET'], ['personalization', 'GET'],
];

describe('console routes: members are refused by the server', () => {
  for (const [path, method] of CONSOLE) {
    it(`${method} ${path}: MEMBER -> 403 MARKET_PULSE_ADMIN_REQUIRED`, async () => {
      role = 'CONTENT_CREATOR';
      expect(gated(await call(path, method))).toBe(true);
    });
    it(`${method} ${path}: COMPANY_ADMIN and SUPER_ADMIN pass the gate`, async () => {
      role = 'COMPANY_ADMIN';
      expect(gated(await call(path, method))).toBe(false);
      role = 'SUPER_ADMIN';
      expect(gated(await call(path, method))).toBe(false);
    });
  }
});

describe('Executive-room routes stay member-readable (never console-gated)', () => {
  for (const [path, method] of MEMBER_LEVEL) {
    it(`${method} ${path}: MEMBER is not refused by the console gate`, async () => {
      role = 'CONTENT_CREATOR';
      expect(gated(await call(path, method))).toBe(false);
    });
  }
});
