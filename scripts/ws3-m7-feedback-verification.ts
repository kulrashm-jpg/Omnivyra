/**
 * WS-3 Milestone-7 — feedback ingestion verification against a REAL database.
 *
 * The unit suite reproduces the unique indexes in a test double. This script
 * proves the real ones behave the same way, which is the part that actually
 * protects production: an idempotency guarantee that lives only in a mock is
 * not a guarantee.
 *
 * It also proves the append-only triggers still refuse mutation of the columns
 * M7 added, and that the extended CHECK constraint accepts the two new outcome
 * types and still rejects everything else.
 *
 * PRODUCTION BASELINES REMAIN UNAVAILABLE. WS-3 is undeployed and production
 * holds 0 outreach tasks and 0 outcomes, so these are STRUCTURAL measurements
 * against a local certenv instance. They are not production numbers.
 *
 *   npx tsx scripts/ws3-m7-feedback-verification.ts
 */
/* eslint-disable no-console */

const TARGET = String(process.env.SUPABASE_URL ?? '');
if (!/^https?:\/\/(127\.0\.0\.1|localhost):543\d\d/.test(TARGET)) {
  console.error(`\nBLOCKED — local certenv only. Got: ${TARGET || '<unset>'}\n`);
  process.exit(2);
}

import { ownedDbTable } from '../backend/db/writeOwner';
import {
  EXECUTION_RUNTIME_VERSION,
  GOVERNANCE_VERSION,
  INTERNAL_CHANNEL,
  TRANSLATION_VERSION,
  buildFeedbackEnvelope,
  ingestFeedback,
  insertOutreachTask,
  readTaskFeedback,
  setOutreachTaskState,
  type FeedbackEvent,
} from '../backend/services/leadOutreachExecution';

const CO = `m7fb-${Date.now()}`;
const NOW = new Date().toISOString();

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

const mkTask = (planTaskId: string) => ({
  companyId: CO, leadId: 'L1', planTaskId, taskOrder: 1, kind: 'outreach',
  action: 'Send intro email', channel: 'email', dependsOnPlanTaskId: null,
  estimatedDelayHours: 0, confidence: 0.8, explanation: 'Viewed pricing twice',
  requiresApproval: false, plannerVersion: 'lie-2.1.0',
  translationVersion: TRANSLATION_VERSION, governanceVersion: GOVERNANCE_VERSION,
  executionRuntimeVersion: EXECUTION_RUNTIME_VERSION, materializedAt: NOW,
});

const ev = (over: Partial<FeedbackEvent> & { taskId: string }): FeedbackEvent => ({
  companyId: CO, signal: 'replied', occurredAt: '2026-08-05T13:00:00.000Z',
  source: 'provider_webhook', provider: 'ses', ...over,
});

async function main(): Promise<void> {
  console.log(`\nWS-3 M7 — feedback verification against ${TARGET}\n`);
  console.log(`  tenant: ${CO}\n`);

  // ── setup ────────────────────────────────────────────────────────────────
  const created = await insertOutreachTask(mkTask('task-1-intro'));
  if (!created.ok || !created.data?.id) {
    console.error('  SETUP FAILED —', created.error);
    process.exit(1);
  }
  const taskId = String(created.data.id);
  await setOutreachTaskState(CO, taskId, { status: 'sent', deliveryStatus: 'confirmed' });

  // ── 1. the extended CHECK constraint ─────────────────────────────────────
  console.log('1. Outcome vocabulary (real CHECK constraint)');
  for (const signal of ['unsubscribed', 'converted'] as const) {
    const r = await ingestFeedback(ev({ taskId, signal, occurredAt: `2026-08-0${signal === 'converted' ? 7 : 6}T10:00:00.000Z`, providerEventId: `v-${signal}` }));
    check(`accepts '${signal}'`, r.ok && !r.duplicate, r.error ?? '');
  }
  const bogus = await ownedDbTable('outreach_outcomes').insert({
    company_id: CO, task_id: taskId, outcome_type: 'ghosted', derived: false,
    evidence: {}, occurred_at: NOW,
  });
  check('rejects an outcome type outside the vocabulary', !!(bogus as { error?: unknown }).error);

  // ── 2. real idempotency indexes ──────────────────────────────────────────
  console.log('\n2. Idempotency (real unique indexes)');
  const e1 = ev({ taskId, providerEventId: 'evt-real-1' });
  const first = await ingestFeedback(e1);
  const second = await ingestFeedback(e1);
  check('verbatim replay collapses', first.ok && !first.duplicate && second.ok && second.duplicate);

  const restamped = await ingestFeedback(ev({ taskId, providerEventId: 'evt-real-1', occurredAt: '2026-08-05T13:00:07.000Z' }));
  check('provider retry with a new timestamp collapses', restamped.ok && restamped.duplicate);

  const poll = await ingestFeedback(ev({ taskId, source: 'provider_poll', providerEventId: null }));
  check('same instant from another source collapses', poll.ok && poll.duplicate);

  const distinct = await ingestFeedback(ev({ taskId, signal: 'opened', occurredAt: '2026-08-05T14:00:00.000Z', providerEventId: 'evt-real-2' }));
  check('a genuinely different observation is NOT collapsed', distinct.ok && !distinct.duplicate);

  // ── 3. concurrent duplicate webhooks ─────────────────────────────────────
  console.log('\n3. Concurrent duplicate delivery (the race a read-then-write loses)');
  const racer = ev({ taskId, signal: 'clicked', occurredAt: '2026-08-05T15:00:00.000Z', providerEventId: 'evt-race' });
  const raced = await Promise.all(Array.from({ length: 8 }, () => ingestFeedback(racer)));
  const accepted = raced.filter((r) => r.ok && !r.duplicate).length;
  const dupes = raced.filter((r) => r.ok && r.duplicate).length;
  check(`exactly one of 8 concurrent duplicates was accepted (accepted=${accepted}, duplicate=${dupes})`, accepted === 1 && dupes === 7);

  // ── 4. delivery axis + state transition ──────────────────────────────────
  console.log('\n4. Delivery axis');
  const delivered = await ingestFeedback(ev({ taskId, signal: 'delivered', occurredAt: '2026-08-05T12:30:00.000Z', providerEventId: 'evt-d1' }));
  check('delivered advances both delivery and lifecycle', delivered.ok && delivered.stateAdvanced, delivered.stateRefusal ?? '');

  const lateBounce = await ingestFeedback(ev({ taskId, signal: 'bounced', occurredAt: '2026-08-05T12:45:00.000Z', providerEventId: 'evt-b1' }));
  check('a late bounce is refused by the state machine', lateBounce.ok && !lateBounce.stateAdvanced);
  const afterBounce = await readTaskFeedback(CO, taskId);
  check('…but its evidence is kept',
    (afterBounce?.deliveryEvidence ?? []).some((r) => r.delivery_status === 'bounced'));
  check('…and the task stays delivered', afterBounce?.task.deliveryStatus === 'delivered');

  // ── 5. append-only under the real triggers ───────────────────────────────
  console.log('\n5. Append-only (real database triggers)');
  const upd = await ownedDbTable('outreach_outcomes').update({ outcome_type: 'converted' }).eq('company_id', CO);
  check('UPDATE on outreach_outcomes is refused', !!(upd as { error?: unknown }).error);
  const del = await ownedDbTable('outreach_outcomes').delete().eq('company_id', CO);
  check('DELETE on outreach_outcomes is refused', !!(del as { error?: unknown }).error);
  const updD = await ownedDbTable('outreach_delivery_evidence').update({ source: 'manual' }).eq('company_id', CO);
  check('UPDATE on outreach_delivery_evidence is refused', !!(updD as { error?: unknown }).error);

  // ── 6. provenance round-trips ────────────────────────────────────────────
  console.log('\n6. Provenance round-trip');
  const rec = await readTaskFeedback(CO, taskId);
  const withProv = (rec?.outcomes ?? []).find((r) => r.provider_event_id === 'evt-real-1');
  check('source, provider, provider_event_id and metadata persist',
    withProv?.source === 'provider_webhook' && withProv?.provider === 'ses' && withProv?.provider_event_id === 'evt-real-1' && !!withProv?.metadata);

  // ── 7. envelope from real rows ───────────────────────────────────────────
  console.log('\n7. Envelope built from real rows');
  const env = buildFeedbackEnvelope({
    companyId: CO, leadId: 'L1', tasks: [rec!.task],
    deliveryEvidence: rec!.deliveryEvidence, outcomes: rec!.outcomes, now: NOW,
  });
  const again = buildFeedbackEnvelope({
    companyId: CO, leadId: 'L1', tasks: [rec!.task],
    deliveryEvidence: [...rec!.deliveryEvidence].reverse(), outcomes: [...rec!.outcomes].reverse(), now: NOW,
  });
  check('envelope is order-independent on real rows', JSON.stringify(env) === JSON.stringify(again));
  check('timeline is sorted ascending',
    env.timeline.every((e, i) => i === 0 || env.timeline[i - 1].at <= e.at));
  check(`counts match stored rows (delivery=${rec!.deliveryEvidence.length}, outcomes=${rec!.outcomes.length}, timeline=${env.timeline.length})`,
    env.timeline.length === rec!.deliveryEvidence.length + rec!.outcomes.length);
  check('explainability covers all six subjects', env.explainability.length === 6);
  check('no score/weight/rank key anywhere', !/"(\w*score\w*|\w*weight\w*|\w*rank\w*)"/i.test(JSON.stringify(env)));

  // ── 8. tenant isolation ──────────────────────────────────────────────────
  console.log('\n8. Tenant isolation');
  const foreign = await ingestFeedback(ev({ taskId, companyId: `${CO}-other` }));
  check('feedback naming another tenant is refused', !foreign.ok && foreign.rejection === 'task_not_found');

  // ── cleanup ──────────────────────────────────────────────────────────────
  console.log('\n9. Cleanup');
  // Append-only children cannot be deleted and the task FK is ON DELETE
  // RESTRICT, so this tenant's rows are DESIGNED to be undeletable. That is the
  // guarantee working, not a leak — the rows are reported so an operator can
  // account for them.
  const left = await readTaskFeedback(CO, taskId);
  console.log(`  certenv rows retained under ${CO}: 1 task, ${left?.deliveryEvidence.length ?? 0} delivery evidence, ${left?.outcomes.length ?? 0} outcomes`);
  console.log('  (append-only + ON DELETE RESTRICT make these immutable by design; certenv is disposable)');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nUNCAUGHT', e);
  process.exit(1);
});
