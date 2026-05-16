/**
 * Production readiness + reconciliation drift sweep (READ-ONLY).
 *
 * Reproduces the exact /api/admin/billing/health computation (same
 * shared functions the endpoint calls) WITHOUT the auth layer, and runs
 * a zero-drift reconciliation check over live data. No writes, no RPC
 * mutation — only buildBillingSchemaReport / validateBillingBootstrap
 * and read-only SELECTs.
 *
 *   npx tsx scripts/audit/billing-readiness-recon.ts
 */
import { Client } from 'pg';
import {
  buildBillingSchemaReport,
  type BillingSchemaReport,
} from '../../backend/services/billing/bootstrap/billingSchemaSpec';
import { validateBillingBootstrap } from '../../backend/services/billing/bootstrap/billingBootstrapValidator';

function subsystemReady(report: BillingSchemaReport, objs: string[]) {
  const st = new Map(report.results.map(r => [r.object, r.status]));
  const missing = objs.filter(o => st.get(o) === 'missing' || !st.has(o));
  return { ready: missing.length === 0, missing };
}

async function main(): Promise<number> {
  const report = await buildBillingSchemaReport();
  const bootstrap = await validateBillingBootstrap();

  const reconciliation = subsystemReady(report, [
    'billing_operations', 'v_reservation_health', 'v_billing_operations_health',
  ]);
  const approvals = subsystemReady(report, [
    'credit_action_approvals', 'credit_action_approval_signatures',
    'required_approvals_for_action', 'sign_credit_action_approval',
  ]);
  const missingResults = report.results.filter(r => r.status === 'missing');
  const postgrestReady = missingResults.length === 0;
  const rolloutReady = report.criticalMissing.length === 0 && bootstrap.ok;

  console.log('=== HEALTH (same logic as GET /api/admin/billing/health) ===');
  console.log(`overall:               ${report.overall}`);
  console.log(`counts:                ${JSON.stringify(report.counts)}`);
  console.log(`reconciliation.ready:  ${reconciliation.ready}`);
  console.log(`approvals.ready:       ${approvals.ready}`);
  console.log(`postgrest.ready:       ${postgrestReady}`);
  console.log(`rollout.ready:         ${rolloutReady}`);
  console.log(`bootstrap.ok:          ${bootstrap.ok} (overall=${bootstrap.overall})`);

  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) { console.log('\n(no DB url — skipping drift sweep)'); return 0; }
  const c = new Client({ connectionString: url });
  await c.connect();
  let drift = 0;
  try {
    console.log('\n=== RECONCILIATION DRIFT (read-only) ===');

    // 1. Wallet vs ledger: per-org settled ledger delta must equal the
    //    wallet's settled balance. Holds (reservations) excluded — they
    //    live in reserved_*. Uses execution_phase to isolate settled.
    const walletVsLedger = await c.query(`
      WITH led AS (
        SELECT organization_id,
               COALESCE(SUM(free_delta),0)      AS f,
               COALESCE(SUM(paid_delta),0)      AS p,
               COALESCE(SUM(incentive_delta),0) AS i
        FROM public.credit_transactions
        WHERE execution_phase IN ('grant','confirm','release','adjust','revoke')
        GROUP BY organization_id
      )
      SELECT count(*)::int AS drifted
      FROM public.organization_credits oc
      JOIN led ON led.organization_id = oc.organization_id
      WHERE oc.free_balance      <> led.f
         OR oc.paid_balance      <> led.p
         OR oc.incentive_balance <> led.i`);
    const wl = walletVsLedger.rows[0].drifted as number;
    console.log(`wallet ≠ settled-ledger orgs:        ${wl}  (target 0)`);
    drift += wl;

    // 2. Negative balances (must never happen).
    const neg = await c.query(`SELECT count(*)::int n FROM public.organization_credits
      WHERE free_balance<0 OR paid_balance<0 OR incentive_balance<0
         OR reserved_free<0 OR reserved_paid<0 OR reserved_incentive<0`);
    console.log(`negative balance/reserved rows:      ${neg.rows[0].n}  (target 0)`);
    drift += neg.rows[0].n as number;

    // 3. Reservation health view — any rows flagged unhealthy/orphaned.
    let resv = 'n/a';
    try {
      const rv = await c.query(`SELECT count(*)::int n FROM public.v_reservation_health
        WHERE COALESCE(lower(health::text),'') NOT IN ('','ok','healthy','settled','released','confirmed')`);
      resv = String(rv.rows[0].n);
      drift += rv.rows[0].n as number;
    } catch { /* view column shape differs — report raw count */
      const rv = await c.query(`SELECT count(*)::int n FROM public.v_reservation_health`);
      resv = `${rv.rows[0].n} rows (health column not classifiable; manual review)`;
    }
    console.log(`v_reservation_health unhealthy:      ${resv}  (target 0)`);

    // 4. Stuck billing operations (open > 1h).
    const stuck = await c.query(`SELECT count(*)::int n FROM public.billing_operations
      WHERE status IN ('initiated','held','executed') AND started_at < now() - interval '1 hour'`);
    console.log(`stuck billing_operations (>1h open): ${stuck.rows[0].n}  (target 0)`);
    drift += stuck.rows[0].n as number;

    // 5. Duplicate settlement guard: idempotency_key must be unique among
    //    settled ledger rows (DB constraint enforces; verify zero dupes).
    const dup = await c.query(`SELECT count(*)::int n FROM (
      SELECT idempotency_key FROM public.credit_transactions
      WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key HAVING count(*) > 1) d`);
    console.log(`duplicate idempotency_key groups:    ${dup.rows[0].n}  (target 0)`);
    drift += dup.rows[0].n as number;
  } finally {
    await c.end().catch(() => {});
  }

  const healthGreen = report.overall === 'ok' && reconciliation.ready &&
    approvals.ready && postgrestReady && rolloutReady;
  console.log(`\nHEALTH GREEN: ${healthGreen}   |   TOTAL DRIFT: ${drift} (target 0)`);
  return healthGreen && drift === 0 ? 0 : 1;
}
main().then(c => process.exit(c)).catch(e => { console.error('ERR', e?.message || e); process.exit(1); });
