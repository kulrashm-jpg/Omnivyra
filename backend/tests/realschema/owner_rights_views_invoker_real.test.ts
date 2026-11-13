/**
 * 20270217000043 on the REAL schema: the 29 owner-rights views run as security_invoker, and the app's reader
 * (service_role) still reads them while client roles stay refused.
 *
 * The governed replay gives service_role NO default grants (hosted Supabase gives it ALL), so prod's precondition -
 * measured by 83 (C64/C65): service_role holds SELECT on every view AND on every base relation behind them, with
 * BYPASSRLS - is modelled EXPLICITLY inside the rolled-back transaction, then invoker semantics are exercised:
 *   - every one of the 29 is security_invoker (relkind 'v');
 *   - service_role SELECTs every one of the 29 without error;
 *   - a seeded row is returned THROUGH an invoker view (company_financial_reconciliation over usage_events);
 *   - CONTROL / proof the flip is real: without SELECT on a base table, service_role is refused (42501) by the
 *     invoker view - under owner rights the same read would have succeeded;
 *   - authenticated is refused on every one of the 29.
 */
import { db, inRollback, seedTenants, ORG_A } from './setup';

const VIEWS = [
  'ai_suggestion_acceptance_rate', 'canonical_campaign_entities', 'canonical_company_entities',
  'community_ai_execution_success_rate', 'company_blog_performance_summary', 'company_financial_reconciliation',
  'cost_margin_daily_view', 'cost_monitoring_daily_view', 'deep_view', 'free_credits_activity', 'growth_view',
  'identity_health_metrics', 'market_pulse_latest_run_view', 'org_economics_view', 'pricing_health_view',
  'retention_candidates', 'snapshot_view', 'unified_transactions_with_anomalies_view', 'v_approval_health',
  'v_billing_operations_health', 'v_company_financial_timeline', 'v_finance_role_holders', 'v_pricing_catalog',
  'v_reservation_health', 'vw_company_report_stats', 'vw_feature_completion_summary', 'vw_free_reports_by_domain',
  'weekly_alignment_summary', 'weekly_refinement_status',
];

/** Models prod's grants (83 C64): SELECT on the 29 views and on every base relation they read. */
async function modelProdServiceRoleGrants(): Promise<void> {
  const { rows } = await db.query(
    `SELECT DISTINCT c2.oid::regclass::text AS dep
       FROM pg_class v JOIN pg_namespace n ON n.oid = v.relnamespace AND n.nspname = 'public'
       JOIN pg_rewrite rw ON rw.ev_class = v.oid
       JOIN pg_depend d ON d.objid = rw.oid AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
       JOIN pg_class c2 ON c2.oid = d.refobjid AND c2.oid <> v.oid
      WHERE v.relname = ANY($1)`, [VIEWS]);
  for (const r of rows) await db.query(`GRANT SELECT ON ${r.dep} TO service_role`);
  for (const v of VIEWS) await db.query(`GRANT SELECT ON public.${v} TO service_role`);
}

it('all 29 are views and security_invoker', async () => {
  const { rows } = await db.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relname = ANY($1) AND c.relkind = 'v' AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))`, [VIEWS]);
  expect(rows.map((r) => r.relname).sort()).toEqual([...VIEWS].sort());
});

it('service_role (prod grants modelled) reads every one of the 29, and a seeded row comes back through an invoker view', async () => {
  await inRollback(async () => {
    await seedTenants();
    await db.query(
      `INSERT INTO public.usage_events (organization_id, source_type, source_name, process_type, total_cost_usd, created_at)
       VALUES ($1, 'llm', 'probe', 'probe', 1.25, '2026-11-13T10:00:00Z')`, [ORG_A]);
    await modelProdServiceRoleGrants();
    await db.query('SET LOCAL ROLE service_role');
    for (const v of VIEWS) {
      await db.query('SAVEPOINT r');
      await expect(db.query(`SELECT 1 FROM public.${v} LIMIT 1`)).resolves.toBeDefined();
      await db.query('RELEASE SAVEPOINT r');
    }
    const { rows } = await db.query(
      `SELECT provider_usd_estimated::float AS usd FROM public.company_financial_reconciliation
        WHERE organization_id = $1 AND period_day = '2026-11-13'::timestamptz`, [ORG_A]);
    expect(rows).toEqual([{ usd: 1.25 }]);
  });
});

it('CONTROL - the flip is real: without SELECT on a base table, the invoker view refuses service_role (owner rights would not)', async () => {
  await inRollback(async () => {
    await modelProdServiceRoleGrants();
    await db.query('REVOKE SELECT ON public.usage_events FROM service_role');
    await db.query('SET LOCAL ROLE service_role');
    await db.query('SAVEPOINT r');
    await expect(db.query('SELECT 1 FROM public.company_financial_reconciliation LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await db.query('ROLLBACK TO SAVEPOINT r');
  });
});

it('authenticated is refused on every one of the 29', async () => {
  await inRollback(async () => {
    await db.query('SET LOCAL ROLE authenticated');
    for (const v of VIEWS) {
      await db.query('SAVEPOINT a');
      await expect(db.query(`SELECT 1 FROM public.${v} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
      await db.query('ROLLBACK TO SAVEPOINT a');
    }
  });
});
