/**
 * S2 tenant seam (e1) - backend/services/leadJobProcessor.ts.
 * The engine-jobs payload carries only a job id. The processor resolves the job's
 * tenant once via resolveTenantOfRow (inside the seam), and every lead_jobs_v1
 * access - re-reading the job, progress updates, the final status - is pinned to it.
 *
 * Cases:
 *   - every lead_jobs_v1 write carries company_id = the job's own tenant;
 *   - a job whose tenant cannot be resolved (NULL company) is refused: nothing is
 *     read beyond the bootstrap and nothing is written;
 *   - a crash after resolution marks the job FAILED through the seam (still pinned).
 * The fake applies every filter and records each write's filters.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; filters: Row; patch: Row }> = [];

function mockTable(table: string) {
  const filters: Row = {};
  const tests: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let mode: 'many' | 'one' = 'many';
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    const hit = rows.filter((r) => tests.every((t) => t(r)));
    if (patch) {
      mockWrites.push({ table, filters: { ...filters }, patch });
      for (const r of hit) Object.assign(r, patch);
      return { data: mode === 'one' ? hit[0] ?? null : hit, error: null };
    }
    if (mode === 'one') return hit.length === 1 ? { data: hit[0], error: null } : { data: null, error: hit.length ? { message: 'multiple' } : null };
    return { data: hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b, gte: () => b,
    eq: (c: string, v: unknown) => { filters[c] = v; tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    update: (p: Row) => { patch = p; return b; },
    maybeSingle: () => { mode = 'one'; return b; },
    single: () => { mode = 'one'; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
let mockProfileThrows = false;
jest.mock('@/backend/services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: async () => { if (mockProfileThrows) throw new Error('profile exploded'); return {}; },
}), { virtual: true });
jest.mock('../../services/contextResolver', () => ({ buildUnifiedContext: async () => '' }));
jest.mock('../../services/postDiscoveryConnectors', () => ({ getConnector: () => null }));
jest.mock('../../services/leadQualifier', () => ({ qualifyLead: jest.fn() }));
jest.mock('../../services/leadPredictiveQualifier', () => ({ qualifyPredictiveLead: jest.fn() }));
jest.mock('../../services/leadNoiseFilter', () => ({ shouldRejectPost: () => true }));
jest.mock('../../services/leadClusterService', () => ({ generateIntentClusters: async () => undefined }));
jest.mock('../../services/canonicalLeadSignalService', () => ({ writeLeadSignal: async () => undefined }));
jest.mock('../../services/prospectProvenance/communityBridge', () => ({ bridgeScheduledDetectionSignal: async () => undefined }));
jest.mock('../../services/creditExecutionService', () => ({ deductCreditsIfValueAwaited: async () => undefined }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: async () => undefined }));

import { processLeadJobV1 } from '../../services/leadJobProcessor';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const jobWrites = () => mockWrites.filter((w) => w.table === 'lead_jobs_v1');

beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0;
  mockProfileThrows = false;
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockDb.lead_jobs_v1 = [
    { id: 'job-b', company_id: B, status: 'PENDING', mode: 'REACTIVE', platforms: ['nowhere'], regions: [], keywords: [] },
    { id: 'job-a', company_id: A, status: 'PENDING', mode: 'REACTIVE', platforms: [], regions: [], keywords: [] },
    { id: 'job-orphan', company_id: null, status: 'PENDING', mode: 'REACTIVE', platforms: [], regions: [], keywords: [] },
  ];
});
afterEach(() => jest.restoreAllMocks());

it("every lead_jobs_v1 write carries the job's OWN tenant (B's job -> company_id B)", async () => {
  await processLeadJobV1('job-b');
  expect(jobWrites().length).toBeGreaterThan(1);
  for (const w of jobWrites()) expect(w.filters).toMatchObject({ company_id: B, id: 'job-b' });
  expect(mockDb.lead_jobs_v1.find((r) => r.id === 'job-a')!.status).toBe('PENDING'); // A untouched
});

it('a job with NO resolvable tenant is refused: nothing written', async () => {
  await processLeadJobV1('job-orphan');
  expect(jobWrites()).toHaveLength(0);
  expect(mockDb.lead_jobs_v1.find((r) => r.id === 'job-orphan')!.status).toBe('PENDING');
});

it('a crash after resolution marks the job FAILED through the seam (pinned to its tenant)', async () => {
  mockProfileThrows = true;
  await processLeadJobV1('job-b');
  const failed = jobWrites().find((w) => w.patch.status === 'FAILED');
  expect(failed?.filters).toMatchObject({ company_id: B, id: 'job-b' });
});
