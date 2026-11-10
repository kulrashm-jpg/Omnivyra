/**
 * PI-LDB C (reqs 7-10): a reconciled lead recovers its display NAME and JOB
 * TITLE from the prospect's unified_persons row (a tenant-filtered READ of the
 * spine), through the real default reader.
 */
const reads: Array<{ table: string; eqs: Array<[string, unknown]>; ins: unknown[] }> = [];
let canonicalRows: Array<Record<string, unknown>> = [];
let personsResponse: { data: unknown; error: unknown; status: number } = { data: [], error: null, status: 200 };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rec = { table, eqs: [] as Array<[string, unknown]>, ins: [] as unknown[] };
    reads.push(rec);
    const chain: Record<string, unknown> = {
      select() { return chain; },
      eq(k: string, v: unknown) { rec.eqs.push([k, v]); return chain; },
      in(_k: string, v: unknown[]) { rec.ins.push(...v); return chain; },
      order() { return chain; },
      limit() { return chain; },
      then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(table === 'unified_persons' ? personsResponse : { data: canonicalRows, error: null, status: 200 }).then(f, r),
    };
    return chain;
  },
}));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { reconcileLeadProjections } from '../../services/leadIntelligence/leadProjectionReconciliation';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const P1 = '00000000-0000-4000-8000-0000000000p1'.replace('p1', 'a1');

async function run() {
  const emitted: Array<{ display?: { name?: string | null; title?: string | null } }> = [];
  await reconcileLeadProjections({
    organizationId: ORG,
    ports: {
      findProjections: async () => new Map(),
      findProjection: async () => ({ outcome: 'absent' }),
      sink: { emit: async (l: never) => { emitted.push(l); throw new Error('stop'); } },
    },
  });
  return emitted;
}

beforeEach(() => {
  reads.length = 0;
  canonicalRows = [{ id: 'pr-1', company_id: ORG, user_id: 'u', source: 'csv', created_at: '2026-11-11T00:00:00Z', unified_person_id: P1 }];
  personsResponse = { data: [{ id: P1, full_name: 'Asha Rao', job_title: 'VP Sales' }], error: null, status: 200 };
});

it('the projected lead carries the spine name and title', async () => {
  const emitted = await run();
  expect(emitted[0].display).toMatchObject({ name: 'Asha Rao', title: 'VP Sales' });
});

it('the person read is TENANT-FILTERED and asks only for the batch person ids', async () => {
  await run();
  const pr = reads.find((r) => r.table === 'unified_persons')!;
  expect(pr.eqs).toContainEqual(['company_id', ORG]);
  expect(pr.ins).toEqual([P1]);
});

it('an unanswered person read (204 / error) leaves the display empty, never fails the pass', async () => {
  for (const r of [{ data: null, error: null, status: 204 }, { data: null, error: { code: 'x' }, status: 500 }]) {
    personsResponse = r;
    const emitted = await run();
    expect(emitted[0].display?.name ?? null).toBeNull();
  }
});

it('a name already on the row is not overwritten', async () => {
  canonicalRows[0].name = 'Row Name';
  const emitted = await run();
  expect(emitted[0].display?.name).toBe('Row Name');
});
