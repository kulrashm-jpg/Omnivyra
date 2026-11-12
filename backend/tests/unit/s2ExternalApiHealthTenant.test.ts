/**
 * S2 (e1, 83 ruling) - external_api_health is health METRICS keyed by api_source_id; its parent external_api_sources
 * is tenant-or-platform. Allow-list entries external-api-health-system-metrics / -metrics-config / -tenant-view.
 * Pinned: getPlatformConfigs reads sources ONLY via tenantOrPlatformTable (own + platform), so a tenant never sees
 * another tenant's source or its health - even when its own config rows name that source; and health snapshots
 * carry metrics only (never the informational account_id).
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
function parseOr(expr: string): (r: Row) => boolean {
  const alts = expr.split(',').map((p) => {
    const [col, op, ...rest] = p.split('.');
    const v = rest.join('.');
    return (r: Row) => (op === 'eq' ? String(r[col]) === v : op === 'is' && v === 'null' ? (r[col] ?? null) === null : false);
  });
  return (r) => alts.some((a) => a(r));
}
function ilike(value: string, pattern: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    re += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'is').test(value);
}
let mockFailFirstScoped = false;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let op = 'select'; let payload: Row = {};
  let scoped = false;
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { if (c === 'company_id') scoped = true; tests.push((r) => r[c] === v); return b; },
    ilike: (c: string, v: string) => { tests.push((r) => ilike(String(r[c] ?? ''), v)); return b; },
    neq: (c: string, v: unknown) => { tests.push((r) => r[c] !== v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (r[c] ?? null) === v); return b; },
    or: (e: string) => { tests.push(parseOr(e)); return b; },
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      if (op === 'upsert') {
        const i = rows.findIndex((r) => r.api_source_id === payload.api_source_id);
        if (i >= 0) rows[i] = { ...rows[i], ...payload }; else rows.push({ ...payload });
        return Promise.resolve({ data: null, error: null }).then(ok, ko);
      }
      if (table === 'external_api_sources' && scoped && mockFailFirstScoped) {
        mockFailFirstScoped = false;
        return Promise.resolve({ data: null, error: { message: 'column company_id: transient failure' } }).then(ok, ko);
      }
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let mockEnabled: string[] = [];
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../services/externalApi/accessChecks', () => ({
  isApiSourceExecutable: () => true,
  getEnabledApiIdsFromCompanyConfig: async () => mockEnabled,
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const { getPlatformConfigs, getPlatformConfigByPlatform, getApiConfigByPlatform } = require('../../services/externalApi/platformConfig');
const { getHealthSnapshot, updateApiHealth } = require('../../services/externalApiHealthService');
/* eslint-enable @typescript-eslint/no-var-requires */
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockFailFirstScoped = false;
  mockDb.external_api_sources = [
    { id: 'src-a', company_id: A, is_active: true, is_preset: false, created_at: '1', name: 'A private' },
    { id: 'src-b', company_id: B, is_active: true, is_preset: false, created_at: '2', name: 'B private' },
    { id: 'src-p', company_id: null, is_active: true, is_preset: true, created_at: '3', name: 'Platform preset' },
  ];
  mockDb.external_api_health = ['src-a', 'src-b', 'src-p'].map((id) => ({
    api_source_id: id, freshness_score: 0.5, reliability_score: 0.5, success_count: 1, failure_count: 0, account_id: `acct-of-${id}`,
  }));
});

it("a tenant never sees another tenant's source or its health - even when its config rows name it", async () => {
  mockEnabled = ['src-p', 'src-b']; // A's config row (somehow) names B's private source
  const configs = await getPlatformConfigs(A);
  const ids = configs.map((c: { id: string }) => c.id).sort();
  expect(ids).toEqual(['src-a', 'src-p']);
  expect(JSON.stringify(configs)).not.toContain('B private');
  expect(configs.every((c: { health: unknown }) => c.health !== undefined)).toBe(true);
});

it('the enabled-ids fallback is scoped too: only own or platform sources come back', async () => {
  mockDb.external_api_sources = mockDb.external_api_sources.filter((s) => s.id !== 'src-a');
  mockEnabled = ['src-b'];
  const configs = await getPlatformConfigs(A);
  expect(configs.map((c: { id: string }) => c.id)).toEqual([]);
});

it('a non-uuid company id is refused, never read unfiltered', async () => {
  await expect(getPlatformConfigs('x,company_id.not.is.null')).rejects.toThrow();
});

it('health rows carry metrics only: the snapshot never returns the informational account_id', async () => {
  await updateApiHealth({ apiId: 'src-p', success: true, latencyMs: 10, accountId: 'acct-of-A' });
  const snap = await getHealthSnapshot(['src-p']);
  expect(snap).toHaveLength(1);
  expect('account_id' in snap[0]).toBe(false);
  expect(Object.keys(snap[0]).sort()).toEqual(
    ['api_source_id', 'avg_latency_ms', 'failure_count', 'freshness_score', 'health_score', 'last_success_at', 'reliability_score', 'success_count'],
  );
});

it("the per-platform lookup never falls back to ANOTHER company's source when its scoped read fails", async () => {
  mockDb.external_api_sources.push({ id: 'src-b-li', company_id: B, is_active: true, category: 'linkedin', name: 'B LinkedIn', created_at: '4' });
  mockFailFirstScoped = true;
  const r = await getPlatformConfigByPlatform(A, 'linkedin');
  expect(r).toBeNull();
});

it('the per-platform lookup matches the platform literally (no LIKE wildcards) and only the own company', async () => {
  mockDb.external_api_sources.push(
    { id: 'src-a-x', company_id: A, is_active: true, category: 'other', name: 'Acme Feed', created_at: '5', is_enabled_global: true, is_whitelisted: true },
    { id: 'src-b-li', company_id: B, is_active: true, category: 'linkedin', name: 'B LinkedIn', created_at: '4' },
  );
  expect(await getApiConfigByPlatform(A, '%')).toBeNull();
  expect(await getApiConfigByPlatform(A, 'linkedin')).toBeNull();
});
