/**
 * WS-3 M8 — infrastructure execution proof.
 *
 * The database, Redis and failure-taxonomy validations. Split from
 *  purely so neither file exceeds the repository's 500-line
 * guideline; the two run as one certification pass.
 *
 * Everything here talks to the real thing. The append-only and immutability
 * assertions are issued over a DIRECT libpq connection as the table owner —
 * the strongest form of the guarantee, since a trigger that only stops the API
 * role is not an audit trail.
 */
/* eslint-disable no-console */

import {
  FAILURE_CLASSES,
  FAILURE_OWNER,
  RUNTIME_STAGES,
  approveOutreachTask,
  classifyFailure,
  dispatchInternalOutreachTask,
  ingestFeedback,
  listOutreachTasksForLead,
  materializeAutomationPlan,
  readDurableUsage,
  reconcileQuota,
  releaseQuota,
  rejectOutreachTask,
  reserveQuota,
  submitForApproval,
  __resetQuotaRedisForTests,
} from '../../backend/services/leadOutreachExecution';
import { check, configureTenant, provider, realPlan, redis, section, sql, tenantId } from './harness';

const NOW = '2026-08-05T12:00:00.000Z';
const RECIPIENT = 'cto@bigcorp.test';
type Plan = Parameters<typeof materializeAutomationPlan>[0];
const ctx = (companyId: string, leadId: string) => ({ companyId, leadId, plannerVersion: 'lie-2.1.0', materializedAt: NOW });

async function approvedTask(co: string, plan: Plan): Promise<string | null> {
  await materializeAutomationPlan(plan, ctx(co, 'L1'));
  const tasks = await listOutreachTasksForLead(co, 'L1');
  const t = tasks.find((x) => x.channel === 'email' && x.status === 'pending');
  if (!t?.id) return null;
  await submitForApproval(co, String(t.id));
  await approveOutreachTask(co, String(t.id), { approverUserId: 'u-cert', reason: 'cert', notes: null });
  return String(t.id);
}

// ── Database validation ─────────────────────────────────────────────────────

export async function proofDatabase(): Promise<void> {
  section('DATABASE — real PostgreSQL, no mocks');
  const db = await sql();

  const co = tenantId('db');
  await configureTenant(co);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;
  const taskId = await approvedTask(co, plan);
  if (!taskId) return void check('fixture', false);
  await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  // Give every audit table at least one row: a BEFORE UPDATE ROW trigger that
  // matches nothing fires nothing, so asserting refusal against an empty table
  // would pass for the wrong reason.
  await ingestFeedback({
    companyId: co, taskId, signal: 'replied', occurredAt: '2026-08-05T15:00:00.000Z',
    source: 'provider_webhook', provider: 'certenv_stub', providerEventId: 'db-1',
  });

  // Append-only, as the table OWNER — the strongest form of the guarantee.
  for (const t of ['outreach_approvals', 'outreach_attempts', 'outreach_delivery_evidence', 'outreach_outcomes', 'outreach_decisions']) {
    const present = Number((await db.query(`select count(*)::int n from ${t} where company_id = $1`, [co])).rows[0].n);
    check(`${t}: fixture has rows to protect`, present > 0, `${present} row(s)`);
    for (const op of [`update ${t} set company_id = company_id where company_id = $1`, `delete from ${t} where company_id = $1`]) {
      let refused = false;
      try { await db.query(op, [co]); } catch { refused = true; }
      check(`${t}: ${op.startsWith('update') ? 'UPDATE' : 'DELETE'} refused by trigger`, refused);
    }
  }

  // Provenance immutability. The value must actually CHANGE: the trigger tests
  // `IS DISTINCT FROM`, so `set col = col` is correctly a no-op rather than a
  // mutation, and asserting against it would prove nothing.
  // `company_id` is `uuid` after A3, not `text`. `company_id || '-x'` would raise
  // 42883 (no `uuid || text` operator) and the catch below would record that as
  // "refused" — a green assertion that no longer exercises the trigger at all.
  // `gen_random_uuid()` is a genuinely different, genuinely valid value, so the
  // refusal it provokes is the provenance guard and nothing else.
  // `lead_id` and `plan_task_id` remain `text` (A3 deliberately did not retype
  // them), so their concatenation still mutates as intended.
  const mutation: Record<string, string> = {
    company_id: `gen_random_uuid()`, lead_id: `lead_id || '-x'`, plan_task_id: `plan_task_id || '-x'`,
    planner_version: `planner_version || '-x'`, translation_version: `translation_version || '-x'`,
    governance_version: `governance_version || '-x'`, execution_runtime_version: `execution_runtime_version || '-x'`,
    materialized_at: `materialized_at + interval '1 day'`,
  };
  for (const [col, expr] of Object.entries(mutation)) {
    let refused = false;
    try { await db.query(`update outreach_tasks set ${col} = ${expr} where id = $1`, [taskId]); } catch { refused = true; }
    check(`outreach_tasks.${col} is immutable`, refused);
  }
  const unchanged = await db.query('select planner_version, materialized_at from outreach_tasks where id = $1', [taskId]);
  check('provenance survived every mutation attempt', unchanged.rows[0].planner_version === 'lie-2.1.0', String(unchanged.rows[0].planner_version));

  // Foreign keys + ON DELETE RESTRICT.
  let restricted = false;
  try { await db.query('delete from outreach_tasks where id = $1', [taskId]); } catch { restricted = true; }
  check('a task with audit history cannot be deleted (ON DELETE RESTRICT)', restricted);

  const orphan = await db.query(
    `insert into outreach_outcomes (company_id, task_id, outcome_type, occurred_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'replied', now())
     on conflict do nothing returning id`, [co]).then(() => false).catch(() => true);
  check('an outcome cannot reference a non-existent task (FK)', orphan);

  // Unique indexes actually present in the catalog.
  const idx = await db.query(
    `select indexname from pg_indexes where tablename like 'outreach%' and indexdef ilike '%unique%'`);
  const names = idx.rows.map((r) => String(r.indexname));
  for (const required of [
    'outreach_tasks_identity_unique', 'outreach_outcomes_idempotent',
    'uq_outreach_outcomes_provider_event', 'uq_outreach_delivery_provider_event',
    'uq_outreach_delivery_logical',
  ]) {
    check(`unique index ${required} exists`, names.some((n) => n.includes(required)), '');
  }

  // RLS enabled on every WS-3 table.
  const rls = await db.query(
    `select relname, relrowsecurity from pg_class where relname like 'outreach%' and relkind = 'r'`);
  check('RLS is enabled on every WS-3 table',
    rls.rows.every((r) => r.relrowsecurity === true),
    rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(',') || `${rls.rows.length} tables`);

  // Compare-and-set really is atomic: two updates racing on the same predicate.
  const co2 = tenantId('cas');
  await configureTenant(co2);
  const plan2 = (await realPlan(co2, 'L1', NOW)) as Plan;
  await materializeAutomationPlan(plan2, ctx(co2, 'L1'));
  const t2 = (await listOutreachTasksForLead(co2, 'L1')).find((x) => x.channel === 'email');
  if (t2?.id) {
    await submitForApproval(co2, String(t2.id));
    const both = await Promise.all([
      approveOutreachTask(co2, String(t2.id), { approverUserId: 'a', reason: 'r', notes: null }),
      rejectOutreachTask(co2, String(t2.id), { approverUserId: 'b', reason: 'r', notes: null }),
    ]);
    check('a contested approval has exactly one winner',
      both.filter((r) => r.ok && r.changed).length === 1, both.map((r) => `${r.ok}/${r.status}`).join(' '));
  }

  // Audit history survives everything above.
  const hist = await db.query('select count(*)::int n from outreach_decisions where company_id = $1', [co]);
  check('the governance audit trail is non-empty and intact', Number(hist.rows[0].n) > 0, `${hist.rows[0].n} decisions`);

  // Migration set actually applied.
  const cols = await db.query(
    `select count(*)::int n from information_schema.columns
     where table_name = 'outreach_outcomes' and column_name in ('source','provider','provider_event_id','metadata')`);
  check('the M7 migration is applied to this database', Number(cols.rows[0].n) === 4, `${cols.rows[0].n}/4 columns`);
}

// ── Redis validation ────────────────────────────────────────────────────────

export async function proofRedis(): Promise<void> {
  section('REDIS — reservation, release, reconciliation, drift');

  const co = tenantId('redis');
  await configureTenant(co);
  const r = await redis();
  __resetQuotaRedisForTests();

  const tenantKey = `ws3:quota:tenant:${co}`;
  const leadKey = `ws3:quota:lead:${co}:L1`;
  await r.del(tenantKey);
  await r.del(leadKey);

  const base = { companyId: co, leadId: 'L1', at: NOW, dailyLimitTenant: 3, dailyLimitLead: 3 };

  const r1 = await reserveQuota(base);
  check('a reservation is granted through the Redis fast path', r1.granted && r1.layer === 'redis', `${r1.layer}: ${r1.reason}`);
  check('the reservation incremented Redis', Number(await r.get(tenantKey)) === 1, String(await r.get(tenantKey)));

  await releaseQuota(co, 'L1', r1);
  check('releasing a reservation decrements Redis', Number(await r.get(tenantKey)) === 0, String(await r.get(tenantKey)));

  // Sequential: the non-racy case must be exact.
  await r.del(tenantKey); await r.del(leadKey);
  const sequential: boolean[] = [];
  for (let i = 0; i < 10; i += 1) sequential.push((await reserveQuota(base)).granted);
  check('10 sequential reservations against a limit of 3 grant exactly 3',
    sequential.filter(Boolean).length === 3, `${sequential.filter(Boolean).length} granted`);

  // Concurrent: 10 racers against a limit of 3.
  //
  // The assertion is `<= 3`, not `=== 3`, and the inequality is the point. A
  // refused reservation releases both counters, so a release landing between
  // another racer's increment and its own read can make that racer observe a
  // higher count and refuse — the protocol UNDER-grants at the margin under
  // contention. That direction is safe. Over-granting is the failure that
  // would send a message the tenant did not authorise, and it is asserted
  // exactly. Demanding a precise count here would be asserting a scheduling
  // artefact, and a proof that fails on thread interleaving teaches operators
  // to ignore it.
  await r.del(tenantKey); await r.del(leadKey);
  const racers = await Promise.all(Array.from({ length: 10 }, () => reserveQuota(base)));
  const granted = racers.filter((x) => x.granted).length;
  check('10 concurrent reservations NEVER exceed the limit of 3', granted <= 3, `${granted} granted`);
  check('concurrent reservations do not deadlock to zero', granted >= 1, `${granted} granted`);
  check('every refusal names the limit it hit',
    racers.filter((x) => !x.granted).every((x) => /limit of \d+/.test(x.reason)),
    [...new Set(racers.filter((x) => !x.granted).map((x) => x.reason))].join(' | '));

  // Reconciliation SETs to durable truth, never adjusts by a delta.
  await r.set(tenantKey, '999');
  const rec = await reconcileQuota(co, 'L1', NOW);
  const after = Number(await r.get(tenantKey));
  check('reconciliation SETs Redis to the durable count', after === rec.tenantCount, `redis=${after} durable=${rec.tenantCount}`);
  check('reconciliation reports the drift it corrected', rec.drift === 999 - rec.tenantCount, `drift=${rec.drift}`);

  // Redis BEHIND the database — the truth must win.
  await r.set(tenantKey, '0');
  const durable = await readDurableUsage(co, 'L1', NOW);
  const behind = await reserveQuota({ ...base, dailyLimitTenant: durable.tenantCount + 1 });
  check('a Redis counter behind the database is overridden by the truth',
    behind.tenantCount >= durable.tenantCount + 1, `redisWas=0 durable=${durable.tenantCount} used=${behind.tenantCount}`);
  await releaseQuota(co, 'L1', behind);

  // Redis AHEAD of the database — the reservation stands (it is a pending send).
  await r.set(tenantKey, String(durable.tenantCount + 50));
  const ahead = await reserveQuota({ ...base, dailyLimitTenant: durable.tenantCount + 10 });
  check('a Redis counter ahead of the database refuses rather than over-permits',
    !ahead.granted, `${ahead.reason}`);

  // Key expiry / reset.
  await r.del(tenantKey); await r.del(leadKey);
  const reset = await reserveQuota(base);
  check('an expired Redis key falls back to the database count, not to zero',
    reset.tenantCount >= durable.tenantCount + 1, `used=${reset.tenantCount} durable=${durable.tenantCount}`);
  await releaseQuota(co, 'L1', reset);
}

// ── Failure taxonomy ────────────────────────────────────────────────────────

export async function proofFailureTaxonomy(): Promise<void> {
  section('FAILURE TAXONOMY — all 9 classes, deterministic classification');

  check('exactly nine closed failure classes', FAILURE_CLASSES.length === 9, FAILURE_CLASSES.join(','));
  check('exactly nine runtime stages', RUNTIME_STAGES.length === 9, RUNTIME_STAGES.join(','));
  check('every class has a named owner',
    FAILURE_CLASSES.every((c) => typeof FAILURE_OWNER[c] === 'string' && FAILURE_OWNER[c].length > 0));

  const cases: Array<[string, unknown, string]> = [
    ['governance', new Error('rules unreadable'), 'governance_failure'],
    ['provider', new Error('provider rejected the message'), 'provider_failure'],
    ['dispatch', new Error('unexpected'), 'dispatch_failure'],
    ['transport', new Error('the transport did not respond'), 'transport_failure'],
    ['quota', new Error('limiter unavailable'), 'quota_failure'],
    ['evidence', new Error('write refused'), 'persistence_failure'],
    ['translation', new Error('bad shape'), 'runtime_failure'],
    ['approval', new Error('tenant is not enabled'), 'configuration_failure'],
    ['nonsense-stage', new Error('???'), 'unknown_failure'],
  ];
  for (const [stage, err, expected] of cases) {
    const got = classifyFailure(stage, err);
    check(`${stage} + "${String((err as Error).message).slice(0, 28)}" → ${expected}`, got === expected, got);
  }

  check('every class is reachable from some (stage, error) pair',
    new Set(cases.map(([s, e]) => classifyFailure(s, e))).size === 9,
    `${new Set(cases.map(([s, e]) => classifyFailure(s, e))).size}/9`);

  // A database failure inside governance is a PERSISTENCE failure, not a
  // governance one — the rules are fine, the storage is not.
  check('a storage error inside governance pages the platform, not the rule owner',
    classifyFailure('governance', new Error('connection failure')) === 'persistence_failure');
  check('classification is a pure function of its inputs',
    classifyFailure('provider', new Error('timeout')) === classifyFailure('provider', new Error('timeout')));

  // Real induced failure: the classification the runtime itself produced.
  const co = tenantId('tax');
  await configureTenant(co);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;
  const taskId = await approvedTask(co, plan);
  if (!taskId) return void check('fixture', false);
  provider.behaviour = 'reject';
  const r = await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  provider.behaviour = 'accept';
  check('a live provider rejection classifies as provider_failure',
    classifyFailure('provider', r.reason) === 'provider_failure', `${r.reason}`);
  const ing = await ingestFeedback({ companyId: co, taskId: 'nope', signal: 'replied', occurredAt: NOW, source: 'manual' });
  check('feedback for an unknown task is rejected, not misclassified', !ing.ok && ing.rejection === 'task_not_found', String(ing.rejection));
}
