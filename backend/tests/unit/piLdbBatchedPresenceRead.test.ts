/**
 * PI-LDB C (requirement 6, folded in): the batched, URL-budgeted presence read
 * reconciliation uses where keys are known up front.
 */
type Res = { data: unknown; error: unknown; status: number };
const issued: string[][] = [];
let respond: (chunk: string[]) => Res = (chunk) => ({ data: chunk.filter((k) => k.endsWith('-hit')).map((k) => ({ dedupe_key: k, id: `id:${k}` })), error: null, status: 200 });
let measurable = true;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    let keys: string[] = [];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.in = (_c: string, v: string[]) => {
      keys = v;
      if (measurable) {
        // Rendered like PostgREST: dedupe_key=in.(k1,k2,...) on a fixed base.
        b.url = new URL(`https://x.supabase.co/rest/v1/lead_intelligence?select=dedupe_key%2Cid&company_id=eq.c&dedupe_key=in.(${v.map(encodeURIComponent).join(',')})`);
      }
      return b;
    };
    b.retry = () => { issued.push(keys); return Promise.resolve(respond(keys)); };
    return b;
  },
}));

import { findCanonicalLeadIdsByDedupeKeys } from '../../services/leadIntelligence/leadIntelligenceRepository';

const key = (i: number, hit = false) => `src:crm|tbl:canonical_leads|id:00000000-0000-4000-8000-${String(i).padStart(12, '0')}${hit ? '-hit' : ''}`;
beforeEach(() => { issued.length = 0; measurable = true; respond = (chunk) => ({ data: chunk.filter((k) => k.endsWith('-hit')).map((k) => ({ dedupe_key: k, id: `id:${k}` })), error: null, status: 200 }); });

it('packs by MEASURED URL length: every issued request fits the budget, and all keys are covered', async () => {
  const keys = Array.from({ length: 120 }, (_, i) => key(i, i % 3 === 0));
  const budget = 3000;
  const out = await findCanonicalLeadIdsByDedupeKeys('c', keys, budget);
  expect(issued.length).toBeGreaterThan(1);
  for (const chunk of issued) {
    const len = `https://x.supabase.co/rest/v1/lead_intelligence?select=dedupe_key%2Cid&company_id=eq.c&dedupe_key=in.(${chunk.map(encodeURIComponent).join(',')})`.length;
    expect(len).toBeLessThanOrEqual(budget);
  }
  expect(issued.flat().sort()).toEqual([...keys].sort());
  expect(out.get(key(0, true))).toEqual({ outcome: 'found', leadId: `id:${key(0, true)}` });
  expect(out.get(key(1))).toEqual({ outcome: 'absent' });
});

it('a tighter budget means more, smaller requests (the budget is what decides)', async () => {
  const keys = Array.from({ length: 60 }, (_, i) => key(i));
  await findCanonicalLeadIdsByDedupeKeys('c', keys, 3000);
  const wide = issued.length;
  issued.length = 0;
  await findCanonicalLeadIdsByDedupeKeys('c', keys, 1200);
  expect(issued.length).toBeGreaterThan(wide);
});

it('NEVER manufactures absent: a 204 / error / non-array chunk leaves its keys UNANSWERED (missing)', async () => {
  for (const r of [{ data: null, error: null, status: 204 }, { data: null, error: { code: 'x' }, status: 500 }, { data: {}, error: null, status: 200 }]) {
    respond = () => r as Res;
    const out = await findCanonicalLeadIdsByDedupeKeys('c', [key(1), key(2)]);
    expect(out.size).toBe(0);
  }
});

it('an unmeasurable builder means no batch at all (callers fall back per key)', async () => {
  measurable = false;
  const out = await findCanonicalLeadIdsByDedupeKeys('c', [key(1)]);
  expect(out.size).toBe(0);
  expect(issued).toEqual([]);
});

it('a single key larger than the budget is left to the per-key read', async () => {
  const huge = `src:crm|tbl:canonical_leads|id:${'z'.repeat(4000)}`;
  const out = await findCanonicalLeadIdsByDedupeKeys('c', [huge, key(1)], 3000);
  expect(out.has(huge)).toBe(false);
  expect(out.get(key(1))).toEqual({ outcome: 'absent' });
});

describe('reconciliation uses the batch and falls back for unanswered keys', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reconcileLeadProjections } = require('../../services/leadIntelligence/leadProjectionReconciliation');
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const row = (id: string) => ({ id, company_id: ORG, user_id: 'u', source: 'csv', created_at: '2026-11-11T00:00:00Z', unified_person_id: 'p' });

  it('batched found -> already_projected with NO per-key read; unanswered -> per-key read decides', async () => {
    const perKey: string[] = [];
    const res = await reconcileLeadProjections({
      organizationId: ORG,
      ports: {
        readProspects: async () => ({ rows: [row('a1'), row('a2')], truncated: false }),
        findProjections: async (_o: string, keys: string[]) => new Map([[keys[0], { outcome: 'found', leadId: 'L1' }]]),
        findProjection: async (_o: string, k: string) => { perKey.push(k); return { outcome: 'found', leadId: 'L2' }; },
        sink: { emit: async () => { throw new Error('must not write'); } },
      },
    });
    expect(res.outcomes.map((o: { status: string }) => o.status)).toEqual(['already_projected', 'already_projected']);
    expect(perKey).toHaveLength(1);           // only the key the batch did not answer
  });
});

describe('operator CLI --canonical --dry relies on this: a refusing sink writes nothing and is reported by message', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reconcileLeadProjections } = require('../../services/leadIntelligence/leadProjectionReconciliation');
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  it('an absent prospect + a sink that throws DRY_RUN_NO_WRITE -> still_missing whose detail names the marker', async () => {
    const res = await reconcileLeadProjections({
      organizationId: ORG,
      ports: {
        readProspects: async () => ({ rows: [{ id: 'a9', company_id: ORG, user_id: 'u', source: 'csv', created_at: '2026-11-11T00:00:00Z', unified_person_id: 'p' }], truncated: false }),
        findProjections: async () => new Map(),
        findProjection: async () => ({ outcome: 'absent' }),
        sink: { emit: async () => { throw new Error('DRY_RUN_NO_WRITE'); } },
      },
    });
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0].status).toBe('still_missing');
    expect(res.outcomes[0].detail).toContain('DRY_RUN_NO_WRITE');
  });
});

describe('reqs 7-10: tenant precedence cannot route a row into another tenant', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reconcileLeadProjections } = require('../../services/leadIntelligence/leadProjectionReconciliation');
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const OTHER = '00000000-0000-4000-8000-0000000000bb';
  const run = (row: Record<string, unknown>) => {
    const emitted: unknown[] = [];
    return reconcileLeadProjections({
      organizationId: ORG,
      ports: {
        readProspects: async () => ({ rows: [row], truncated: false }),
        findProjections: async () => new Map(),
        findProjection: async () => ({ outcome: 'absent' }),
        sink: { emit: async (l: unknown) => { emitted.push(l); throw new Error('stop'); } },
      },
    }).then((res: { outcomes: Array<{ status: string; detail?: string }> }) => ({ res, emitted }));
  };
  const base = { id: 'a1', user_id: 'u', source: 'csv', created_at: '2026-11-11T00:00:00Z', unified_person_id: 'p' };

  it('company_id = this tenant but organization_id = another -> skipped, nothing emitted', async () => {
    const { res, emitted } = await run({ ...base, company_id: ORG, organization_id: OTHER });
    expect(res.outcomes[0].status).toBe('skipped');
    expect(res.outcomes[0].detail).toContain(OTHER);
    expect(emitted).toEqual([]);
  });

  it('a row naming no tenant at all -> skipped', async () => {
    const { res } = await run({ ...base });
    expect(res.outcomes[0].status).toBe('skipped');
  });

  it('NEGATIVE CONTROL: both fields naming this tenant -> proceeds to the sink', async () => {
    const { emitted } = await run({ ...base, company_id: ORG, organization_id: ORG });
    expect(emitted).toHaveLength(1);
  });
});
