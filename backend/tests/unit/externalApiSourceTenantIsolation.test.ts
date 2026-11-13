/**
 * Tenant isolation of external_api_sources (05 / e9, 2026-11-14) - a confused-deputy fix.
 * getPlatformConfigs trusted `enabledIds` (from the caller's own company_api_configs) as already-authorised and
 * fetched `.in('id', enabledIds)` with NO company predicate, so a config naming ANOTHER tenant's own source returned
 * that tenant's row (select *: its per-tenant config / credentials). The read now carries its own predicate (platform
 * rows + the caller's own rows, two structural reads), whatever the writers do; and the two single-id writers refuse a
 * foreign source (defence in depth). Latent in prod (0 tenant-owned sources) - live on the first such row.
 */
import fs from 'fs';
import path from 'path';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let failNext = false;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    const b: any = {
      select: () => b, order: () => b,
      eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
      is: (c: string, v: unknown) => { preds.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return b; },
      in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return b; },
      or: () => { throw new Error('interpolated .or() must not be used for tenant isolation'); },
      then: (ok: any, err: any) => {
        if (failNext) { failNext = false; return Promise.resolve({ data: null, error: { message: 'statement timeout' } }).then(ok, err); }
        return Promise.resolve({ data: (tables[table] ?? []).filter((r) => preds.every((p) => p(r))), error: null }).then(ok, err);
      },
    };
    return b;
  },
}));
let mockEnabledIds: string[] = [];
jest.mock('../../services/externalApi/accessChecks', () => ({
  ...jest.requireActual('../../services/externalApi/accessChecks'),
  getEnabledApiIdsFromCompanyConfig: async () => mockEnabledIds,
}));
jest.mock('../../services/externalApi/dbHelpers', () => ({
  ...jest.requireActual('../../services/externalApi/dbHelpers'),
  fetchHealthMapForApiIds: async () => ({}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getPlatformConfigs, sourceVisibleToCompany } = require('../../services/externalApi/platformConfig');

const A = 'a0000000-0000-4000-8000-0000000000a1';
const B = 'b0000000-0000-4000-8000-0000000000b1';
const PLATFORM = { id: 'src-platform', company_id: null, is_preset: true, is_active: true, created_at: '2026-01-01', secret: 'platform' };
const A_OWN = { id: 'src-a', company_id: A, is_preset: false, is_active: true, created_at: '2026-01-02', secret: 'A-oauth' };
const B_OWN = { id: 'src-b', company_id: B, is_preset: false, is_active: true, created_at: '2026-01-03', secret: 'B-oauth' };

beforeEach(() => {
  tables.external_api_sources = [PLATFORM, A_OWN, B_OWN];
  mockEnabledIds = [];
  failNext = false;
});

describe('getPlatformConfigs never returns another tenant\'s source', () => {
  it('fallback 1 (enabled ids, no matching preset): A\'s config naming B\'s source does NOT return B\'s row', async () => {
    tables.external_api_sources = [PLATFORM, B_OWN]; // A has no own rows; the platform preset is not enabled
    mockEnabledIds = ['src-b'];
    const out = await getPlatformConfigs(A, { skipCache: true });
    expect(out.map((r: Row) => r.id)).not.toContain('src-b');
    expect(JSON.stringify(out)).not.toContain('B-oauth');
  });
  it('fallback 2 (nothing visible, enabled ids present): still no foreign row', async () => {
    tables.external_api_sources = [B_OWN];
    mockEnabledIds = ['src-b'];
    const out = await getPlatformConfigs(A, { skipCache: true });
    expect(out).toEqual([]);
  });
  it('POSITIVE CONTROL: A sees its own rows and the enabled platform preset', async () => {
    mockEnabledIds = ['src-platform', 'src-b'];
    const ids = (await getPlatformConfigs(A, { skipCache: true })).map((r: Row) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['src-a', 'src-platform']));
    expect(ids).not.toContain('src-b');
  });
});

describe('sourceVisibleToCompany (write-side check)', () => {
  it('platform and own -> visible; another tenant\'s -> not_found; a failed read -> error (never not_found)', async () => {
    expect(await sourceVisibleToCompany('src-platform', A)).toBe('visible');
    expect(await sourceVisibleToCompany('src-a', A)).toBe('visible');
    expect(await sourceVisibleToCompany('src-b', A)).toBe('not_found');
    failNext = true;
    expect(await sourceVisibleToCompany('src-a', A)).toBe('error');
  });
});

describe('both single-id writers check visibility BEFORE their upsert (static order pin)', () => {
  const root = path.resolve(__dirname, '../../..');
  it.each([
    ['pages/api/external-apis/company-config.ts', "if (req.method === 'PUT')"],
    ['pages/api/external-apis/access.ts', "if (!api_source_id) {"],
  ])('%s', (rel, anchor) => {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const start = src.indexOf(anchor);
    expect(start).toBeGreaterThan(-1);
    const check = src.indexOf('sourceVisibleToCompany(', start);
    const upsert = src.indexOf(".upsert(", start);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(upsert);
  });
});
