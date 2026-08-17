/**
 * PHASE-1A — the Data Sources catalogue and its tenant-scoped route.
 *
 * The catalogue's job is to be honest: it must never report a provider as
 * connected unless a real row says so, and it must never imply that an
 * unimplemented provider is merely "not connected yet". The route's job is to
 * be tenant-safe and to leak no secrets.
 */

const enforceCompanyAccess = jest.fn();
const dbRows: { data: unknown; error: unknown } = { data: [], error: null };
let selectedColumns = '';
let filteredCompanyId = '';

jest.mock('../../services/userContextService', () => ({
  enforceCompanyAccess: (...a: unknown[]) => enforceCompanyAccess(...a),
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const q: Record<string, unknown> = {};
    q.select = (cols: string) => { selectedColumns = cols; return q; };
    q.eq = (_c: string, v: string) => { filteredCompanyId = v; return Promise.resolve(dbRows); };
    return q;
  },
}));

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/integrations/data-sources';
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  DATA_SOURCE_CATALOGUE,
  DATA_SOURCE_GROUPS,
  buildDataSourceView,
  getDataSourceDefinition,
  listDataSourcesByGroup,
  resolveDataSourceStatus,
} from '../../services/integrations/dataSourceCatalogue';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

type Res = NextApiResponse & { _status: number; _json: Record<string, unknown>; _headers: Record<string, string> };
const makeRes = (): Res => {
  const r: Partial<Res> = { _status: 0, _json: {}, _headers: {} };
  r.status = ((c: number) => { (r as Res)._status = c; return r as Res; }) as Res['status'];
  r.json = ((b: Record<string, unknown>) => { (r as Res)._json = b; return r as Res; }) as Res['json'];
  r.setHeader = ((k: string, v: string) => { (r as Res)._headers[k] = v; return r as Res; }) as unknown as Res['setHeader'];
  return r as Res;
};
const call = async (over: Partial<NextApiRequest> = {}) => {
  const req = { method: 'GET', query: { company_id: ORG_A }, url: '/api/integrations/data-sources', ...over } as unknown as NextApiRequest;
  const res = makeRes();
  await (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  enforceCompanyAccess.mockResolvedValue({ userId: 'u-1' });
  dbRows.data = [];
  dbRows.error = null;
  selectedColumns = '';
  filteredCompanyId = '';
});

describe('PHASE-1A — the catalogue tells the truth', () => {
  it('every entry has a stable key, label and group', () => {
    for (const d of DATA_SOURCE_CATALOGUE) {
      expect(d.key).toMatch(/^[a-z0-9_]+$/);
      expect(d.label.length).toBeGreaterThan(0);
      expect(DATA_SOURCE_GROUPS).toContain(d.group);
    }
  });

  it('keys are unique — a duplicate would collide in a future integration row', () => {
    const keys = DATA_SOURCE_CATALOGUE.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only the genuinely released sources are marked available', () => {
    const available = DATA_SOURCE_CATALOGUE.filter((d) => d.available).map((d) => d.key).sort();
    expect(available).toEqual(['crm', 'manual']);
  });

  it('the declared-only providers are present but NOT available', () => {
    for (const k of ['linkedin_sales_navigator', 'apollo', 'zoominfo', 'crunchbase', 'rapidapi', 'csv']) {
      expect(getDataSourceDefinition(k)?.available).toBe(false);
    }
  });

  it('an unimplemented provider is not_available, never not_connected', () => {
    const apollo = getDataSourceDefinition('apollo')!;
    expect(resolveDataSourceStatus(apollo, []).status).toBe('not_available');
  });

  it('an unimplemented provider stays not_available even if a row somehow exists', () => {
    const apollo = getDataSourceDefinition('apollo')!;
    const out = resolveDataSourceStatus(apollo, [{ id: 'i-1', type: 'apollo', status: 'connected' }]);
    expect(out.status).toBe('not_available');
    expect(out.integrationId).toBeNull();
  });

  it('an available provider with no row is not_connected', () => {
    const manual = getDataSourceDefinition('manual')!;
    expect(resolveDataSourceStatus(manual, []).status).toBe('not_connected');
  });

  it('maps real row statuses without rounding up', () => {
    const manual = getDataSourceDefinition('manual')!;
    const cases: Array<[string, string]> = [
      ['connected', 'connected'],
      ['failed', 'error'],
      ['pending', 'configuration_required'],
      ['something_new', 'configuration_required'],
    ];
    for (const [rowStatus, expected] of cases) {
      expect(resolveDataSourceStatus(manual, [{ id: 'i-1', type: 'manual', status: rowStatus }]).status).toBe(expected);
    }
  });

  it('never reports connected without a row saying so', () => {
    for (const d of DATA_SOURCE_CATALOGUE) {
      expect(resolveDataSourceStatus(d, []).status).not.toBe('connected');
    }
  });

  it('groups partition the catalogue with nothing lost', () => {
    const total = DATA_SOURCE_GROUPS.reduce((n, g) => n + listDataSourcesByGroup(g).length, 0);
    expect(total).toBe(DATA_SOURCE_CATALOGUE.length);
  });

  it('buildDataSourceView covers every definition exactly once', () => {
    const view = buildDataSourceView([]);
    expect(view).toHaveLength(DATA_SOURCE_CATALOGUE.length);
    expect(new Set(view.map((v) => v.key)).size).toBe(view.length);
  });
});

describe('PHASE-1A — the route is tenant-safe', () => {
  it('returns the catalogue for an authorised tenant', async () => {
    const res = await call();
    expect(res._status).toBe(200);
    expect(Array.isArray(res._json.sources)).toBe(true);
  });

  it('reads integration rows with the VERIFIED company_id', async () => {
    await call({ query: { company_id: ORG_B } } as Partial<NextApiRequest>);
    expect(enforceCompanyAccess.mock.calls[0][0].companyId).toBe(ORG_B);
    expect(filteredCompanyId).toBe(ORG_B);
  });

  it('requires company_id', async () => {
    const res = await call({ query: {} } as Partial<NextApiRequest>);
    expect(res._status).toBe(400);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it.each([['not-a-uuid'], ["' OR 1=1--"], ['']])(
    'refuses a malformed company_id (%s) before any membership lookup', async (bad) => {
      const res = await call({ query: { company_id: bad } } as Partial<NextApiRequest>);
      expect(res._status).toBe(400);
      expect(enforceCompanyAccess).not.toHaveBeenCalled();
    });

  it('an unauthenticated request never reaches the database', async () => {
    enforceCompanyAccess.mockResolvedValue(null);
    await call();
    expect(filteredCompanyId).toBe('');
  });

  it('rejects a non-GET method', async () => {
    const res = await call({ method: 'POST' } as Partial<NextApiRequest>);
    expect(res._status).toBe(405);
    expect(enforceCompanyAccess).not.toHaveBeenCalled();
  });

  it('never derives the tenant from the body', async () => {
    const res = await call({ query: { company_id: ORG_A }, body: { company_id: ORG_B } } as Partial<NextApiRequest>);
    expect(res._status).toBe(200);
    expect(filteredCompanyId).toBe(ORG_A);
  });
});

describe('PHASE-1A — the route returns no secrets', () => {
  it('selects only id, type and status — never config or credentials', async () => {
    await call();
    expect(selectedColumns).toBe('id, type, status');
    for (const forbidden of ['config', 'credential', 'secret', 'token', 'encrypted']) {
      expect(selectedColumns).not.toContain(forbidden);
    }
  });

  it('a read failure is reported as retryable, not as "nothing connected"', async () => {
    dbRows.error = { message: 'db down' };
    const res = await call();
    expect(res._status).toBe(503);
    expect(res._json.retryable).toBe(true);
    expect(res._json.sources).toBeUndefined();
  });

  it('surfaces a real connected row for an available source', async () => {
    dbRows.data = [{ id: 'i-1', type: 'manual', status: 'connected' }];
    const res = await call();
    const sources = res._json.sources as Array<{ key: string; status: string; integrationId: string | null }>;
    const manual = sources.find((s) => s.key === 'manual')!;
    expect(manual.status).toBe('connected');
    expect(manual.integrationId).toBe('i-1');
  });

  it('creates no rows of its own — it is read-only', async () => {
    await call();
    expect(res_isReadOnly()).toBe(true);
  });
});

/** The route module has no write verb; proven from its source, not asserted. */
function res_isReadOnly(): boolean {
  const src = require('fs')
    .readFileSync(require('path').join(__dirname, '../../../pages/api/integrations/data-sources.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return !/\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(src);
}
