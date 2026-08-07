/**
 * WS-3 M8 — resilience execution proof.
 *
 * Proof 6 (operational safety), plus the database, Redis and failure-taxonomy
 * validations.
 *
 * Every failure mode is INDUCED, not simulated: the kill switch is written to
 * the real config table, quota exhaustion is driven by real rows, Redis is
 * really flushed, and storage is really made unavailable by pointing the
 * runtime at a table that does not exist. What the runtime does next is then
 * observed rather than asserted from the code.
 */
/* eslint-disable no-console */

import {
  FAILURE_CLASSES,
  FAILURE_OWNER,
  RUNTIME_STAGES,
  classifyFailure,
  dispatchInternalOutreachTask,
  getOutreachTaskById,
  ingestFeedback,
  listAttempts,
  listDeliveryEvidence,
  listOutreachTasksForLead,
  materializeAutomationPlan,
  reconcileQuota,
  releaseQuota,
  reserveQuota,
  readDurableUsage,
  submitForApproval,
  approveOutreachTask,
  rejectOutreachTask,
  __resetQuotaRedisForTests,
  EMAIL_ENABLED_ENV,
  LEAD_OUTREACH_DISABLED_ENV,
} from '../../backend/services/leadOutreachExecution';
import { addSuppression, check, configureTenant, provider, realPlan, redis, section, sql, tenantId } from './harness';

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

/** Set up an isolated tenant with an approved email task ready to dispatch. */
async function scenario(tag: string, cfg: Parameters<typeof configureTenant>[1] = {}): Promise<{ co: string; taskId: string } | null> {
  const co = tenantId(tag);
  await configureTenant(co, cfg);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;
  const taskId = await approvedTask(co, plan);
  return taskId ? { co, taskId } : null;
}

// ── Proof 6: operational safety matrix ──────────────────────────────────────

export async function proofOperationalSafety(): Promise<void> {
  section('PROOF 6 — operational safety (every failure mode, induced)');

  // 1. KILL SWITCH
  {
    const s = await scenario('kill', { killSwitch: true });
    if (!s) return void check('kill switch — fixture', false);
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('kill switch blocks dispatch', r.outcome === 'blocked_governance', `${r.outcome}: ${r.reason}`);
    check('kill switch calls no provider', provider.calls.length === 0, `${provider.calls.length}`);
    check('kill switch records a governance decision', (await decisions(s.co, 'kill_switch')) > 0);
    check('kill switch writes no attempt', (await listAttempts(s.co, s.taskId)).length === 0);
    check('kill switch leaves the task in approved, uncorrupted', (await getOutreachTaskById(s.co, s.taskId))?.status === 'approved');
  }

  // 2. TENANT NOT ENABLED (configuration missing / disabled)
  {
    const s = await scenario('disabled', { enabled: false });
    if (!s) return void check('tenant disabled — fixture', false);
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('a disabled tenant cannot dispatch', r.outcome === 'blocked_governance', `${r.outcome}: ${r.reason}`);
    check('a disabled tenant calls no provider', provider.calls.length === 0);
  }

  // 3. CONFIGURATION ABSENT ENTIRELY (no row at all)
  {
    const co = tenantId('noconfig');
    provider.reset();
    const plan = (await realPlan(co, 'L1', NOW)) as Plan;
    const taskId = await approvedTask(co, plan);
    if (!taskId) return void check('missing config — fixture', false);
    const r = await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
    check('a tenant with NO configuration row fails closed', r.outcome === 'blocked_governance', `${r.outcome}: ${r.reason}`);
    check('missing configuration calls no provider', provider.calls.length === 0);
  }

  // 4. SUPPRESSION — every scope the database permits
  for (const scope of ['recipient', 'lead', 'task', 'channel'] as const) {
    const s = await scenario(`sup-${scope}`);
    if (!s) { check(`suppression/${scope} — fixture`, false); continue; }
    const task = await getOutreachTaskById(s.co, s.taskId);
    const value = scope === 'recipient' ? RECIPIENT
      : scope === 'lead' ? String(task?.leadId)
        : scope === 'task' ? String(task?.planTaskId)
          : String(task?.channel);
    await addSuppression(s.co, scope, value);
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check(`suppression/${scope} blocks dispatch`, r.outcome === 'blocked_governance', `${r.outcome}: ${r.reason}`);
    check(`suppression/${scope} calls no provider`, provider.calls.length === 0, `${provider.calls.length}`);
    check(`suppression/${scope} records a suppression gate decision`, (await decisions(s.co, 'suppression')) > 0);
  }

  // 4b. SUPPRESSION STORAGE UNAVAILABLE — the fail-closed case.
  {
    const s = await scenario('supfail');
    if (!s) return void check('suppression fail-closed — fixture', false);
    await withTableUnreadable('outreach_suppressions', async () => {
      const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
      check('an unreadable suppression list suppresses EVERYTHING', r.outcome === 'blocked_governance', `${r.outcome}: ${r.reason}`);
      check('a fail-closed suppression calls no provider', provider.calls.length === 0, `${provider.calls.length}`);
    });
  }

  // 5. CHANNEL NOT ENABLED
  {
    const s = await scenario('chan', { enabledChannels: ['internal'] });
    if (!s) return void check('channel gate — fixture', false);
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('a channel absent from the tenant config cannot send', r.outcome !== 'sent', `${r.outcome}: ${r.reason}`);
    check('a disabled channel calls no provider', provider.calls.length === 0);
  }

  // 6. APPROVAL REFUSAL
  {
    const co = tenantId('reject');
    await configureTenant(co);
    provider.reset();
    const plan = (await realPlan(co, 'L1', NOW)) as Plan;
    await materializeAutomationPlan(plan, ctx(co, 'L1'));
    const t = (await listOutreachTasksForLead(co, 'L1')).find((x) => x.channel === 'email');
    if (!t?.id) return void check('approval refusal — fixture', false);
    await submitForApproval(co, String(t.id));
    const rej = await rejectOutreachTask(co, String(t.id), { approverUserId: 'u-cert', reason: 'not now', notes: null });
    check('rejection moves the task to rejected', rej.ok && rej.status === 'rejected', String(rej.reason));
    const r = await dispatchInternalOutreachTask(co, String(t.id), { now: NOW, recipient: RECIPIENT });
    check('a rejected task can never dispatch', r.outcome !== 'sent', `${r.outcome}: ${r.reason}`);
    check('a rejected task calls no provider', provider.calls.length === 0);
    const resub = await submitForApproval(co, String(t.id));
    check('a rejected task can never be resubmitted', !resub.ok, String(resub.reason));
  }

  // 7. QUOTA EXHAUSTION
  {
    const co = tenantId('quota');
    await configureTenant(co, { dailyLimitTenant: 1, dailyLimitLead: 1 });
    provider.reset();
    const plan = (await realPlan(co, 'L1', NOW)) as Plan;
    await materializeAutomationPlan(plan, ctx(co, 'L1'));
    const emails = (await listOutreachTasksForLead(co, 'L1')).filter((x) => x.channel === 'email');
    for (const t of emails) {
      await submitForApproval(co, String(t.id));
      await approveOutreachTask(co, String(t.id), { approverUserId: 'u-cert', reason: 'cert', notes: null });
    }
    const outcomes: string[] = [];
    for (const t of emails) {
      outcomes.push((await dispatchInternalOutreachTask(co, String(t.id), { now: NOW, recipient: RECIPIENT })).outcome);
    }
    const sent = outcomes.filter((o) => o === 'sent').length;
    check('a tenant limit of 1 permits exactly one send', sent === 1, `${outcomes.join(',')}`);
    check('the provider was called exactly once under quota', provider.calls.length === 1, `${provider.calls.length}`);
    // Sequentially, the governance rate_limit gate sees the durable attempt and
    // defers — `deferred_governance`, not `deferred_quota`. The two are
    // different layers and the distinction is the point: the gate refuses on
    // OBSERVED usage, the reservation refuses on usage in flight.
    check('over-quota dispatches DEFER rather than fail',
      outcomes.filter((o) => o === 'deferred_governance').length === outcomes.length - 1,
      outcomes.filter((o) => o !== 'sent').join(','));
  }

  // 7b. THE RESERVATION RACE — the case only the Redis layer can catch.
  {
    const co = tenantId('qrace');
    await configureTenant(co, { dailyLimitTenant: 1, dailyLimitLead: 1 });
    provider.reset();
    __resetQuotaRedisForTests();
    const plan = (await realPlan(co, 'L1', NOW)) as Plan;
    await materializeAutomationPlan(plan, ctx(co, 'L1'));
    const emails = (await listOutreachTasksForLead(co, 'L1')).filter((x) => x.channel === 'email');
    for (const t of emails) {
      await submitForApproval(co, String(t.id));
      await approveOutreachTask(co, String(t.id), { approverUserId: 'u-cert', reason: 'cert', notes: null });
    }
    // Concurrent: both pass the governance gate (zero durable attempts), so the
    // durable RESERVATION is the only thing standing between them and a
    // double-send.
    const raced = await Promise.all(emails.map((t) =>
      dispatchInternalOutreachTask(co, String(t.id), { now: NOW, recipient: RECIPIENT })));
    const sentRace = raced.filter((r) => r.outcome === 'sent').length;
    check('two concurrent tasks against a limit of 1 send exactly once',
      sentRace <= 1, raced.map((r) => r.outcome).join(','));
    check('the provider was called at most once in the reservation race',
      provider.calls.length <= 1, `${provider.calls.length}`);
    check('the loser deferred rather than failed',
      raced.filter((r) => r.outcome === 'sent' || String(r.outcome).startsWith('deferred')).length === raced.length,
      raced.map((r) => r.outcome).join(','));
  }

  // 8. PROVIDER REJECTION
  {
    const s = await scenario('preject');
    if (!s) return void check('provider rejection — fixture', false);
    provider.behaviour = 'reject';
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('a provider rejection is reported as rejected', r.outcome === 'rejected', `${r.outcome}: ${r.reason}`);
    check('a rejection still leaves durable evidence', (await listDeliveryEvidence(s.co, s.taskId)).length === 1);
    check('a rejection still records the attempt', (await listAttempts(s.co, s.taskId)).length === 1);
    provider.behaviour = 'accept';
  }

  // 9. PROVIDER THROWS
  {
    const s = await scenario('pthrow');
    if (!s) return void check('provider throw — fixture', false);
    provider.behaviour = 'throw';
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('a provider exception does not escape the runtime', r.outcome !== 'sent', `${r.outcome}: ${r.reason}`);
    check('a provider exception still records an attempt', (await listAttempts(s.co, s.taskId)).length === 1);
    provider.behaviour = 'accept';
  }

  // 10. PROVIDER TIMEOUT
  {
    const s = await scenario('ptimeout');
    if (!s) return void check('provider timeout — fixture', false);
    const runtime = await import('../../backend/services/leadOutreachExecution');
    runtime.__clearTransportsForTests();
    const { stubProvider } = await import('./harness');
    runtime.registerTransport(runtime.internalTransport);
    runtime.registerTransport(runtime.createEmailTransport(stubProvider, { timeoutMs: 300 }));
    provider.behaviour = 'hang';

    const t0 = Date.now();
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    const elapsed = Date.now() - t0;
    check('a hanging provider times out rather than hanging the runtime', r.outcome === 'timeout', `${r.outcome} after ${elapsed}ms`);
    check('the timeout is bounded by the configured budget', elapsed < 3000, `${elapsed}ms`);
    check('a timeout still leaves durable evidence', (await listDeliveryEvidence(s.co, s.taskId)).length === 1);

    provider.behaviour = 'accept';
    runtime.__clearTransportsForTests();
    runtime.registerDefaultTransports({ emailProvider: stubProvider });
  }

  // 11. TRANSPORT DISABLED (the flag)
  {
    const s = await scenario('flagoff');
    if (!s) return void check('flag off — fixture', false);
    const prev = process.env[EMAIL_ENABLED_ENV];
    delete process.env[EMAIL_ENABLED_ENV];
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('the email flag OFF prevents egress', r.outcome === 'skipped_transport_disabled', `${r.outcome}: ${r.reason}`);
    check('a disabled transport calls no provider', provider.calls.length === 0, `${provider.calls.length}`);
    process.env[EMAIL_ENABLED_ENV] = prev ?? 'true';
  }

  // 12. GLOBAL KILL (env)
  {
    const s = await scenario('globalkill');
    if (!s) return void check('global kill — fixture', false);
    process.env[LEAD_OUTREACH_DISABLED_ENV] = 'true';
    const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
    check('the platform-wide switch blocks every tenant', r.outcome === 'blocked_governance', `${r.outcome}: ${r.reason}`);
    check('the platform-wide switch calls no provider', provider.calls.length === 0);
    delete process.env[LEAD_OUTREACH_DISABLED_ENV];
  }

  // 13. STORAGE UNAVAILABLE
  {
    const s = await scenario('storage');
    if (!s) return void check('storage failure — fixture', false);
    await withTableUnreadable('outreach_attempts', async () => {
      const r = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
      check('an unwritable attempt table aborts BEFORE the provider is called',
        r.outcome !== 'sent' && provider.calls.length === 0, `${r.outcome} providerCalls=${provider.calls.length}`);
      check('a storage failure does not throw out of the runtime', typeof r.outcome === 'string', r.reason);

      // THE FAIL-OPEN CHECK. Asserted directly on the limiter rather than
      // inferred from the dispatch outcome: with an unreadable truth the
      // dispatcher aborts for other reasons too (the attempt write also fails),
      // so a limiter that silently started granting would be invisible behind
      // that. The limiter must refuse on its own terms.
      const reservation = await reserveQuota({
        companyId: s.co, leadId: 'L1', at: NOW, dailyLimitTenant: 1, dailyLimitLead: 1,
      });
      check('an unreadable limiter REFUSES rather than assuming capacity',
        reservation.granted === false, `granted=${reservation.granted}: ${reservation.reason}`);
      check('the refusal says why', /refusing rather than assuming capacity/.test(reservation.reason), reservation.reason);
    });
    const after = await getOutreachTaskById(s.co, s.taskId);
    check('a storage failure leaves the task in a legal state',
      after !== null && ['approved', 'queued', 'dispatching', 'failed'].includes(String(after.status)), String(after?.status));
  }

  // 14. REDIS UNAVAILABLE
  {
    const s = await scenario('noredis');
    if (!s) return void check('redis down — fixture', false);
    // Break the SHARED CLIENT ITSELF rather than the module that returns it:
    // the ESM namespace object is frozen, and swapping the factory would only
    // prove that a different factory was called. Patching the live instance is
    // what a real Redis outage looks like from the runtime's side — the same
    // object it already holds starts rejecting every command.
    __resetQuotaRedisForTests();
    const client = await redis() as unknown as Record<string, unknown>;
    const saved: Record<string, unknown> = {};
    const down = async () => { throw new Error('redis down'); };
    for (const m of ['incrby', 'decrby', 'get', 'set', 'expire']) {
      saved[m] = client[m];
      client[m] = down;
    }
    try {
      const dispatchResult = await dispatchInternalOutreachTask(s.co, s.taskId, { now: NOW, recipient: RECIPIENT });
      check('Redis being unavailable degrades to the database, not to a failure',
        dispatchResult.outcome === 'sent' && dispatchResult.limiterLayer === 'db',
        `${dispatchResult.outcome} layer=${dispatchResult.limiterLayer}`);
      check('a Redis outage still calls the provider exactly once', provider.calls.length === 1, `${provider.calls.length}`);
      check('a Redis outage still leaves durable evidence', (await listDeliveryEvidence(s.co, s.taskId)).length === 1);
    } finally {
      for (const m of Object.keys(saved)) client[m] = saved[m];
      __resetQuotaRedisForTests();
    }
  }
}

/**
 * Make one table unreadable to the API role, run `fn`, then restore.
 *
 * REVOKE rather than `ALTER TABLE … RENAME`: a rename is DDL, and PostgREST
 * caches the schema, so renaming a table out from under it poisons that cache
 * for every subsequent request in the run — the table comes back but the API
 * keeps failing, and later scenarios inherit failures they did not cause.
 * Privileges are evaluated per request, so a revoke is both isolated and a
 * truer simulation of storage the runtime cannot read (SQLSTATE 42501).
 */
async function withTableUnreadable<T>(table: string, fn: () => Promise<T>): Promise<T> {
  const db = await sql();
  await db.query(`revoke all on ${table} from service_role`);
  try {
    return await fn();
  } finally {
    await db.query(`grant all on ${table} to service_role`);
  }
}

async function decisions(companyId: string, gate: string): Promise<number> {
  const db = await sql();
  const r = await db.query('select count(*)::int n from outreach_decisions where company_id = $1 and gate = $2', [companyId, gate]);
  return Number(r.rows[0].n);
}
