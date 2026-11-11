/**
 * C10 (2026-11-11, owner decision): block template use is COUNTED properly.
 * recordBlockTemplateUse is a compare-and-set increment (atomic without a DB
 * function), tenant-scoped, and every failure throws. The fake below enforces
 * the WHERE clauses a real UPDATE would, so the race is a real race.
 */
const CO = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const TPL = '00000000-0000-4000-8000-0000000000c1';
const DEF = '00000000-0000-4000-8000-0000000000d1';

type Row = { id: string; company_id: string | null; is_default: boolean; usage_count: number | null };
let rows: Row[] = [];
let failNext: { op: 'read' | 'write'; error: { message: string } } | null = null;
/** Runs between a read and the following write - to interleave a rival use. */
let beforeWrite: (() => Promise<void>) | null = null;
let writes = 0;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const f: { eq: Array<[string, unknown]>; is: Array<[string, null]>; or: string | null; patch: Partial<Row> | null } =
      { eq: [], is: [], or: null, patch: null };
    const match = (r: Row) =>
      f.eq.every(([c, v]) => (r as Record<string, unknown>)[c] === v)
      && f.is.every(([c]) => (r as Record<string, unknown>)[c] === null)
      && (f.or === null || r.company_id === f.or.match(/company_id\.eq\.([0-9a-f-]+)/)![1] || r.is_default);
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => { f.eq.push([c, v]); return b; };
    b.is = (c: string, v: null) => { f.is.push([c, v]); return b; };
    b.or = (expr: string) => { f.or = expr; return b; };
    b.update = (p: Partial<Row>) => { f.patch = p; return b; };
    b.limit = async () => {
      if (failNext?.op === 'read') { const e = failNext.error; failNext = null; return { data: null, error: e }; }
      return { data: rows.filter(match).slice(0, 1).map((r) => ({ id: r.id, usage_count: r.usage_count })), error: null };
    };
    // `.select('id')` after `.update(...)` resolves the write.
    const origSelect = b.select as () => unknown;
    b.select = (cols?: string) => {
      if (f.patch && cols === 'id') {
        return (async () => {
          if (beforeWrite) { const fn = beforeWrite; beforeWrite = null; await fn(); }
          if (failNext?.op === 'write') { const e = failNext.error; failNext = null; return { data: null, error: e }; }
          const hits = rows.filter(match);
          for (const h of hits) Object.assign(h, f.patch);
          writes += hits.length;
          return { data: hits.map((h) => ({ id: h.id })), error: null };
        })();
      }
      return origSelect();
    };
    return b;
  },
}));

import { recordBlockTemplateUse, BlockTemplateUsageError } from '../../services/blockTemplateService';

beforeEach(() => {
  rows = [
    { id: TPL, company_id: CO, is_default: false, usage_count: 4 },
    { id: DEF, company_id: null, is_default: true, usage_count: 0 },
  ];
  failNext = null; beforeWrite = null; writes = 0;
});

describe('C10 - one use increments exactly once', () => {
  it('a single use increments by exactly one, in one write', async () => {
    expect(await recordBlockTemplateUse(TPL, CO)).toBe(5);
    expect(rows[0].usage_count).toBe(5);
    expect(writes).toBe(1);
  });

  it('two CONCURRENT uses count two (compare-and-set: the loser re-reads), never one', async () => {
    // A rival use lands between this call's read (4) and its write.
    beforeWrite = async () => { await recordBlockTemplateUse(TPL, CO); };
    expect(await recordBlockTemplateUse(TPL, CO)).toBe(6);
    expect(rows[0].usage_count).toBe(6);
  });

  it("a NULL count (the column is nullable) becomes 1", async () => {
    rows[0].usage_count = null;
    expect(await recordBlockTemplateUse(TPL, CO)).toBe(1);
  });

  it('a system default template is counted for any company', async () => {
    expect(await recordBlockTemplateUse(DEF, OTHER)).toBe(1);
  });
});

describe('C10 - tenant scope and errors are never swallowed', () => {
  it("another company's template is NOT FOUND and nothing is written", async () => {
    const err = await recordBlockTemplateUse(TPL, OTHER).catch((e) => e);
    expect(err).toBeInstanceOf(BlockTemplateUsageError);
    expect((err as BlockTemplateUsageError).kind).toBe('not_found');
    expect(rows[0].usage_count).toBe(4);
    expect(writes).toBe(0);
  });

  it.each([['read', 'read_failed'], ['write', 'write_failed']] as const)('a %s error THROWS (%s)', async (op, kind) => {
    failNext = { op, error: { message: 'boom' } };
    const err = await recordBlockTemplateUse(TPL, CO).catch((e) => e);
    expect((err as BlockTemplateUsageError).kind).toBe(kind);
    expect(rows[0].usage_count).toBe(4);
  });

  it('a race that never settles is a CONFLICT, not a lost count', async () => {
    let n = 0;
    const rival = async () => { rows[0].usage_count = (rows[0].usage_count ?? 0) + 100; if (++n < 10) beforeWrite = rival; };
    beforeWrite = rival;
    const err = await recordBlockTemplateUse(TPL, CO).catch((e) => e);
    expect((err as BlockTemplateUsageError).kind).toBe('conflict');
  });

  it('malformed ids are refused before any read', async () => {
    expect(((await recordBlockTemplateUse('x', CO).catch((e) => e)) as BlockTemplateUsageError).kind).toBe('invalid_argument');
    expect(((await recordBlockTemplateUse(TPL, 'co) or (1') .catch((e) => e)) as BlockTemplateUsageError).kind).toBe('invalid_argument');
  });
});
