/**
 * WS-3 M8 — pipeline execution proof.
 *
 * Proofs 1–5: the complete chain end to end, concurrent dispatch, concurrent
 * feedback, each idempotency layer independently, and determinism over 50 runs.
 *
 * The property under test throughout is EXACTLY ONCE. Every check that counts
 * rows counts them from the real tables after the fact, and every check that
 * counts provider calls counts them from the stub's own log — so a duplicate
 * that the runtime failed to prevent would show up as a number, not as a
 * silently-passing assertion.
 */
/* eslint-disable no-console */

import {
  buildFeedbackEnvelope,
  dispatchInternalOutreachTask,
  getOutreachTaskById,
  ingestFeedback,
  listAttempts,
  listDeliveryEvidence,
  listInternalWorkItems,
  listOutcomes,
  listOutreachTasksForLead,
  materializeAutomationPlan,
  readTaskFeedback,
  submitForApproval,
  approveOutreachTask,
  translateAutomationPlan,
  type FeedbackEvent,
} from '../../backend/services/leadOutreachExecution';
import { check, configureTenant, measure, nowMs, provider, realPlan, section, sql, tenantId } from './harness';

const NOW = '2026-08-05T12:00:00.000Z';
const RECIPIENT = 'cto@bigcorp.test';

type Plan = Parameters<typeof materializeAutomationPlan>[0];

const ctx = (companyId: string, leadId: string) => ({
  companyId, leadId, plannerVersion: 'lie-2.1.0', materializedAt: NOW,
});

/**
 * Materialise a plan, take the email task through approval, return its id.
 *
 * Reads the task back from storage rather than from the materialisation result:
 * a caller that has already materialised this plan gets `duplicate`, not
 * `created`, and the existing row is exactly the one it wants. Deriving the
 * fixture from the durable state instead of from one call's return value keeps
 * the helper correct in both cases.
 */
async function readyEmailTask(companyId: string, leadId: string, plan: Plan): Promise<string | null> {
  await materializeAutomationPlan(plan, ctx(companyId, leadId));
  const tasks = await listOutreachTasksForLead(companyId, leadId);
  const emailTask = tasks.find((t) => t.channel === 'email' && t.status === 'pending');
  const id = emailTask?.id ? String(emailTask.id) : null;
  if (!id) return null;
  await submitForApproval(companyId, id);
  await approveOutreachTask(companyId, id, { approverUserId: 'u-cert', reason: 'certification', notes: null });
  return id;
}

// ── Proof 1: complete end-to-end execution ──────────────────────────────────

export async function proofEndToEnd(): Promise<void> {
  section('PROOF 1 — complete end-to-end execution (real runtime)');

  const co = tenantId('e2e');
  const lead = 'L1';
  await configureTenant(co);
  provider.reset();

  const plan = (await realPlan(co, lead, NOW)) as Plan;
  const translation = translateAutomationPlan(plan, ctx(co, lead));
  check('WS-2 produced a real plan with translatable tasks', translation.tasks.length > 0, `${translation.tasks.length} tasks`);

  const t0 = nowMs();
  const mat = await materializeAutomationPlan(plan, ctx(co, lead));
  measure('materialisation (whole plan)', `${(nowMs() - t0).toFixed(1)}ms for ${mat.created} task(s)`);
  check('materialisation created durable tasks', mat.created > 0 && mat.failed === 0, `created=${mat.created} dup=${mat.duplicates} skipped=${mat.skipped} failed=${mat.failed}`);

  const created = mat.results.filter((r) => r.status === 'created');
  const emailTask = created.find((r) => r.task?.channel === 'email');
  check('the plan contains an email task to dispatch', !!emailTask, emailTask ? String(emailTask.planTaskId) : 'none');
  if (!emailTask?.task?.id) return;
  const taskId = String(emailTask.task.id);

  const sub = await submitForApproval(co, taskId);
  check('approval submission moved the task to awaiting_approval', sub.ok && sub.status === 'awaiting_approval', String(sub.reason));

  const app = await approveOutreachTask(co, taskId, { approverUserId: 'u-cert', reason: 'certification', notes: 'e2e' });
  check('approval decision moved the task to approved', app.ok && app.status === 'approved', String(app.reason));

  const d0 = nowMs();
  const dispatch = await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  measure('dispatch (governance→quota→transport→evidence)', `${(nowMs() - d0).toFixed(1)}ms`);

  check('dispatch sent through the external transport', dispatch.ok && dispatch.outcome === 'sent', `${dispatch.outcome}: ${dispatch.reason}`);
  check('governance allowed before any transport call', dispatch.governance?.decision === 'allowed', String(dispatch.governance?.decision));
  check('a quota layer answered', dispatch.limiterLayer !== null, String(dispatch.limiterLayer));
  check('the provider was called exactly once', provider.calls.length === 1, `${provider.calls.length} call(s)`);
  check('a provider message id was recorded', !!dispatch.providerMessageId, String(dispatch.providerMessageId));

  const attempts = await listAttempts(co, taskId);
  check('exactly one attempt was recorded', attempts.length === 1, `${attempts.length}`);
  check('the attempt carries its idempotency key and runtime version',
    !!attempts[0]?.idempotency_key && !!attempts[0]?.execution_runtime_version,
    `${String(attempts[0]?.idempotency_key).slice(0, 12)}… / ${String(attempts[0]?.execution_runtime_version)}`);

  const evidence = await listDeliveryEvidence(co, taskId);
  check('exactly one delivery evidence row was written', evidence.length === 1, `${evidence.length}`);
  check('evidence links to the attempt and the provider',
    !!evidence[0]?.attempt_id && evidence[0]?.provider === 'certenv_stub', String(evidence[0]?.provider));

  const f0 = nowMs();
  const delivered = await ingestFeedback({
    companyId: co, taskId, signal: 'delivered', occurredAt: '2026-08-05T12:05:00.000Z',
    source: 'provider_webhook', provider: 'certenv_stub', providerEventId: 'e2e-d1',
  });
  const replied = await ingestFeedback({
    companyId: co, taskId, signal: 'replied', occurredAt: '2026-08-05T14:00:00.000Z',
    source: 'provider_webhook', provider: 'certenv_stub', providerEventId: 'e2e-r1',
    evidence: { snippet: 'interested' },
  });
  measure('feedback ingestion (2 events)', `${(nowMs() - f0).toFixed(1)}ms`);

  check('delivered feedback advanced the delivery axis', delivered.ok && delivered.stateAdvanced, String(delivered.stateRefusal));
  check('replied feedback was recorded on the business axis', replied.ok && replied.axis === 'business', String(replied.recorded?.outcomeType));

  const after = await getOutreachTaskById(co, taskId);
  check('the task reached delivered on both axes', after?.status === 'delivered' && after?.deliveryStatus === 'delivered', `${after?.status}/${after?.deliveryStatus}`);

  const rec = await readTaskFeedback(co, taskId);
  const e0 = nowMs();
  const envelope = buildFeedbackEnvelope({
    companyId: co, leadId: lead, tasks: [rec!.task],
    deliveryEvidence: rec!.deliveryEvidence, outcomes: rec!.outcomes, now: NOW,
  });
  measure('feedback envelope build', `${(nowMs() - e0).toFixed(1)}ms`);

  check('the envelope reports the delivery observed', envelope.delivery.delivered.observed === 1, JSON.stringify(envelope.delivery.delivered));
  check('the envelope reports the reply observed', envelope.response.replied === 1, `${envelope.response.replied}`);
  check('the envelope timeline covers every stored event',
    envelope.timeline.length === rec!.deliveryEvidence.length + rec!.outcomes.length,
    `${envelope.timeline.length} = ${rec!.deliveryEvidence.length}+${rec!.outcomes.length}`);
  check('every summary is explained', envelope.explainability.length === 6, `${envelope.explainability.length}`);

  const work = await listInternalWorkItems(co, taskId);
  check('an external dispatch created no internal work item', work.length === 0, `${work.length}`);
}

// ── Proof 2: concurrent dispatch ────────────────────────────────────────────

export async function proofConcurrentDispatch(): Promise<void> {
  section('PROOF 2 — concurrent dispatch (8 / 16 / 32 dispatchers, one task)');

  for (const workers of [8, 16, 32]) {
    const co = tenantId(`conc${workers}`);
    await configureTenant(co);
    provider.reset();

    const plan = (await realPlan(co, 'L1', NOW)) as Plan;
    const taskId = await readyEmailTask(co, 'L1', plan);
    if (!taskId) { check(`${workers}× — fixture prepared`, false, 'no email task'); continue; }

    const t0 = nowMs();
    const runs = await Promise.all(
      Array.from({ length: workers }, () => dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT })),
    );
    const elapsed = nowMs() - t0;

    const sent = runs.filter((r) => r.outcome === 'sent').length;
    const alreadyDispatched = runs.filter((r) => r.outcome === 'skipped_already_dispatched').length;
    const attempts = await listAttempts(co, taskId);
    const evidence = await listDeliveryEvidence(co, taskId);

    check(`${workers}× — exactly one dispatch sent`, sent === 1, `sent=${sent} already=${alreadyDispatched} other=${workers - sent - alreadyDispatched}`);
    check(`${workers}× — exactly one provider call`, provider.calls.length === 1, `${provider.calls.length}`);
    check(`${workers}× — exactly one attempt row`, attempts.length === 1, `${attempts.length}`);
    check(`${workers}× — exactly one delivery evidence row`, evidence.length === 1, `${evidence.length}`);
    check(`${workers}× — every loser reported a closed-set outcome`,
      runs.every((r) => r.outcome === 'sent' || r.outcome === 'skipped_already_dispatched'),
      [...new Set(runs.map((r) => r.outcome))].join(','));
    measure(`${workers} concurrent dispatchers, wall clock`, `${elapsed.toFixed(1)}ms`);
  }
}

// ── Proof 3: concurrent feedback ────────────────────────────────────────────

export async function proofConcurrentFeedback(): Promise<void> {
  section('PROOF 3 — concurrent feedback (webhook retries)');

  const co = tenantId('fb');
  await configureTenant(co);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;
  const taskId = await readyEmailTask(co, 'L1', plan);
  if (!taskId) { check('fixture prepared', false, 'no email task'); return; }
  await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });

  const base = (over: Partial<FeedbackEvent>): FeedbackEvent => ({
    companyId: co, taskId, signal: 'replied', occurredAt: '2026-08-05T13:00:00.000Z',
    source: 'provider_webhook', provider: 'certenv_stub', providerEventId: 'evt-race', ...over,
  });

  // (a) identical retries, fully parallel
  const parallel = await Promise.all(Array.from({ length: 16 }, () => ingestFeedback(base({}))));
  check('16 parallel identical retries → exactly one accepted',
    parallel.filter((r) => r.ok && !r.duplicate).length === 1 && parallel.filter((r) => r.ok && r.duplicate).length === 15,
    `accepted=${parallel.filter((r) => r.ok && !r.duplicate).length} duplicate=${parallel.filter((r) => r.ok && r.duplicate).length}`);

  // (b) same provider event, re-stamped timestamps
  const restamped = await Promise.all(
    Array.from({ length: 8 }, (_, i) => ingestFeedback(base({ occurredAt: `2026-08-05T13:00:0${i}.000Z` }))),
  );
  check('re-stamped provider retries are all duplicates',
    restamped.every((r) => r.ok && r.duplicate), `${restamped.filter((r) => r.duplicate).length}/8`);

  // (c) cross-source duplicate: same instant, no event id
  const poll = await ingestFeedback(base({ source: 'provider_poll', providerEventId: null }));
  check('a poll reporting the same instant is a duplicate', poll.ok && poll.duplicate, String(poll.rejection ?? 'duplicate'));

  // (d) genuinely distinct events are NOT collapsed
  const distinct = await Promise.all([
    ingestFeedback(base({ signal: 'opened', occurredAt: '2026-08-05T13:10:00.000Z', providerEventId: 'evt-o' })),
    ingestFeedback(base({ signal: 'clicked', occurredAt: '2026-08-05T13:11:00.000Z', providerEventId: 'evt-c' })),
  ]);
  check('distinct observations are all accepted', distinct.every((r) => r.ok && !r.duplicate), `${distinct.filter((r) => !r.duplicate).length}/2`);

  const outcomes = await listOutcomes(co, taskId);
  check('the outcome table holds exactly three rows', outcomes.length === 3, `${outcomes.length}: ${outcomes.map((r) => r.outcome_type).sort().join(',')}`);

  // (e) concurrent DELIVERY-axis retries
  const deliv = await Promise.all(Array.from({ length: 12 }, () => ingestFeedback(base({
    signal: 'delivered', occurredAt: '2026-08-05T12:30:00.000Z', providerEventId: 'evt-d',
  }))));
  const evidence = await listDeliveryEvidence(co, taskId);
  check('12 parallel delivery retries → exactly one new evidence row',
    deliv.filter((r) => r.ok && !r.duplicate).length === 1 && evidence.length === 2,
    `accepted=${deliv.filter((r) => !r.duplicate).length} evidenceRows=${evidence.length}`);
}

// ── Proof 4: idempotency layers, independently ──────────────────────────────

export async function proofIdempotencyLayers(): Promise<void> {
  section('PROOF 4 — every idempotency layer, proven independently');

  const co = tenantId('idem');
  await configureTenant(co);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;

  // (1) TRANSLATION — pure, so identical input yields identical output.
  const a = translateAutomationPlan(plan, ctx(co, 'L1'));
  const b = translateAutomationPlan(plan, ctx(co, 'L1'));
  check('translation is idempotent (byte-identical)', JSON.stringify(a) === JSON.stringify(b));

  // (2) MATERIALIZATION — the identity anchor.
  const m1 = await materializeAutomationPlan(plan, ctx(co, 'L1'));
  const m2 = await materializeAutomationPlan(plan, ctx(co, 'L1'));
  check('re-materialising a regenerated plan creates nothing new',
    m2.created === 0 && m2.duplicates === m1.created, `created=${m2.created} duplicates=${m2.duplicates}`);

  const db = await sql();
  const rows = await db.query('select count(*)::int n from outreach_tasks where company_id = $1', [co]);
  check('the task table holds one row per logical task', Number(rows.rows[0].n) === m1.created, `${rows.rows[0].n} rows for ${m1.created} tasks`);

  // (3) ATTEMPT — (company, task, attempt_number) unique.
  const taskId = await readyEmailTask(co, 'L1', plan);
  if (!taskId) { check('fixture prepared', false); return; }
  await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  const dupAttempt = await db.query(
    `insert into outreach_attempts (company_id, task_id, attempt_number, started_at)
     values ($1, $2, 1, now()) on conflict do nothing returning id`, [co, taskId]);
  check('a second attempt with the same number is refused by the index', dupAttempt.rows.length === 0);

  // (4) PROVIDER — the deterministic idempotency key.
  const attempts = await listAttempts(co, taskId);
  const key = String(attempts[0]?.idempotency_key ?? '');
  const dupKey = await db.query(
    `insert into outreach_attempts (company_id, task_id, attempt_number, started_at, idempotency_key)
     values ($1, $2, 99, now(), $3) on conflict do nothing returning id`, [co, taskId, key]);
  check('the provider idempotency key is unique per tenant', dupKey.rows.length === 0, `${key.slice(0, 16)}…`);
  check('the same attempt always produces the same key',
    provider.calls.length === 1 && provider.calls[0].idempotencyKey === key,
    `${provider.calls.length} call(s)`);

  // (5) DELIVERY — logical + provider-event keys.
  const dupEvidence = await db.query(
    `insert into outreach_delivery_evidence (company_id, task_id, delivery_status, observed_at)
     select company_id, task_id, delivery_status, observed_at from outreach_delivery_evidence
     where company_id = $1 limit 1 on conflict do nothing returning id`, [co]);
  check('a duplicate delivery fact is refused by the logical key', dupEvidence.rows.length === 0);

  // (6) FEEDBACK — both keys, through the real service.
  const ev: FeedbackEvent = {
    companyId: co, taskId, signal: 'replied', occurredAt: '2026-08-05T15:00:00.000Z',
    source: 'provider_webhook', provider: 'certenv_stub', providerEventId: 'idem-1',
  };
  const first = await ingestFeedback(ev);
  const second = await ingestFeedback(ev);
  const third = await ingestFeedback({ ...ev, occurredAt: '2026-08-05T15:00:09.000Z' });
  check('feedback collapses verbatim and re-stamped retries alike',
    !first.duplicate && second.duplicate && third.duplicate,
    `${[first, second, third].map((r) => (r.duplicate ? 'dup' : 'new')).join(',')}`);
}

// ── Proof 5: determinism over 50 runs ───────────────────────────────────────

export async function proofDeterminism(): Promise<void> {
  section('PROOF 5 — determinism across 50 identical runs');

  const co = tenantId('det');
  await configureTenant(co);
  provider.reset();
  const plan = (await realPlan(co, 'L1', NOW)) as Plan;

  const translations = new Set<string>();
  const envelopes = new Set<string>();
  const durations: number[] = [];

  const taskId = await readyEmailTask(co, 'L1', plan);
  if (!taskId) { check('fixture prepared', false); return; }
  await dispatchInternalOutreachTask(co, taskId, { now: NOW, recipient: RECIPIENT });
  await ingestFeedback({
    companyId: co, taskId, signal: 'delivered', occurredAt: '2026-08-05T12:30:00.000Z',
    source: 'provider_webhook', provider: 'certenv_stub', providerEventId: 'det-d',
  });
  const rec = (await readTaskFeedback(co, taskId))!;

  for (let i = 0; i < 50; i += 1) {
    const t0 = nowMs();
    translations.add(JSON.stringify(translateAutomationPlan(plan, ctx(co, 'L1'))));
    envelopes.add(JSON.stringify(buildFeedbackEnvelope({
      companyId: co, leadId: 'L1', tasks: [rec.task],
      deliveryEvidence: rec.deliveryEvidence, outcomes: rec.outcomes, now: NOW,
    })));
    durations.push(nowMs() - t0);
  }

  check('50 translations produced ONE distinct output', translations.size === 1, `${translations.size} distinct`);
  check('50 envelopes produced ONE distinct output', envelopes.size === 1, `${envelopes.size} distinct`);

  // Row ORDER must not change the envelope either — a real read can return rows
  // in any order the planner chooses.
  const shuffled = JSON.stringify(buildFeedbackEnvelope({
    companyId: co, leadId: 'L1', tasks: [rec.task],
    deliveryEvidence: [...rec.deliveryEvidence].reverse(),
    outcomes: [...rec.outcomes].reverse(), now: NOW,
  }));
  check('reversing row order changes nothing', shuffled === [...envelopes][0]);

  measure('translation+envelope, 50 iterations', `total ${durations.reduce((x, y) => x + y, 0).toFixed(1)}ms`);
}
