/**
 * Real-schema cover for 20270217000037_ops_alert_markers (e1, 2026-11-13; P2 limiter-outage owner ruling).
 * The table is the Redis-free, cross-instance dedupe for the owner's "signup paused" email: the first INSERT of
 * (alert_kind, bucket) wins and a second is 23505; only service_role may read/insert; no client role can see it.
 */
import { db, inRollback, attempt } from './setup';

describe('ops_alert_markers', () => {
  it('exists with PRIMARY KEY (alert_kind, bucket) and RLS enabled', async () => {
    const { rows } = await db.query(
      `SELECT array_agg(a.attname::text ORDER BY a.attname) AS cols
         FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
        WHERE i.indrelid = 'public.ops_alert_markers'::regclass AND i.indisprimary`);
    expect(rows[0].cols).toEqual(['alert_kind', 'bucket']);
    const rls = await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ops_alert_markers'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it('privileges: anon/authenticated none; service_role INSERT + SELECT only', async () => {
    const { rows } = await db.query(`
      SELECT r AS role, p AS priv, has_table_privilege(r, 'public.ops_alert_markers', p) AS has
        FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p`);
    const got = Object.fromEntries(rows.map((x: any) => [`${x.role}:${x.priv}`, x.has]));
    expect(got).toEqual({
      'anon:SELECT': false, 'anon:INSERT': false, 'anon:UPDATE': false, 'anon:DELETE': false,
      'authenticated:SELECT': false, 'authenticated:INSERT': false, 'authenticated:UPDATE': false, 'authenticated:DELETE': false,
      'service_role:SELECT': true, 'service_role:INSERT': true, 'service_role:UPDATE': false, 'service_role:DELETE': false,
    });
  });

  it('the first marker for a bucket wins; a second INSERT for the same bucket is 23505 (the cross-instance dedupe)', async () => {
    await inRollback(async () => {
      expect(await attempt(`INSERT INTO public.ops_alert_markers (alert_kind, bucket) VALUES ('signup_limiter_unavailable', 'rs-1')`)).toBe('ok');
      await db.query(`INSERT INTO public.ops_alert_markers (alert_kind, bucket) VALUES ('signup_limiter_unavailable', 'rs-1')`);
      expect(await attempt(`INSERT INTO public.ops_alert_markers (alert_kind, bucket) VALUES ('signup_limiter_unavailable', 'rs-1')`)).toBe('23505');
      expect(await attempt(`INSERT INTO public.ops_alert_markers (alert_kind, bucket) VALUES ('signup_limiter_unavailable', 'rs-2')`)).toBe('ok');
    });
  });
});
