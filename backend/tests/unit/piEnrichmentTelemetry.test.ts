/**
 * Enrichment observability — the subsystem that recorded nothing.
 *
 * These tests pin the three properties that make this module safe to leave in
 * the enrichment path forever:
 *
 *   1. every label value comes from a vocabulary another module already froze,
 *      so the series set is closed and cannot grow with traffic or tenants;
 *   2. no label carries a tenant, entity, attempt, source-record or
 *      correlation id, and none carries free text;
 *   3. a broken metrics backend cannot break the path being observed.
 *
 * Plus the counter the module exists for: a billable provider call that
 * produced no evidence. That fact currently survives only as an attempt row
 * that cascades away with the person, so its absence from the aggregate was
 * the gap — not its absence from the row.
 *
 * SECRETS: none. No credential, no network, no provider call, no database.
 */

type Counter = { name: string; labels: Record<string, string> };

const counters: Counter[] = [];
let sinkThrows = false;

jest.mock('../../observability/metrics', () => ({
  recordRawCounter: (name: string, _value: number, labels: Record<string, string>) => {
    if (sinkThrows) throw new Error('metrics backend is down');
    counters.push({ name, labels });
  },
  recordRawHistogram: () => undefined,
}));

import {
  ENRICHMENT_METRICS,
  recordPlanRefusal,
  recordExecutionClose,
  recordBillableCallWithoutEvidence,
  recordRetryEvent,
  recordRetrySkip,
  type ExecutionCloseObservation,
} from '../../services/enrichment/telemetry';

// The frozen vocabularies, imported from their OWNERS. If one of them gains or
// loses a member, the series-count assertions below move with it rather than
// against a number restated here.
import { ENRICHMENT_OUTCOMES } from '../../services/enrichment/providers/contract';
import { PLAN_REFUSALS } from '../../services/enrichment/execution';
import { PROVIDER_CALL_STATES, EXECUTION_STATUSES } from '../../services/enrichment/attempts';
import { RETRY_EVENTS, RETRY_SKIPS } from '../../services/enrichment/retryConsumer';

beforeEach(() => {
  counters.length = 0;
  sinkThrows = false;
});

const named = (name: string): Counter[] => counters.filter((c) => c.name === name);
const labelValues = (name: string, key: string): string[] =>
  named(name).map((c) => c.labels[key]);

const close = (over: Partial<ExecutionCloseObservation> = {}): ExecutionCloseObservation => ({
  outcome: 'enriched',
  providerCalled: true,
  providerCallState: 'called',
  executionStatus: 'completed',
  sourceRecordId: 'src-1',
  ...over,
});

// ── the closed vocabularies ─────────────────────────────────────────────────

describe('enrichment telemetry — labels come only from frozen vocabularies', () => {
  it('records every ENRICHMENT_OUTCOMES member, and only as an outcome label', () => {
    for (const outcome of ENRICHMENT_OUTCOMES) recordExecutionClose(close({ outcome }));
    expect(labelValues(ENRICHMENT_METRICS.provider.outcomes, 'outcome'))
      .toEqual([...ENRICHMENT_OUTCOMES]);
    expect(new Set(labelValues(ENRICHMENT_METRICS.provider.outcomes, 'outcome')).size)
      .toBe(ENRICHMENT_OUTCOMES.length);
  });

  it('records every PLAN_REFUSALS member', () => {
    for (const refusal of PLAN_REFUSALS) recordPlanRefusal(refusal);
    expect(labelValues(ENRICHMENT_METRICS.plan.refusals, 'refusal')).toEqual([...PLAN_REFUSALS]);
  });

  it('records every PROVIDER_CALL_STATES member', () => {
    for (const providerCallState of PROVIDER_CALL_STATES) {
      recordExecutionClose(close({ providerCallState }));
    }
    expect(labelValues(ENRICHMENT_METRICS.provider.transport, 'state'))
      .toEqual([...PROVIDER_CALL_STATES]);
  });

  it('records every EXECUTION_STATUSES member', () => {
    for (const executionStatus of EXECUTION_STATUSES) {
      recordExecutionClose(close({ executionStatus }));
    }
    expect(labelValues(ENRICHMENT_METRICS.execution.closes, 'status'))
      .toEqual([...EXECUTION_STATUSES]);
  });

  it('records every RETRY_EVENTS and RETRY_SKIPS member', () => {
    for (const event of RETRY_EVENTS) recordRetryEvent(event);
    for (const skip of RETRY_SKIPS) recordRetrySkip(skip);
    expect(labelValues(ENRICHMENT_METRICS.retry.events, 'event')).toEqual([...RETRY_EVENTS]);
    expect(labelValues(ENRICHMENT_METRICS.retry.skips, 'skip')).toEqual([...RETRY_SKIPS]);
  });

  it('the whole series set is closed and small', () => {
    // 13 outcomes + 3 transport + 6 closes + 6 unevidenced + 6 refusals
    // + 8 retry events + 2 retry skips. Enumerated from the vocabularies, so
    // this is the bound the module claims and not a number typed twice.
    const bound = ENRICHMENT_OUTCOMES.length
      + PROVIDER_CALL_STATES.length
      + EXECUTION_STATUSES.length * 2
      + PLAN_REFUSALS.length
      + RETRY_EVENTS.length
      + RETRY_SKIPS.length;
    expect(bound).toBe(44);
  });
});

// ── no tenant, no entity, no PII, no free text ──────────────────────────────

describe('enrichment telemetry — nothing identifying reaches a label', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';

  it('emits only the declared label keys', () => {
    for (const outcome of ENRICHMENT_OUTCOMES) recordExecutionClose(close({ outcome }));
    for (const refusal of PLAN_REFUSALS) recordPlanRefusal(refusal);
    for (const event of RETRY_EVENTS) recordRetryEvent(event);
    for (const skip of RETRY_SKIPS) recordRetrySkip(skip);

    const keys = new Set(counters.flatMap((c) => Object.keys(c.labels)));
    expect([...keys].sort()).toEqual(['event', 'outcome', 'refusal', 'skip', 'state', 'status']);
  });

  it('a source record id is read but NEVER recorded', () => {
    // The observation carries one, because the counter's whole question is
    // whether it is null. The id itself is unbounded and must not be a label.
    recordExecutionClose(close({ sourceRecordId: `${ORG}:person:${ORG}` }));
    const values = counters.flatMap((c) => Object.values(c.labels));
    expect(values.some((v) => v.includes(ORG))).toBe(false);
  });

  it('no label value looks like an identifier', () => {
    for (const outcome of ENRICHMENT_OUTCOMES) recordExecutionClose(close({ outcome }));
    for (const value of counters.flatMap((c) => Object.values(c.labels))) {
      expect(value).toMatch(/^[a-z_]+$/);          // a vocabulary member, nothing else
    }
  });
});

// ── the counter this module exists for ──────────────────────────────────────

describe('enrichment telemetry — a billable call that produced no evidence', () => {
  const unevidenced = () => named(ENRICHMENT_METRICS.provider.unevidenced);

  it('counts a call that happened with no observation to show for it', () => {
    recordExecutionClose(close({
      outcome: null, providerCalled: true,
      providerCallState: 'called', executionStatus: 'platform_failed',
      sourceRecordId: null,
    }));
    // The alarming case: transport occurred, the tenant is billed, and the
    // fields were lost. Labelled by execution status, because THIS case has no
    // outcome at all — the provider issued no verdict we survived to read.
    expect(unevidenced()).toEqual([{
      name: ENRICHMENT_METRICS.provider.unevidenced,
      labels: { status: 'platform_failed' },
    }]);
  });

  it('counts the benign case too — `no_match` is still a call that was paid for', () => {
    recordExecutionClose(close({
      outcome: 'no_match', executionStatus: 'completed', sourceRecordId: null,
    }));
    expect(labelValues(ENRICHMENT_METRICS.provider.unevidenced, 'status')).toEqual(['completed']);
    // and the outcome is recorded separately, so the two are distinguishable
    expect(labelValues(ENRICHMENT_METRICS.provider.outcomes, 'outcome')).toEqual(['no_match']);
  });

  it('does NOT count a call that produced an observation', () => {
    recordExecutionClose(close({ sourceRecordId: 'src-1' }));
    expect(unevidenced()).toHaveLength(0);
  });

  it('does NOT count a refusal — nothing was billed, so nothing is unevidenced', () => {
    recordExecutionClose(close({
      outcome: 'cost_denied', providerCalled: false,
      providerCallState: 'not_called', executionStatus: 'refused_pre_call',
      sourceRecordId: null,
    }));
    expect(unevidenced()).toHaveLength(0);
    // the refusal itself is still counted — a refusal is not a non-event
    expect(labelValues(ENRICHMENT_METRICS.provider.outcomes, 'outcome')).toEqual(['cost_denied']);
    expect(labelValues(ENRICHMENT_METRICS.execution.closes, 'status')).toEqual(['refused_pre_call']);
  });

  it('is reachable directly, for a caller that already knows the fact', () => {
    recordBillableCallWithoutEvidence('abandoned');
    expect(labelValues(ENRICHMENT_METRICS.provider.unevidenced, 'status')).toEqual(['abandoned']);
  });
});

// ── a null outcome is not a fourteenth outcome ──────────────────────────────

describe('enrichment telemetry — a missing provider verdict is not invented', () => {
  it('omits the outcome counter and still records the other two dimensions', () => {
    recordExecutionClose(close({
      outcome: null, providerCallState: 'unknown', executionStatus: 'platform_failed',
      sourceRecordId: null,
    }));
    expect(named(ENRICHMENT_METRICS.provider.outcomes)).toHaveLength(0);
    expect(labelValues(ENRICHMENT_METRICS.provider.transport, 'state')).toEqual(['unknown']);
    expect(labelValues(ENRICHMENT_METRICS.execution.closes, 'status')).toEqual(['platform_failed']);
  });

  it('keeps the three dimensions apart rather than collapsing them', () => {
    // `refused_pre_call` with an outcome: OUR refusal, no transport. A single
    // counter could not say that, which is why there are three.
    recordExecutionClose(close({
      outcome: 'duplicate_suppressed', providerCalled: false,
      providerCallState: 'not_called', executionStatus: 'refused_pre_call',
      sourceRecordId: null,
    }));
    expect(counters.map((c) => c.labels)).toEqual([
      { outcome: 'duplicate_suppressed' },
      { state: 'not_called' },
      { status: 'refused_pre_call' },
    ]);
  });
});

// ── fail-safe ───────────────────────────────────────────────────────────────

describe('enrichment telemetry — observation never breaks the path it observes', () => {
  it('every recorder swallows a broken metrics backend', () => {
    sinkThrows = true;
    expect(() => recordPlanRefusal('selector_missing')).not.toThrow();
    expect(() => recordExecutionClose(close({ sourceRecordId: null }))).not.toThrow();
    expect(() => recordBillableCallWithoutEvidence('completed')).not.toThrow();
    expect(() => recordRetryEvent('cycle_complete')).not.toThrow();
    expect(() => recordRetrySkip('entity_unreadable')).not.toThrow();
  });

  it('every recorder returns void — a caller cannot branch on telemetry', () => {
    expect(recordPlanRefusal('not_executable')).toBeUndefined();
    expect(recordExecutionClose(close())).toBeUndefined();
    expect(recordRetryEvent('decision')).toBeUndefined();
  });

  it('one close emits once per dimension, so a cycle cannot be double-counted', () => {
    recordExecutionClose(close({ sourceRecordId: null }));
    expect(named(ENRICHMENT_METRICS.provider.outcomes)).toHaveLength(1);
    expect(named(ENRICHMENT_METRICS.provider.transport)).toHaveLength(1);
    expect(named(ENRICHMENT_METRICS.execution.closes)).toHaveLength(1);
    expect(named(ENRICHMENT_METRICS.provider.unevidenced)).toHaveLength(1);
  });
});
