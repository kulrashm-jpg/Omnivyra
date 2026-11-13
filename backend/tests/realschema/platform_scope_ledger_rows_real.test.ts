/**
 * 20270217000038 on the REAL schema (6f; e9 ruling P1, e1 ledger sign-off). usage_events.organization_id is NULLABLE
 * only for an explicitly marked PLATFORM row; unified_transactions is untouched; the per-company view excludes
 * platform rows.
 *   - NULL org WITHOUT the marker is REFUSED - including with metadata NULL (without the COALESCE the CHECK would
 *     evaluate to NULL, and a CHECK passes on NULL) and with metadata {} or another scope;
 *   - NULL org WITH metadata.billing_scope = 'platform' INSERTS;
 *   - a company row is unaffected;
 *   - company_financial_reconciliation never shows a NULL-org (platform) row, while the company's own row is there;
 *   - unified_transactions.organization_id is still NOT NULL.
 */
import { db, inRollback, seedTenants, ORG_A } from './setup';

const ins = (org: string | null, metadata: unknown) => db.query(
  `INSERT INTO public.usage_events (organization_id, source_type, source_name, process_type, total_cost_usd, metadata, created_at)
   VALUES ($1, 'llm', 'probe', 'probe', 1.25, $2::jsonb, '2026-11-13T10:00:00Z')`,
  [org, metadata === undefined ? null : JSON.stringify(metadata)],
);

it.each([
  ['metadata NULL (the COALESCE hole)', null],
  ['metadata {}', {}],
  ['another scope', { billing_scope: 'tenant' }],
])('NULL org WITHOUT the platform marker is refused: %s', async (_n, metadata) => {
  await inRollback(async () => {
    await db.query('SAVEPOINT a');
    await expect(ins(null, metadata)).rejects.toMatchObject({ code: '23514' });
    await db.query('ROLLBACK TO SAVEPOINT a');
  });
});

it('NULL org WITH billing_scope = platform inserts; a company row is unaffected', async () => {
  await inRollback(async () => {
    await seedTenants();
    await ins(null, { billing_scope: 'platform' });
    await ins(ORG_A, null);
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE organization_id IS NULL)::int AS platform, count(*) FILTER (WHERE organization_id = $1)::int AS company
         FROM public.usage_events WHERE source_name = 'probe'`, [ORG_A]);
    expect(rows[0]).toEqual({ platform: 1, company: 1 });
  });
});

it('company_financial_reconciliation never shows a platform (NULL-org) row; the company row is there', async () => {
  await inRollback(async () => {
    await seedTenants();
    await ins(null, { billing_scope: 'platform' });
    await ins(ORG_A, null);
    const { rows } = await db.query(
      `SELECT organization_id, provider_usd_estimated::float AS usd FROM public.company_financial_reconciliation
        WHERE period_day = '2026-11-13'::timestamptz AND (organization_id IS NULL OR organization_id = $1)`, [ORG_A]);
    expect(rows).toEqual([{ organization_id: ORG_A, usd: 1.25 }]);
  });
});

it('unified_transactions.organization_id is still NOT NULL (platform rows live in usage_events only)', async () => {
  const { rows } = await db.query(
    `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.unified_transactions'::regclass AND attname = 'organization_id'`);
  expect(rows[0].attnotnull).toBe(true);
});
