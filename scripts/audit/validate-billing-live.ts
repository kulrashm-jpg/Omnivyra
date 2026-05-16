/**
 * Live billing validation — PRODUCTION-SAFE.
 *
 * Exercises the real migrated schema (RPCs, triggers, guards, views) on
 * the live database, but inside ONE transaction that always ROLLS BACK.
 * Nothing is ever committed → zero pollution of the immutable financial
 * ledger. Expected-exception probes use SAVEPOINTs so one rejection does
 * not abort the rest. This is the rigorous, non-destructive way to
 * validate "live operations" against an append-only production ledger.
 *
 *   npx tsx scripts/audit/validate-billing-live.ts
 */
import { Client } from 'pg';
import { buildBillingSchemaReport } from '../../backend/services/billing/bootstrap/billingSchemaSpec';

const ORG  = '00000000-0000-0000-0000-0000000000aa';
const PROP = '00000000-0000-0000-0000-0000000000b1';
const A1   = '00000000-0000-0000-0000-0000000000c1';
const A2   = '00000000-0000-0000-0000-0000000000c2';

type R = { name: string; ok: boolean; detail: string };
const results: R[] = [];
const rec = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function expectError(c: Client, name: string, sql: string, wantCodeOrMsg: RegExp) {
  await c.query('SAVEPOINT sp');
  try {
    await c.query(sql);
    await c.query('RELEASE SAVEPOINT sp');
    rec(name, false, 'expected an exception, none raised');
  } catch (e: unknown) {
    await c.query('ROLLBACK TO SAVEPOINT sp');
    const m = e instanceof Error ? e.message : String(e);
    rec(name, wantCodeOrMsg.test(m), wantCodeOrMsg.test(m) ? `correctly blocked (${m.split('\n')[0]})` : `wrong error: ${m}`);
  }
}

async function main(): Promise<number> {
  await buildBillingSchemaReport().catch(() => {});
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL! });
  await c.connect();
  await c.query('BEGIN');
  try {
    // ── Phase B/C — threshold rules + approval workflow ───────────────
    const t1 = await c.query(`SELECT public.required_approvals_for_action('admin_grant', 100) n`);
    rec('threshold admin_grant 100 → 1', t1.rows[0].n === 1, `got ${t1.rows[0].n}`);
    const t2 = await c.query(`SELECT public.required_approvals_for_action('admin_grant', 60000) n`);
    rec('threshold admin_grant 60000 → 3', t2.rows[0].n === 3, `got ${t2.rows[0].n}`);
    const t3 = await c.query(`SELECT public.required_approvals_for_action('admin_refund', 0) n`);
    rec('threshold admin_refund 0 → 2 (SoD)', t3.rows[0].n === 2, `got ${t3.rows[0].n}`);

    const ins = await c.query(
      `INSERT INTO public.credit_action_approvals
         (action_type, organization_id, proposed_by, payload, required_approvals)
       VALUES ('admin_grant',$1,$2,'{"amountCredits":60000}'::jsonb,2)
       RETURNING id`, [ORG, PROP]);
    const aid = ins.rows[0].id;
    rec('approval row inserted', !!aid);

    const s1 = await c.query(`SELECT public.sign_credit_action_approval($1,$2,'approve','ok') r`, [aid, A1]);
    rec('1st signature → still pending', JSON.parse(JSON.stringify(s1.rows[0].r)).status === 'pending',
        `status=${s1.rows[0].r.status} recv=${s1.rows[0].r.approvals_received}`);
    const s2 = await c.query(`SELECT public.sign_credit_action_approval($1,$2,'approve','ok') r`, [aid, A2]);
    rec('2nd signature (N-of-M met) → approved', s2.rows[0].r.status === 'approved',
        `status=${s2.rows[0].r.status}`);

    await expectError(c, 'self-sign rejected (segregation of duties)',
      `SELECT public.sign_credit_action_approval('${aid}','${PROP}','approve',null)`,
      /APPROVAL_SELF_NOT_ALLOWED|APPROVAL_NOT_ACTIONABLE/);

    const r2 = await c.query(
      `INSERT INTO public.credit_action_approvals
         (action_type, organization_id, proposed_by, payload, required_approvals)
       VALUES ('admin_refund',$1,$2,'{"amountCredits":10}'::jsonb,2) RETURNING id`, [ORG, PROP]);
    await c.query(`SELECT public.sign_credit_action_approval($1,$2,'reject','no') r`, [r2.rows[0].id, A1]);
    const rj = await c.query(`SELECT status FROM public.credit_action_approvals WHERE id=$1`, [r2.rows[0].id]);
    rec('rejection path → rejected', rj.rows[0].status === 'rejected', `status=${rj.rows[0].status}`);

    // signature immutability
    await expectError(c, 'signature UPDATE blocked (immutable)',
      `UPDATE public.credit_action_approval_signatures SET decision='reject' WHERE approval_id='${aid}'`,
      /LEDGER_IMMUTABLE/);

    // approval frozen after execute
    await c.query(`UPDATE public.credit_action_approvals SET executed_at=now() WHERE id=$1`, [aid]);
    await expectError(c, 'approval frozen after execute',
      `UPDATE public.credit_action_approvals SET status='cancelled' WHERE id='${aid}'`,
      /APPROVAL_FROZEN/);

    // proposeApproval idempotency upsert — the REAL grant path. Needs a
    // NON-partial unique arbiter for ON CONFLICT (client_request_id);
    // a partial index here = 42P10 on every grant/revoke (hotfix-001).
    await c.query('SAVEPOINT cru');
    try {
      const crid = 'live-validate-' + Date.now();
      const q = `INSERT INTO public.credit_action_approvals
        (action_type,organization_id,proposed_by,payload,required_approvals,client_request_id)
        VALUES ('admin_grant',$1,$2,'{"amountCredits":1}'::jsonb,1,$3)
        ON CONFLICT (client_request_id) DO UPDATE SET updated_at=now()`;
      await c.query(q, [ORG, PROP, crid]);
      await c.query(q, [ORG, PROP, crid]); // 2nd → conflict path, must not error
      await c.query('RELEASE SAVEPOINT cru');
      rec('proposeApproval ON CONFLICT(client_request_id) upsert works', true,
          'idempotent (hotfix-001 applied)');
    } catch (e: unknown) {
      await c.query('ROLLBACK TO SAVEPOINT cru');
      const m = e instanceof Error ? e.message : String(e);
      rec('proposeApproval ON CONFLICT(client_request_id) upsert works', false,
          `${m.split('\n')[0]} — apply docs/audit/billing-hotfix-001-caa-client-request-index.sql`);
    }

    // ── Phase F — job registry idempotency / monotonic guard ──────────
    const h = 'testhash-' + Date.now();
    const j1 = await c.query(
      `SELECT public.claim_job_execution('job1','q1',$1,'corr1','idem1',$2,'{}'::jsonb) r`, [h, ORG]);
    rec('claim_job_execution first_seen=true', j1.rows[0].r.first_seen === true);
    const j2 = await c.query(
      `SELECT public.claim_job_execution('job1','q1',$1,'corr1','idem1',$2,'{}'::jsonb) r`, [h, ORG]);
    rec('replay claim first_seen=false retry bumped',
        j2.rows[0].r.first_seen === false && j2.rows[0].r.retry_count === 1,
        `retry=${j2.rows[0].r.retry_count}`);
    await c.query(`SELECT public.advance_job_execution($1,'completed',null,null)`, [h]);
    await expectError(c, 'job status monotonic (no terminal regression)',
      `SELECT public.advance_job_execution('${h}','in_progress',null,null)`,
      /JER_STATUS_FROZEN/);

    // ── Phase B — billing_operations no-delete guard ──────────────────
    const bo = await c.query(
      `INSERT INTO public.billing_operations
         (correlation_id, module, action, organization_id, idempotency_key)
       VALUES ('corrX','test','admin_grant',$1,'idemX') RETURNING id`, [ORG]);
    rec('billing_operations row inserted', !!bo.rows[0].id);
    await expectError(c, 'billing_operations DELETE blocked',
      `DELETE FROM public.billing_operations WHERE id='${bo.rows[0].id}'`,
      /BILLING_OP_NO_DELETE/);

    // ── Phase G — export manifest immutability ────────────────────────
    const em = await c.query(
      `INSERT INTO public.billing_export_manifests
         (export_type, requested_by, content_sha256, format)
       VALUES ('ledger',$1,'deadbeef','csv') RETURNING id`, [PROP]);
    rec('export manifest inserted (SHA-256 recorded)', !!em.rows[0].id);
    await expectError(c, 'export manifest UPDATE blocked (immutable)',
      `UPDATE public.billing_export_manifests SET content_sha256='x' WHERE id='${em.rows[0].id}'`,
      /LEDGER_IMMUTABLE/);

    // ── FX engine ─────────────────────────────────────────────────────
    const fx1 = await c.query(`SELECT public.lookup_fx_rate('USD','USD') r`);
    rec('lookup_fx_rate USD→USD identity 1.0', Number(fx1.rows[0].r.rate) === 1,
        `rate=${fx1.rows[0].r.rate} provider=${fx1.rows[0].r.provider}`);
    const fx2 = await c.query(`SELECT public.lookup_fx_rate('USD','INR') r`);
    rec('lookup_fx_rate USD→INR null (no cross seed) — handled', fx2.rows[0].r === null,
        `r=${JSON.stringify(fx2.rows[0].r)}`);

    // ── Phase D/E — reconciliation + portal views are queryable ───────
    for (const v of ['v_reservation_health','v_billing_operations_health','v_approval_health',
                      'v_company_financial_timeline','v_pricing_catalog','v_finance_role_holders']) {
      await c.query('SAVEPOINT vp');
      try {
        await c.query(`SELECT * FROM public.${v} LIMIT 1`);
        await c.query('RELEASE SAVEPOINT vp');
        rec(`view ${v} queryable`, true);
      } catch (e: unknown) {
        await c.query('ROLLBACK TO SAVEPOINT vp');
        rec(`view ${v} queryable`, false, e instanceof Error ? e.message : String(e));
      }
    }
  } finally {
    await c.query('ROLLBACK');           // nothing is ever committed
    await c.end().catch(() => {});
  }

  const fail = results.filter(r => !r.ok);
  console.log(`\n${results.length - fail.length}/${results.length} checks passed.`);
  if (fail.length) console.log('FAILED: ' + fail.map(f => f.name).join('; '));
  return fail.length === 0 ? 0 : 1;
}
main().then(c => process.exit(c)).catch(e => { console.error('FATAL', e?.message || e); process.exit(1); });
