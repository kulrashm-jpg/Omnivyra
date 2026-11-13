/**
 * W6 real-schema cover for 20270217000040 (provider_invoice_imports: one COST invoice per provider per point in time,
 * ATOMICALLY - e9 ruling 2026-11-13: btree_gist + an EXCLUSION constraint while 040 is unreleased).
 *
 * Runs after the harness replayed every migration onto the production baseline, so it observes the post-040 schema and
 * executes the real INSERTs the reconcilers issue. A mock cannot raise 23P01 the way PostgreSQL does.
 *   - overlapping / identical / contained periods for one cost provider -> 23P01 (exclusion_violation)
 *   - ADJACENT half-open periods ([Jan, Feb) then [Feb, Mar)) are accepted
 *   - another provider for the same window is accepted; STRIPE is excluded (overlap accepted)
 *   - an empty / inverted cost period -> 23514 (the CHECK the exclusion rule needs: an empty '[)' range overlaps nothing)
 *   - catalog: btree_gist installed in schema `extensions`; the constraint is contype 'x', validated, with exactly the
 *     reviewed definition (reconciliationPersist classifies 23P01 BY THIS NAME).
 */
import { db, inRollback, attempt } from './setup';

const NO_OVERLAP = 'provider_invoice_imports_no_overlap';
const NONEMPTY = 'provider_invoice_imports_period_nonempty';
let n = 0;
const INSERT = `INSERT INTO public.provider_invoice_imports (provider, provider_invoice_id, period_start, period_end, total_actual_usd)
                VALUES ($1, $2, $3, $4, 1)`;
const row = (provider: string, start: string, end: string) => [provider, `w6-040-${++n}`, start, end];
const JAN = ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'] as const;

describe('040 - provider_invoice_imports exclusion constraint', () => {
  it('catalog: btree_gist lives in `extensions`; the constraint is a validated EXCLUDE with the reviewed definition', async () => {
    const ext = await db.query(`SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'btree_gist'`);
    expect(ext.rows.map((r) => r.nspname)).toEqual(['extensions']);
    const { rows } = await db.query(
      `SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.provider_invoice_imports'::regclass AND conname = ANY($1) ORDER BY conname`, [[NO_OVERLAP, NONEMPTY]]);
    expect(rows).toEqual([
      { conname: NONEMPTY, contype: 'c', convalidated: true, def: "CHECK (((provider = 'stripe'::text) OR (period_end > period_start)))" },
      { conname: NO_OVERLAP, contype: 'x', convalidated: true,
        def: "EXCLUDE USING gist (provider WITH =, tstzrange(period_start, period_end, '[)'::text) WITH &&) WHERE ((provider <> 'stripe'::text))" },
    ]);
    // the column-read index stays (the GiST index is on an expression); the draft unique index is gone
    const idx = await db.query(`SELECT to_regclass('public.idx_pii_period') IS NOT NULL AS kept, to_regclass('public.provider_invoice_imports_one_per_period_uidx') IS NULL AS draft_gone`);
    expect(idx.rows[0]).toEqual({ kept: true, draft_gone: true });
  });

  it.each([
    ['IDENTICAL period', JAN[0], JAN[1]],
    ['OVERLAPPING period', '2026-01-15T00:00:00Z', '2026-02-15T00:00:00Z'],
    ['CONTAINED period', '2026-01-10T00:00:00Z', '2026-01-11T00:00:00Z'],
    ['CONTAINING period', '2025-12-01T00:00:00Z', '2026-03-01T00:00:00Z'],
  ])('a second openai invoice for an %s -> 23P01', async (_n, s, e) => {
    await inRollback(async () => {
      await db.query(INSERT, row('openai', JAN[0], JAN[1]));
      expect(await attempt(INSERT, row('openai', s, e))).toBe('23P01');
    });
  });

  it('the 23P01 names the constraint (what reconciliationPersist classifies by)', async () => {
    await inRollback(async () => {
      await db.query(INSERT, row('openai', JAN[0], JAN[1]));
      await db.query('SAVEPOINT x');
      const err = await db.query(INSERT, row('openai', JAN[0], JAN[1])).then(() => null, (e) => e);
      await db.query('ROLLBACK TO SAVEPOINT x');
      expect(err).toMatchObject({ code: '23P01', constraint: NO_OVERLAP });
    });
  });

  it('ADJACENT half-open periods are accepted ([Jan, Feb) then [Feb, Mar))', async () => {
    await inRollback(async () => {
      await db.query(INSERT, row('openai', JAN[0], JAN[1]));
      expect(await attempt(INSERT, row('openai', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z'))).toBe('ok');
    });
  });

  it('another provider for the same window is accepted; STRIPE overlaps are accepted (excluded by design)', async () => {
    await inRollback(async () => {
      await db.query(INSERT, row('openai', JAN[0], JAN[1]));
      expect(await attempt(INSERT, row('anthropic', JAN[0], JAN[1]))).toBe('ok');
      await db.query(INSERT, row('stripe', JAN[0], JAN[1]));
      expect(await attempt(INSERT, row('stripe', JAN[0], JAN[1]))).toBe('ok');
    });
  });

  it('an EMPTY or INVERTED cost period -> 23514 (the CHECK); a stripe empty window is not constrained', async () => {
    await inRollback(async () => {
      expect(await attempt(INSERT, row('gemini', JAN[0], JAN[0]))).toBe('23514');
      expect(await attempt(INSERT, row('gemini', JAN[1], JAN[0]))).toBe('23514');
      expect(await attempt(INSERT, row('stripe', JAN[0], JAN[0]))).toBe('ok');
    });
  });
});
