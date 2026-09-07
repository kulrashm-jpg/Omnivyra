/**
 * A7E — the consumer integration.
 *
 * A7D decides; this seam acts, exclusively through primitives that already
 * exist. What matters here is not that the mapping is implemented but that only
 * ONE branch can reach a provider, and that every other decision is inert.
 *
 * The suite is written around that: for each decision it asserts the provider
 * call count, not merely the returned label.
 *
 * SECRETS: all synthetic. No credential, no network, no real provider call.
 */

import {
  consumeEnrichmentWork,
  type EnrichmentWorkItem,
} from '../../services/enrichment/consumeEnrichmentWork';
import {
  EnrichmentWorkClaimedError, AttemptRecordRequiredError,
} from '../../services/enrichment/recordedExecution';
import type { EnrichmentAttemptRow } from '../../services/enrichment/attempts';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-07T12:00:00.000Z';
const PAST = '2026-09-07T11:00:00.000Z';
const FUTURE = '2026-09-07T13:00:00.000Z';
const CUTOFF = '2026-09-07T11:30:00.000Z';
const LONG_AGO = '2026-09-01T00:00:00.000Z';

const workItem: EnrichmentWorkItem = {
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  providerId: 'clearbit',
  requestedAttributes: ['employee_count', 'founded_year'],
  selectors: { domain: 'example.com' },
};

const attempt = (over: Partial<EnrichmentAttemptRow> = {}): EnrichmentAttemptRow => ({
  id: 'attempt-1', organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  providerKey: 'clearbit', attemptNumber: 1, correlationId: 'corr',
  outcome: 'enriched', providerCalled: true, providerCallState: 'called',
  executionStatus: 'completed', sourceRecordId: 'src-1',
  startedAt: PAST, completedAt: PAST,
  claimedBy: null, claimedUntil: null, nextRetryAt: null,
  requestedAttributes: ['employee_count', 'founded_year'],
  ...over,
});

/** Ports are required and never defaulted — supplying a stub proves the gate. */
const ports = {} as ExecuteEnrichmentPorts;

/** Records every primitive interaction so behaviour is assertable, not assumed. */
function harness(opts: {
  attempt?: EnrichmentAttemptRow | null;
  executeThrows?: unknown;
} = {}) {
  // A7I: there is no `reclaim` dependency any more. Recovery is not a step this
  // module performs, so there is nothing here to record — the adoption happens
  // inside the claim, and is proven against the live index in A4N/A4U.
  const calls = { list: [] as unknown[], execute: [] as unknown[] };
  return {
    calls,
    deps: {
      list: (async (i: unknown) => {
        calls.list.push(i);
        return opts.attempt === undefined ? [] : opts.attempt === null ? [] : [opts.attempt];
      }) as never,
      execute: (async (req: unknown, provider: unknown, p: unknown, o: unknown) => {
        calls.execute.push({ req, provider, p, o });
        if (opts.executeThrows !== undefined) throw opts.executeThrows;
        return { result: { outcome: 'enriched' }, attemptId: 'attempt-2', attemptNumber: 2 };
      }) as never,
    },
  };
}

const run = (h: ReturnType<typeof harness>, over: Record<string, unknown> = {}) =>
  consumeEnrichmentWork({
    workItem, now: NOW,
    freshEvidenceCoversRequest: false,
    credentialAvailable: true, sourceOperational: true,
    ports, lease: { claimedBy: 'worker-1', ttlMs: 60_000 },
    deps: h.deps, ...over,
  } as never);

// ── the inert decisions ─────────────────────────────────────────────────────

describe('A7E — every decision but one is inert', () => {
  it('NO_ACTION (fresh evidence): zero provider calls, no attempt created', async () => {
    const h = harness({ attempt: null });
    const out = await run(h, { freshEvidenceCoversRequest: true });

    expect(out).toMatchObject({ decision: 'NO_ACTION', executed: false });
    expect(h.calls.execute).toHaveLength(0);
  });

  it('WAIT (live lease): zero provider calls, nothing claimed', async () => {
    const h = harness({ attempt: attempt({
      completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'not_called', claimedBy: 'other', claimedUntil: FUTURE }) });
    const out = await run(h);

    expect(out).toMatchObject({ decision: 'WAIT', executed: false });
    expect(h.calls.execute).toHaveLength(0);
  });

  it('TERMINAL: zero provider calls, the outcome is left intact', async () => {
    const h = harness({ attempt: attempt({ outcome: 'no_match' }) });
    const out = await run(h);

    expect(out).toMatchObject({ decision: 'TERMINAL', executed: false });
    expect(h.calls.execute).toHaveLength(0);
  });

  it('OPERATOR_REVIEW (unknown, no ownership): zero provider calls, NO auto-reclaim', async () => {
    const h = harness({ attempt: attempt({
      completedAt: null, executionStatus: 'in_flight',
      providerCallState: 'unknown', claimedUntil: null }) });
    const out = await run(h);

    expect(out).toMatchObject({ decision: 'OPERATOR_REVIEW', executed: false });
    expect(h.calls.execute).toHaveLength(0);
  });

  it('OPERATOR_REVIEW (platform_failed + called): zero provider calls', async () => {
    const h = harness({ attempt: attempt({
      executionStatus: 'platform_failed', providerCallState: 'called', outcome: null }) });
    const out = await run(h);

    expect(out.decision).toBe('OPERATOR_REVIEW');
    expect(h.calls.execute).toHaveLength(0);
  });

  it.each([
    ['credential', { credentialAvailable: false }],
    ['source', { sourceOperational: false }],
  ])('%s unavailable: zero provider calls', async (_l, over) => {
    const h = harness({ attempt: null });
    const out = await run(h, over);
    expect(out).toMatchObject({ decision: 'NO_ACTION', executed: false });
    expect(h.calls.execute).toHaveLength(0);
  });
});

// ── recovery, A7I ───────────────────────────────────────────────────────────

describe('A7E — abandoned work is recovered BY the claim, not before it', () => {
  const expiredLease = attempt({
    completedAt: null, executionStatus: 'in_flight',
    providerCallState: 'not_called', claimedBy: 'dead', claimedUntil: PAST });

  const unleasedStale = attempt({
    completedAt: null, executionStatus: 'in_flight', providerCallState: 'not_called',
    claimedBy: null, claimedUntil: null, startedAt: LONG_AGO });

  it('an EXPIRED LEASE routes through execution, which the claim adopts', async () => {
    const h = harness({ attempt: expiredLease });
    const out = await run(h);

    // Was RECLAIM + executed:false. The recovery write is gone; the claim's
    // 23505 fallback does it, and the same call goes on to the provider.
    expect(out).toMatchObject({ decision: 'RETRY_PROVIDER', executed: true });
    expect(h.calls.execute).toHaveLength(1);
  });

  it('an UNLEASED STALE attempt routes through execution with the cutoff', async () => {
    const h = harness({ attempt: unleasedStale });
    const out = await run(h, { abandonedBefore: CUTOFF });

    expect(out).toMatchObject({ decision: 'RETRY_PROVIDER', executed: true });
    expect(h.calls.execute).toHaveLength(1);
  });

  it('abandonedBefore is FORWARDED into the recorded execution, unchanged', async () => {
    const h = harness({ attempt: unleasedStale });
    await run(h, { abandonedBefore: CUTOFF });

    // The cutoff A7D judged with is the cutoff the claim recovers with. If these
    // diverged, the consumer could decide to retry work the claim then refuses.
    expect((h.calls.execute[0] as { o: Record<string, unknown> }).o).toMatchObject({
      abandonedBefore: CUTOFF,
      requireAttemptRecord: true,
      lease: { claimedBy: 'worker-1', ttlMs: 60_000 },
    });
  });

  it('omitting the cutoff forwards undefined — A4N behaviour, never an invented one', async () => {
    // Without a cutoff an unleased row is not judged abandoned at all, so use
    // the expired-lease shape, which needs no cutoff to be recoverable.
    const h = harness({ attempt: expiredLease });
    await run(h);

    const o = (h.calls.execute[0] as { o: Record<string, unknown> }).o;
    expect(o.abandonedBefore).toBeUndefined();
  });

  it('the work-item identity reaching execution is A4Y-verbatim', async () => {
    const h = harness({ attempt: unleasedStale });
    await run(h, { abandonedBefore: CUTOFF });

    expect((h.calls.execute[0] as { req: Record<string, unknown> }).req).toMatchObject({
      organizationId: ORG, subject: 'account', entityId: ACCOUNT,
      attributes: ['employee_count', 'founded_year'],
    });
    expect((h.calls.execute[0] as { provider: string }).provider).toBe('clearbit');
  });

  it('THE LIVELOCK IS GONE: recovery cannot return without executing', async () => {
    // The old shape was RECLAIM → executed:false → (next cycle) WAIT on our own
    // fresh lease → expiry → RECLAIM again, forever, with the work item wedged
    // behind A4N's live index. Neither recoverable shape can produce that now:
    // both execute, and execution drives the attempt to a terminal state.
    for (const row of [expiredLease, unleasedStale]) {
      const h = harness({ attempt: row });
      const out = await run(h, { abandonedBefore: CUTOFF });
      expect(out.decision).toBe('RETRY_PROVIDER');
      expect(out.executed).toBe(true);
      expect(h.calls.execute).toHaveLength(1);
    }
  });

  it('the module owns no recovery write at all', () => {
    // Structural, not behavioural: the reclaim primitive is not reachable from
    // this module, so no future edit can reintroduce a second recovery path
    // without this failing. Comments stripped — the header discusses it.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/consumeEnrichmentWork.ts'),
      'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/reclaimExpiredAttempt|claimEnrichmentWork|ownedDbTable/);
  });
});

// ── the single provider path ────────────────────────────────────────────────

describe('A7E — RETRY_PROVIDER is the only path to a provider', () => {
  const retryable = attempt({
    executionStatus: 'mark_failed', providerCallState: 'not_called', outcome: null });

  it('executes through the recorded seam with a lease and a required record', async () => {
    const h = harness({ attempt: retryable });
    const out = await run(h);

    expect(out).toMatchObject({ decision: 'RETRY_PROVIDER', executed: true });
    expect(h.calls.execute).toHaveLength(1);

    const { o, provider, p } = h.calls.execute[0] as Record<string, never>;
    expect(o).toMatchObject({ requireAttemptRecord: true });
    expect((o as unknown as { lease: unknown }).lease).toMatchObject({ claimedBy: 'worker-1' });
    expect(provider).toBe('clearbit');
    expect(p).toBe(ports);                     // the caller's composition, not one built here
  });

  it('the executed attribute set is EXACTLY the set that was judged', async () => {
    // A4Y identity: retrying a different set under the same identity would
    // corrupt the work item.
    const h = harness({ attempt: retryable });
    await run(h);

    const { req } = h.calls.execute[0] as Record<string, never>;
    expect((req as unknown as { attributes: string[] }).attributes)
      .toEqual(['employee_count', 'founded_year']);
    expect((req as unknown as { selectors: unknown }).selectors)
      .toEqual({ domain: 'example.com' });
    expect((req as unknown as { organizationId: string }).organizationId).toBe(ORG);
  });

  it('a LOST CLAIM produces zero provider calls and is not an error', async () => {
    const h = harness({ attempt: retryable, executeThrows: new EnrichmentWorkClaimedError('held') });
    const out = await run(h);

    expect(out).toMatchObject({ decision: 'RETRY_PROVIDER', executed: false, refusal: 'claim_lost' });
  });

  it('an UNRECORDED attempt fails closed, not into a call', async () => {
    const h = harness({ attempt: retryable, executeThrows: new AttemptRecordRequiredError() });
    const out = await run(h);

    expect(out).toMatchObject({ executed: false, refusal: 'attempt_not_recorded' });
  });

  it('a genuine execution failure is surfaced, never swallowed', async () => {
    // A4E has already closed the attempt truthfully; hiding this would hide a
    // possibly-paid call.
    const boom = new Error('persist exploded');
    const h = harness({ attempt: retryable, executeThrows: boom });
    await expect(run(h)).rejects.toBe(boom);
  });

  it('a transient outcome past its horizon retries; before it, waits', async () => {
    const past = harness({ attempt: attempt({ outcome: 'rate_limited', nextRetryAt: PAST }) });
    expect((await run(past)).decision).toBe('RETRY_PROVIDER');
    expect(past.calls.execute).toHaveLength(1);

    const future = harness({ attempt: attempt({ outcome: 'rate_limited', nextRetryAt: FUTURE }) });
    expect((await run(future)).decision).toBe('WAIT');
    expect(future.calls.execute).toHaveLength(0);
  });

  it('a transient outcome with NO horizon does not retry — no invented backoff', async () => {
    const h = harness({ attempt: attempt({ outcome: 'rate_limited', nextRetryAt: null }) });
    const out = await run(h);
    expect(out.decision).toBe('OPERATOR_REVIEW');
    expect(h.calls.execute).toHaveLength(0);
  });
});

// ── concurrency ─────────────────────────────────────────────────────────────

describe('A7E — concurrency is arbitrated by the existing claim, not by this seam', () => {
  it('two schedulers on the same retryable item: exactly one executes', async () => {
    // The database admits one INSERT; the loser gets EnrichmentWorkClaimedError.
    const retryable = attempt({ executionStatus: 'mark_failed',
      providerCallState: 'not_called', outcome: null });
    let claimed = false;
    const build = () => harness({ attempt: retryable });
    const a = build(); const b = build();
    a.deps.execute = (async () => {
      if (claimed) throw new EnrichmentWorkClaimedError('held');
      claimed = true; return { result: {}, attemptId: 'x', attemptNumber: 1 };
    }) as never;
    b.deps.execute = a.deps.execute;

    const out = await Promise.all([run(a), run(b)]);
    expect(out.filter((o) => o.executed)).toHaveLength(1);
    expect(out.filter((o) => o.refusal === 'claim_lost')).toHaveLength(1);
  });

  it('this seam performs no check-then-act of its own', async () => {
    // It never inspects a lease and then decides to proceed; it hands the work
    // to the claim and lets the database arbitrate.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/consumeEnrichmentWork.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/claimedUntil\s*[<>]/);
    expect(src).not.toMatch(/providerCallState\s*===/);
    expect(src).not.toMatch(/executionStatus\s*===/);
  });
});

// ── the architectural boundaries ────────────────────────────────────────────

describe('A7E — no second state machine, no provider bypass, no suppression copy', () => {
  const src = (): string => require('fs').readFileSync(
    require('path').join(__dirname, '../..', 'services/enrichment/consumeEnrichmentWork.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('reproduces none of the A7D decision matrix', () => {
    // It switches on the decision; it never re-derives one.
    const code = src();
    expect(code).toMatch(/decideEnrichmentAction/);
    expect(code).not.toMatch(/TRANSIENT_OUTCOMES|TERMINAL_OUTCOMES/);
    expect(code).not.toMatch(/'mark_failed'|'platform_failed'|'refused_pre_call'/);
  });

  it('imports no adapter and no observation lookup', () => {
    const code = src();
    expect(code).not.toMatch(/adapters\/|clearbit|findRecentObservation|makeFindRecentObservation/);
    // Suppression is not reimplemented here; it arrives with the ports.
    expect(code).not.toMatch(/source_assertions|pickRecentObservation/);
  });

  it('builds no port composition — ports are required from the caller', () => {
    const code = src();
    expect(code).not.toMatch(/makeProductionEnrichmentPorts|makeTenantCredentialPort|makePersistObservation/);
    expect(code).toMatch(/ports: ExecuteEnrichmentPorts/);
  });

  it('starts nothing: no timer, queue, worker or cron', () => {
    const code = src();
    expect(code).not.toMatch(/setInterval|setTimeout|node-cron|new Queue|new Worker|\.schedule\(/);
  });

  it('is called by nothing in production — it is a seam, not a trigger', () => {
    const { execSync } = require('child_process');
    // The module's own file is excluded so this holds whether or not it is
    // committed yet; what matters is that nothing ELSE reaches it.
    const callers = execSync('git grep -l "consumeEnrichmentWork" -- "backend" "pages" || true',
      { encoding: 'utf8' }).split('\n').filter(Boolean)
      .filter((f: string) => !f.includes('/tests/'))
      .filter((f: string) => !f.endsWith('consumeEnrichmentWork.ts'));
    expect(callers).toEqual([]);
  });
});
