/**
 * A6A — the provider's retry horizon survives the execution boundary.
 *
 * ─── THE ONE THING THAT WAS BEING DESTROYED ────────────────────────────────
 * The A6 audit found that every field a retry consumer needs is DERIVABLE from
 * what is already stored — retry class and terminality from `outcome` +
 * `execution_status`, the attempt chain from A4Y's work-item-scoped
 * `attempt_number` — with exactly one exception. A rate-limited attempt recorded
 * THAT it was limited and nothing about when the limit lifts, because the
 * provider states that in a `Retry-After` header which was read by nothing and
 * dropped at the adapter boundary. That information existed nowhere else, so it
 * could not be reconstructed later — only guessed at, which is how a tenant's
 * provider account gets hammered.
 *
 * ─── WHAT THIS FILE PROVES ─────────────────────────────────────────────────
 * That a genuine horizon survives ProviderResponse → executor result → attempt
 * row as an ABSOLUTE instant, and that an absent or malformed one stays absent
 * rather than becoming a fabricated timestamp.
 *
 * It proves NOTHING about retry policy: no backoff, no scheduler, no consumer.
 * A null horizon means "the provider expressed no opinion", never "retry now".
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import { parseRetryAfter, refuse } from '../../services/enrichment/providers/contract';
import { executeEnrichmentRecorded } from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest, EnrichmentOutcome,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';
const NOW_DATE = new Date(NOW);

const request: EnrichmentRequest = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a6a', correlationId: 'corr-a6a',
};

function store() {
  const row = { nextRetryAt: undefined as string | null | undefined, outcome: null as string | null,
    callState: 'not_called' as string, executionStatus: 'in_flight' as string };
  const closes: Record<string, unknown>[] = [];
  return {
    row, closes,
    nextNumber: async () => 1,
    record: async () => ({ attemptId: 'attempt-1' }),
    markPending: async () => { row.callState = 'unknown'; },
    complete: async (i: Record<string, unknown>) => {
      closes.push(i);
      row.nextRetryAt = i.retryAfterAt as string | null | undefined;
      row.outcome = (i.outcome as string | null) ?? null;
      row.callState = (i.providerCallState as string) ?? 'not_called';
      row.executionStatus = i.executionStatus as string;
    },
  };
}

/** An adapter that refuses exactly as the real one does, with a chosen horizon. */
function refusingAdapter(calls: unknown[], outcome: EnrichmentOutcome, retryAfterAt: string | null): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY', isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      return refuse(outcome, ['employee_count'], 'HTTP 429', retryAfterAt);
    },
  };
}

function succeedingAdapter(calls: unknown[]): EnrichmentProviderAdapter {
  return {
    id: 'clearbit', label: 'Clearbit', supports: ['employee_count'],
    credentialEnvVar: 'CLEARBIT_API_KEY', isAvailable: () => false,
    async enrich(r) {
      calls.push(r);
      return {
        outcome: 'enriched', notReturned: [],
        fields: [{
          attribute: 'employee_count', subject: 'account', value: 240,
          observedAt: null, confidence: null, providerInferred: false,
        }],
      };
    },
  };
}

const ports = (over: Partial<ExecuteEnrichmentPorts> = {}): ExecuteEnrichmentPorts => ({
  authorizeCost: async () => ({ authorized: true, holdId: null, cost: { kind: 'unknown' } }),
  releaseCost: async () => { /* tenant-funded: nothing reserved */ },
  resolveCredential: async () => 'synthetic-tenant-provider-key',
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => NOW,
  ...over,
});

const run = (s: ReturnType<typeof store>, adapter: EnrichmentProviderAdapter) =>
  executeEnrichmentRecorded(request, 'clearbit', ports(),
    { adapter, recorder: { ...s, now: () => NOW } as never });

// ── the parser: what a provider actually sends ──────────────────────────────

describe('A6A — Retry-After is parsed, never invented', () => {
  it('delta-seconds resolves against NOW into an absolute instant', () => {
    // Relative is meaningless once stored — "120 seconds" from when? — so the
    // conversion happens at the moment of reading.
    expect(parseRetryAfter('120', NOW_DATE)).toBe('2026-09-07T12:02:00.000Z');
    expect(parseRetryAfter('0', NOW_DATE)).toBe(NOW);
  });

  it('an HTTP-date in the future is preserved as an instant', () => {
    expect(parseRetryAfter('Mon, 07 Sep 2026 12:30:00 GMT', NOW_DATE))
      .toBe('2026-09-07T12:30:00.000Z');
  });

  it.each([
    ['absent', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['non-numeric text', 'soon'],
    ['negative delta', '-30'],
    ['fractional delta', '12.5'],
    ['exponent notation', '1e3'],
    ['hex', '0x10'],
    ['unparseable date', 'Notaday, 99 Xyz 2026'],
  ])('a %s horizon yields null — never a guess', (_label, header) => {
    expect(parseRetryAfter(header as string | null | undefined, NOW_DATE)).toBeNull();
  });

  it('a horizon already in the past is treated as absent, not as "retry now"', () => {
    // The provider may be speaking from a clock we do not share; a stale date
    // authorises nothing.
    expect(parseRetryAfter('Mon, 07 Sep 2026 11:00:00 GMT', NOW_DATE)).toBeNull();
  });

  it('is a pure function of its inputs', () => {
    expect(parseRetryAfter('60', NOW_DATE)).toBe(parseRetryAfter('60', NOW_DATE));
    expect(parseRetryAfter('60', new Date('2026-01-01T00:00:00.000Z')))
      .toBe('2026-01-01T00:01:00.000Z');
  });
});

// ── the full boundary ───────────────────────────────────────────────────────

describe('A6A — a real horizon survives the whole boundary', () => {
  it('provider horizon → executor result → attempt row', async () => {
    const s = store();
    const calls: unknown[] = [];
    const horizon = '2026-09-07T12:05:00.000Z';
    const out = await run(s, refusingAdapter(calls, 'rate_limited', horizon));

    expect(calls).toHaveLength(1);
    expect(out.result.retryAfterAt).toBe(horizon);     // the executor result
    expect(s.row.nextRetryAt).toBe(horizon);           // and the persisted row
  });

  it('the persisted value is an absolute ISO instant, not a duration', async () => {
    const s = store();
    const horizon = '2026-09-07T12:05:00.000Z';
    await run(s, refusingAdapter([], 'rate_limited', horizon));

    expect(typeof s.row.nextRetryAt).toBe('string');
    expect(Number.isFinite(Date.parse(s.row.nextRetryAt as string))).toBe(true);
    expect(s.row.nextRetryAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('an ABSENT horizon stays absent — no timestamp is fabricated', async () => {
    const s = store();
    await run(s, refusingAdapter([], 'rate_limited', null));

    expect(s.row.nextRetryAt ?? null).toBeNull();
  });

  it('a MALFORMED horizon never reaches the row', async () => {
    // The adapter converts through `parseRetryAfter`, so malformed input has
    // already become null before it can be carried anywhere.
    const s = store();
    await run(s, refusingAdapter([], 'rate_limited', parseRetryAfter('soon', NOW_DATE)));

    expect(s.row.nextRetryAt ?? null).toBeNull();
  });

  it('a successful call imposes no wait', async () => {
    const s = store();
    const calls: unknown[] = [];
    const out = await run(s, succeedingAdapter(calls));

    expect(calls).toHaveLength(1);
    expect(out.result.retryAfterAt).toBeNull();
    expect(s.row.nextRetryAt ?? null).toBeNull();
  });

  it('a pre-call refusal carries no horizon — no provider was asked', async () => {
    const s = store();
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request, 'clearbit',
      ports({ resolveCredential: async () => null }),
      { adapter: succeedingAdapter(calls), recorder: { ...s, now: () => NOW } as never });

    expect(calls).toHaveLength(0);
    expect(s.row.nextRetryAt ?? null).toBeNull();
  });
});

// ── nothing else moved ──────────────────────────────────────────────────────

describe('A6A — the existing dimensions are unchanged', () => {
  it('the provider outcome is preserved exactly', async () => {
    for (const outcome of ['rate_limited', 'quota_exceeded', 'provider_unavailable'] as const) {
      const s = store();
      await run(s, refusingAdapter([], outcome, '2026-09-07T12:05:00.000Z'));
      expect(s.row.outcome).toBe(outcome);
    }
  });

  it('execution status and provider-call state are unchanged by a horizon', async () => {
    const withHorizon = store();
    await run(withHorizon, refusingAdapter([], 'rate_limited', '2026-09-07T12:05:00.000Z'));
    const without = store();
    await run(without, refusingAdapter([], 'rate_limited', null));

    // A provider that answered is `completed` + `called` either way: the horizon
    // is a fourth, independent fact and does not reclassify anything.
    expect(withHorizon.row.executionStatus).toBe('completed');
    expect(withHorizon.row.callState).toBe('called');
    expect(without.row.executionStatus).toBe(withHorizon.row.executionStatus);
    expect(without.row.callState).toBe(withHorizon.row.callState);
  });

  it('A4V is untouched: a mark failure still carries no horizon', async () => {
    const s = store();
    const calls: unknown[] = [];
    const boom = new Error('attempts store unavailable');
    const broken = { ...s, now: () => NOW, markPending: async () => { throw boom; } };

    await expect(executeEnrichmentRecorded(request, 'clearbit', ports(),
      { adapter: refusingAdapter(calls, 'rate_limited', '2026-09-07T12:05:00.000Z'),
        recorder: broken as never })).rejects.toBe(boom);

    expect(calls).toHaveLength(0);                    // fail-closed preserved
    expect(s.row.executionStatus).toBe('mark_failed');
    expect(s.row.nextRetryAt ?? null).toBeNull();     // no response ⇒ no horizon
  });

  it('A4E is untouched: a post-provider failure carries no horizon', async () => {
    const s = store();
    const calls: unknown[] = [];
    await expect(executeEnrichmentRecorded(request, 'clearbit',
      ports({ persistObservation: async () => { throw new Error('persist exploded'); } }),
      { adapter: succeedingAdapter(calls), recorder: { ...s, now: () => NOW } as never }))
      .rejects.toThrow(/persist exploded/);

    expect(calls).toHaveLength(1);
    expect(s.row.executionStatus).toBe('platform_failed');
    expect(s.row.callState).toBe('called');
    expect(s.row.nextRetryAt ?? null).toBeNull();
  });

  it('no retry classification, terminality or policy was introduced', () => {
    const code = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/attempts.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/retry_class|prior_attempt_id|retry_policy_version|max_attempts|rate_limit_reset_at/);
    expect(code).not.toMatch(/setInterval|setTimeout|node-cron|new Queue|new Worker|\.schedule\(/);
  });
});
