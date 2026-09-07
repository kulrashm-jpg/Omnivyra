/**
 * A7D — the deterministic consumer decision.
 *
 * A5/A6A made the attempt state expressible and A7C made it readable, but
 * nothing turned that state into an action. This file proves the classifier is
 * total, deterministic, side-effect-free, and — where the evidence is
 * ambiguous — refuses rather than guesses.
 *
 * The decisions are recommendations only. Nothing here claims, reclaims,
 * executes, waits, enqueues or escalates; those verbs belong to a scheduler that
 * does not exist.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  decideEnrichmentAction, ENRICHMENT_DECISIONS,
  TRANSIENT_OUTCOMES, TERMINAL_OUTCOMES,
} from '../../services/enrichment/decideEnrichmentAction';
import { EXECUTION_STATUSES, PROVIDER_CALL_STATES } from '../../services/enrichment/attempts';
import type { EnrichmentAttemptRow, ExecutionStatus, ProviderCallState } from '../../services/enrichment/attempts';
import type { EnrichmentOutcome } from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';
const PAST = '2026-09-07T11:00:00.000Z';
const FUTURE = '2026-09-07T13:00:00.000Z';
const LONG_AGO = '2026-09-01T00:00:00.000Z';
const CUTOFF = '2026-09-07T11:30:00.000Z';

/** A completed, successful attempt. Overridden per case. */
const attempt = (over: Partial<EnrichmentAttemptRow> = {}): EnrichmentAttemptRow => ({
  id: 'attempt-1',
  organizationId: ORG,
  subject: 'account',
  entityId: ACCOUNT,
  providerKey: 'clearbit',
  attemptNumber: 1,
  correlationId: 'corr-a7d',
  outcome: 'enriched',
  providerCalled: true,
  providerCallState: 'called',
  executionStatus: 'completed',
  sourceRecordId: 'src-1',
  startedAt: PAST,
  completedAt: PAST,
  claimedBy: null,
  claimedUntil: null,
  nextRetryAt: null,
  requestedAttributes: ['employee_count'],
  ...over,
});

/** Ambient facts: able to call, no fresh evidence, unless overridden. */
const ask = (over: Partial<Parameters<typeof decideEnrichmentAction>[0]> = {}) =>
  decideEnrichmentAction({
    attempt: attempt(),
    now: NOW,
    freshEvidenceCoversRequest: false,
    credentialAvailable: true,
    sourceOperational: true,
    ...over,
  });

// ── the vocabulary ──────────────────────────────────────────────────────────

describe('A7D — the decision vocabulary is closed', () => {
  it('is exactly the five decisions — A7I retired RECLAIM', () => {
    expect([...ENRICHMENT_DECISIONS]).toEqual([
      'NO_ACTION', 'WAIT', 'RETRY_PROVIDER', 'TERMINAL', 'OPERATOR_REVIEW',
    ]);
  });

  it('the outcome categories are exactly those specified, and disjoint', () => {
    expect([...TRANSIENT_OUTCOMES]).toEqual(
      ['rate_limited', 'quota_exceeded', 'timeout', 'provider_unavailable']);
    expect([...TERMINAL_OUTCOMES]).toEqual(['no_match', 'field_not_found', 'provider_declined']);
    for (const t of TRANSIENT_OUTCOMES) expect(TERMINAL_OUTCOMES).not.toContain(t);
  });
});

// ── no attempt ──────────────────────────────────────────────────────────────

describe('A7D — no attempt has ever been made', () => {
  it('fresh evidence → NO_ACTION', () => {
    expect(ask({ attempt: null, freshEvidenceCoversRequest: true }))
      .toEqual({ decision: 'NO_ACTION', reason: 'fresh evidence already covers requested attributes' });
  });

  it('no fresh evidence → RETRY_PROVIDER', () => {
    expect(ask({ attempt: null }).decision).toBe('RETRY_PROVIDER');
  });

  it.each([
    ['credential', { credentialAvailable: false }],
    ['source', { sourceOperational: false }],
  ])('%s unavailable → NO_ACTION, not a retry', (_l, over) => {
    expect(ask({ attempt: null, ...over }).decision).toBe('NO_ACTION');
  });
});

// ── lease ───────────────────────────────────────────────────────────────────

describe('A7D — a live lease outranks everything', () => {
  it('an active lease → WAIT', () => {
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'not_called', claimedBy: 'worker-1', claimedUntil: FUTURE }) }))
      .toEqual({ decision: 'WAIT', reason: 'live lease is active' });
  });

  it('a HEALTHY in-flight call — in_flight + unknown + live lease — is WAIT, not review', () => {
    // The marker writes `unknown` BEFORE transport and the worker holds the
    // lease throughout, so this is what an ordinary provider call in progress
    // looks like. Escalating it would page a human on every call.
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'unknown', claimedBy: 'worker-1', claimedUntil: FUTURE }) })
      .decision).toBe('WAIT');
  });

  it('a lease expiring EXACTLY now is expired, not live', () => {
    // Matches `claimed_until < now` in dbReclaim: strictly-greater means live.
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'not_called', claimedBy: 'w', claimedUntil: NOW }) })
      .decision).toBe('RETRY_PROVIDER');
  });

  it('an expired lease → RETRY_PROVIDER, adopted by the claim (A7I)', () => {
    // Was RECLAIM. The claim already adopts an expired-lease row on 23505, so a
    // separate recovery action was both redundant and the source of the
    // RECLAIM → WAIT → RECLAIM livelock.
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'not_called', claimedBy: 'w', claimedUntil: PAST }) }))
      .toEqual({ decision: 'RETRY_PROVIDER',
        reason: 'expired uncalled attempt is adopted by the claim' });
  });

  it('a live lease is never overridden by fresh evidence or a blocker', () => {
    const live = { completedAt: null, executionStatus: 'in_flight' as ExecutionStatus,
      providerCallState: 'not_called' as ProviderCallState, claimedUntil: FUTURE };
    expect(ask({ attempt: attempt(live), freshEvidenceCoversRequest: true }).decision).toBe('WAIT');
    expect(ask({ attempt: attempt(live), credentialAvailable: false }).decision).toBe('WAIT');
  });
});

// ── unleased stale (A4U) ────────────────────────────────────────────────────

describe('A7D — unleased attempts use the caller\'s cutoff, never an invented one', () => {
  const unleased = (startedAt: string) => attempt({
    completedAt: null, executionStatus: 'in_flight', providerCallState: 'not_called',
    claimedBy: null, claimedUntil: null, startedAt,
  });

  it('stale past the supplied cutoff → RETRY_PROVIDER, adopted by the claim (A7I)', () => {
    expect(ask({ attempt: unleased(LONG_AGO), abandonedBefore: CUTOFF }))
      .toEqual({ decision: 'RETRY_PROVIDER',
        reason: 'unleased attempt is abandoned past the cutoff and is adopted by the claim' });
  });

  it('not yet stale → WAIT', () => {
    expect(ask({ attempt: unleased(NOW), abandonedBefore: CUTOFF }).decision).toBe('WAIT');
  });

  it('NO cutoff supplied → WAIT, never a reclaim on an invented duration', () => {
    // A4N behaviour: without an explicit cutoff only an expired lease is
    // recoverable. Inventing a staleness window here would become the policy.
    const out = ask({ attempt: unleased(LONG_AGO) });
    expect(out.decision).toBe('WAIT');
    expect(out.reason).toMatch(/no abandonment cutoff was supplied/);
  });
});

// ── ambiguity ───────────────────────────────────────────────────────────────

describe('A7D — ambiguity is never resolved into a retry', () => {
  it('unknown call state (unleased) → OPERATOR_REVIEW', () => {
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'unknown', claimedUntil: null }) }))
      .toEqual({ decision: 'OPERATOR_REVIEW',
        reason: 'provider call state is unknown; retry is unsafe' });
  });

  it('unknown with an EXPIRED lease is still OPERATOR_REVIEW, never a retry', () => {
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'unknown', claimedUntil: PAST }) }).decision).toBe('OPERATOR_REVIEW');
  });

  it('platform_failed + called → OPERATOR_REVIEW', () => {
    expect(ask({ attempt: attempt({ executionStatus: 'platform_failed',
      providerCallState: 'called', outcome: null }) }))
      .toEqual({ decision: 'OPERATOR_REVIEW',
        reason: 'provider may have been called but response was not persisted' });
  });

  it('neither ambiguous state is suppressed by fresh evidence', () => {
    // Fresh evidence does not resolve a possible unbilled charge.
    expect(ask({ attempt: attempt({ completedAt: null, providerCallState: 'unknown' }),
      freshEvidenceCoversRequest: true }).decision).toBe('OPERATOR_REVIEW');
    expect(ask({ attempt: attempt({ executionStatus: 'platform_failed',
      providerCallState: 'called', outcome: null }),
      freshEvidenceCoversRequest: true }).decision).toBe('OPERATOR_REVIEW');
  });
});

// ── provably-unpaid failures ────────────────────────────────────────────────

describe('A7D — provably-unpaid failures are freely retryable', () => {
  it('mark_failed + not_called → RETRY_PROVIDER', () => {
    expect(ask({ attempt: attempt({ executionStatus: 'mark_failed',
      providerCallState: 'not_called', outcome: null }) }))
      .toEqual({ decision: 'RETRY_PROVIDER',
        reason: 'pre-call marker failure; provider call is proven not to have occurred' });
  });

  it('platform_failed + not_called → RETRY_PROVIDER', () => {
    expect(ask({ attempt: attempt({ executionStatus: 'platform_failed',
      providerCallState: 'not_called', outcome: null }) }))
      .toEqual({ decision: 'RETRY_PROVIDER', reason: 'platform failure before provider call' });
  });
});

// ── refused pre-call ────────────────────────────────────────────────────────

describe('A7D — a pre-call refusal turns on whether the cause cleared', () => {
  const refused = attempt({ executionStatus: 'refused_pre_call',
    providerCallState: 'not_called', outcome: 'credential_missing', providerCalled: false });

  it.each([
    ['credential unavailable', { credentialAvailable: false },
      'credential unavailable; no provider call should be attempted'],
    ['source unavailable', { sourceOperational: false },
      'source unavailable; no provider call should be attempted'],
  ])('%s → NO_ACTION', (_l, over, reason) => {
    expect(ask({ attempt: refused, ...over })).toEqual({ decision: 'NO_ACTION', reason });
  });

  it('the cause has cleared → RETRY_PROVIDER', () => {
    expect(ask({ attempt: refused }).decision).toBe('RETRY_PROVIDER');
  });
});

// ── completed ───────────────────────────────────────────────────────────────

describe('A7D — a completed attempt is judged by its outcome', () => {
  it.each(TERMINAL_OUTCOMES)('%s → TERMINAL', (outcome) => {
    expect(ask({ attempt: attempt({ outcome: outcome as EnrichmentOutcome }) }))
      .toEqual({ decision: 'TERMINAL', reason: 'terminal provider outcome' });
  });

  it.each(TRANSIENT_OUTCOMES)('%s with a FUTURE horizon → WAIT', (outcome) => {
    expect(ask({ attempt: attempt({ outcome: outcome as EnrichmentOutcome, nextRetryAt: FUTURE }) }))
      .toEqual({ decision: 'WAIT', reason: 'transient outcome is still within retry horizon' });
  });

  it.each(TRANSIENT_OUTCOMES)('%s with a REACHED horizon → RETRY_PROVIDER', (outcome) => {
    expect(ask({ attempt: attempt({ outcome: outcome as EnrichmentOutcome, nextRetryAt: PAST }) }))
      .toEqual({ decision: 'RETRY_PROVIDER', reason: 'transient outcome is eligible after retry horizon' });
  });

  it('a horizon of EXACTLY now is reached, not future', () => {
    expect(ask({ attempt: attempt({ outcome: 'rate_limited', nextRetryAt: NOW }) })
      .decision).toBe('RETRY_PROVIDER');
  });

  it('a transient outcome with NO horizon → OPERATOR_REVIEW, not an invented backoff', () => {
    // A6A preserves a horizon only when the provider supplied one. Absent means
    // "no opinion". No backoff policy exists in this repository, and inventing
    // one here would become the policy by accident.
    const out = ask({ attempt: attempt({ outcome: 'rate_limited', nextRetryAt: null }) });
    expect(out).toEqual({ decision: 'OPERATOR_REVIEW',
      reason: 'transient outcome with no provider retry horizon; no retry policy exists' });
  });

  it('fresh evidence beats a terminal outcome', () => {
    expect(ask({ attempt: attempt({ outcome: 'no_match' }), freshEvidenceCoversRequest: true })
      .decision).toBe('NO_ACTION');
  });

  it('a successful completion with no fresh evidence is not silently retried', () => {
    // `enriched` is in neither category — it is not transient and not a
    // terminal refusal — so it falls through to review rather than to a call.
    expect(ask({ attempt: attempt({ outcome: 'enriched' }) }).decision).toBe('OPERATOR_REVIEW');
  });
});

// ── contradictory and unsupported states ────────────────────────────────────

describe('A7D — anything unrecognised goes to a human, never to a provider', () => {
  it.each([
    ['completed with no outcome', { executionStatus: 'completed', outcome: null }],
    ['mark_failed but called', { executionStatus: 'mark_failed', providerCallState: 'called' }],
    ['refused_pre_call but called', { executionStatus: 'refused_pre_call', providerCallState: 'called' }],
    ['abandoned (no writer exists)', { executionStatus: 'abandoned', outcome: null }],
    ['completed with a non-calling outcome', { executionStatus: 'completed', outcome: 'cost_denied' }],
    ['open row with a terminal status', { completedAt: null, executionStatus: 'completed' }],
  ] as const)('%s → OPERATOR_REVIEW', (_l, over) => {
    const out = ask({ attempt: attempt(over as Partial<EnrichmentAttemptRow>) });
    expect(out.decision).toBe('OPERATOR_REVIEW');
    expect(out.decision).not.toBe('RETRY_PROVIDER');
  });

  it('a malformed lease timestamp → OPERATOR_REVIEW', () => {
    expect(ask({ attempt: attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'not_called', claimedUntil: 'not-a-date' }) }).decision)
      .toBe('OPERATOR_REVIEW');
  });

  it('a malformed clock → OPERATOR_REVIEW rather than a guess', () => {
    expect(ask({ now: 'tomorrow' }).decision).toBe('OPERATOR_REVIEW');
  });

  it('NEVER returns RETRY_PROVIDER across the whole state cross-product', () => {
    // Exhaustive sweep: every status × call state × a representative outcome.
    // Any RETRY_PROVIDER must be one of the four cases proven safe above.
    const safe = new Set(['mark_failed|not_called', 'platform_failed|not_called',
      'refused_pre_call|not_called', 'completed|called', 'completed|not_called']);
    for (const status of EXECUTION_STATUSES) {
      for (const call of PROVIDER_CALL_STATES) {
        const out = ask({ attempt: attempt({ executionStatus: status, providerCallState: call,
          outcome: 'rate_limited', nextRetryAt: PAST }) });
        expect(ENRICHMENT_DECISIONS).toContain(out.decision);
        if (out.decision === 'RETRY_PROVIDER') {
          expect(safe.has(`${status}|${call}`)).toBe(true);
        }
      }
    }
  });
});

// ── determinism and purity ──────────────────────────────────────────────────

describe('A7D — deterministic and side-effect-free', () => {
  it('the same input yields the same decision AND the same reason', () => {
    const input = { attempt: attempt({ outcome: 'rate_limited', nextRetryAt: FUTURE }),
      now: NOW, freshEvidenceCoversRequest: false,
      credentialAvailable: true, sourceOperational: true };
    const a = decideEnrichmentAction(input);
    const b = decideEnrichmentAction(input);
    expect(a).toEqual(b);
    expect(a.reason).toBe(b.reason);
  });

  it('does not mutate its input', () => {
    const row = attempt({ completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'not_called', claimedUntil: FUTURE });
    const snapshot = JSON.stringify(row);
    decideEnrichmentAction({ attempt: row, now: NOW, freshEvidenceCoversRequest: false,
      credentialAvailable: true, sourceOperational: true });
    expect(JSON.stringify(row)).toBe(snapshot);
  });

  it('reads no clock of its own — the answer moves only when `now` does', () => {
    const row = attempt({ outcome: 'rate_limited', nextRetryAt: '2026-09-07T12:30:00.000Z' });
    expect(ask({ attempt: row, now: '2026-09-07T12:00:00.000Z' }).decision).toBe('WAIT');
    expect(ask({ attempt: row, now: '2026-09-07T13:00:00.000Z' }).decision).toBe('RETRY_PROVIDER');
  });

  it('performs no I/O — the module imports no database or provider surface', () => {
    // Comments stripped: the module necessarily DISCUSSES the reclaim and
    // execution seams it deliberately does not touch, so prose would false-positive.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/decideEnrichmentAction.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/ownedDbTable|supabase|fetch\(|safeFetch|await /);
    expect(src).not.toMatch(/setInterval|setTimeout|new Queue|new Worker|\.schedule\(/);
    // It classifies; it never executes what it recommends.
    expect(src).not.toMatch(/executeEnrichment|claimEnrichmentWork|reclaimExpiredAttempt/);
  });
});
