/**
 * Harness control: the real-schema SQL transport serves PostgREST computed fields.
 *
 * Real PostgREST resolves `select('id, read_at')` on contact_governance_records by calling
 * `public.read_at(public.contact_governance_records)` (migration 20270202000000). The harness
 * transport used to send `read_at` to Postgres as a column, so every suite reaching the
 * governance repository failed with 42703 although production does not. These cases FAIL on
 * the transport without helpers/computedFields.ts (the computed-field cases return 42703).
 */
import { db, inRollback } from './setup';
import { pgTable } from './helpers/pgTransport';

const client = () => db;

describe('real-schema transport: PostgREST computed fields', () => {
  it('read_at on contact_governance_records resolves as a computed field, not a column', async () => {
    await inRollback(async () => {
      const { error } = await (pgTable(client, 'contact_governance_records') as any).select('id, read_at').limit(1);
      expect(error).toBeNull();
    });
  });

  it('select and RETURNING carry the computed value; a column passes through; an unknown name still fails 42703', async () => {
    await inRollback(async () => {
      await db.query(`CREATE TABLE public.harness_cf_rows (id int PRIMARY KEY)`);
      await db.query(`CREATE FUNCTION public.harness_cf_double(r public.harness_cf_rows) RETURNS int LANGUAGE sql STABLE AS 'SELECT r.id * 2'`);

      const ins = await (pgTable(client, 'harness_cf_rows') as any).insert({ id: 3 }).select('id, harness_cf_double');
      expect(ins.error).toBeNull();
      expect(ins.data).toEqual([{ id: 3, harness_cf_double: 6 }]);

      const sel = await (pgTable(client, 'harness_cf_rows') as any).select('id,harness_cf_double').eq('id', 3).maybeSingle();
      expect(sel.error).toBeNull();
      expect(sel.data).toEqual({ id: 3, harness_cf_double: 6 });

      const unknown = await (pgTable(client, 'harness_cf_rows') as any).select('id, harness_cf_missing');
      expect(unknown.data).toBeNull();
      expect(String((unknown.error as { code?: string })?.code)).toBe('42703');
    });
  });
});
