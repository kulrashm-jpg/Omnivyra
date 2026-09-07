/**
 * A7I — abandoned enrichment work is adopted BY the claim.
 *
 * ─── THE DEFECT THIS CLOSES ────────────────────────────────────────────────
 * `claimEnrichmentWork` has always recovered abandoned work: its INSERT
 * collides with A4N's live partial unique index and, on 23505, it reclaims and
 * ADOPTS the existing row instead of opening a second one. But
 * `reclaimExpiredAttempt`'s predicate reaches an UNLEASED row only when a cutoff
 * is supplied, and `executeEnrichmentRecorded` never supplied one — it did not
 * accept one. So the A4U wedge (an abandoned manual attempt, which by design has
 * a NULL lease) was recoverable by the claim and unreachable through the
 * execution seam.
 *
 * A consumer therefore had to write its own reclaim, which A7E did — and that
 * second recovery path produced a livelock: reclaim took a fresh lease and
 * returned without executing, the next cycle saw that live lease and waited, the
 * lease expired, and the same branch reclaimed again. The attempt never
 * completed and the live index went on blocking the work item permanently.
 *
 * The fix is one forwarded field. This suite proves the field travels, that both
 * abandoned shapes are adopted rather than duplicated, and that concurrency is
 * still arbitrated by the database.
 *
 * ─── WHY THE STORE IS MODELLED, NOT MOCKED ────────────────────────────────
 * Adoption is a property of the INDEX, not of our code: the whole mechanism is
 * "INSERT fails, therefore recover". A mock that simply returns a row would
 * prove nothing. The store below enforces BOTH deployed unique indexes and
 * reproduces PostgreSQL's NULL comparison semantics, exactly as the A4N and A4U
 * suites do; the same properties are asserted against real PostgreSQL in
 * `backend/tests/realschema/a4n_attempt_lease.test.ts` and
 * `a4u_abandoned_recovery.test.ts`.
 *
 * SECRETS: all synthetic. No credential, no network, no real provider call.
 */

import { claimEnrichmentWork } from '../../services/enrichment/attempts';
import {
  executeEnrichmentRecorded,
  EnrichmentWorkClaimedError,
} from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const PROVIDER = 'clearbit';

const STARTED_OLD = '2026-09-07T10:00:00.000Z';   // before the cutoff
const STARTED_RECENT = '2026-09-07T11:59:00.000Z'; // after it — possibly alive
const NOW = '2026-09-07T12:00:00.000Z';
const CUTOFF = '2026-09-07T11:30:00.000Z';
const LEASE_EXPIRED = '2026-09-07T11:00:00.000Z';
const LEASE_ACTIVE = '2026-09-07T12:05:00.000Z';
const SECRET = 'synthetic-tenant-provider-key';

const request = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a7i', correlationId: 'corr-a7i', ...over,
});

interface Row {
  id: string; org: string; entity: string; provider: string; n: number;
  claimedBy: string | null; claimedUntil: string | null; completedAt: string | null;
  startedAt: string;
}

const ms = (s: string) => Date.parse(s);

/**
 * Enforces BOTH deployed constraints and the real reclaim predicate:
 *   - `(org, entity, provider, attempt_number)`            — A4A numbering
 *   - `(org, entity, provider) WHERE completed_at IS NULL` — A4N live slot
 * rejecting with SQLSTATE 23505 exactly as PostgreSQL does.
 */
function store(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((r, i) => ({
    id: `seeded-${i + 1}`, org: ORG, entity: ACCOUNT, provider: PROVIDER, n: i + 1,
    claimedBy: null, claimedUntil: null, completedAt: null, startedAt: STARTED_OLD, ...r,
  }));
  const dup = () => Object.assign(
    new Error('duplicate key value violates unique constraint'), { code: '23505' });

  const record = async (i: {
    organizationId: string; entityId: string; providerId: string; attemptNumber: number;
    startedAt: string; claimedBy?: string; claimedUntil?: string;
  }) => {
    const same = (r: Row) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId;
    if (rows.some((r) => same(r) && r.n === i.attemptNumber)) throw dup();
    if (rows.some((r) => same(r) && r.completedAt === null)) throw dup();   // the live index
    const row: Row = {
      id: `opened-${rows.length + 1}`, org: i.organizationId, entity: i.entityId,
      provider: i.providerId, n: i.attemptNumber, startedAt: i.startedAt,
      claimedBy: i.claimedBy ?? null, claimedUntil: i.claimedUntil ?? null, completedAt: null,
    };
    rows.push(row);
    return { attemptId: row.id };
  };

  /**
   * The conditional UPDATE, with PostgreSQL's NULL semantics: a comparison
   * against NULL yields NULL, which a WHERE clause treats as NOT MATCHED. An
   * unleased row is therefore reachable ONLY through the cutoff alternative.
   */
  const reclaim = async (i: {
    organizationId: string; entityId: string; providerId: string;
    claimedBy: string; claimedUntil: string; now: string; abandonedBefore?: string;
  }) => {
    const hit = rows.find((r) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId && r.completedAt === null
      && (
        (r.claimedUntil !== null && ms(r.claimedUntil) < ms(i.now))
        || (i.abandonedBefore !== undefined && r.claimedUntil === null
            && ms(r.startedAt) < ms(i.abandonedBefore))
      ));
    if (!hit) return null;
    hit.claimedBy = i.claimedBy;          // ownership ONLY
    hit.claimedUntil = i.claimedUntil;
    return { attemptId: hit.id, attemptNumber: hit.n };
  };

  const nextNumber = async (i: { organizationId: string; entityId: string; providerId: string }) => {
    const mine = rows.filter((r) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId);
    return mine.length ? Math.max(...mine.map((r) => r.n)) + 1 : 1;
  };

  const complete = async (i: { attemptId: string }) => {
    const hit = rows.find((r) => r.id === i.attemptId);
    if (hit) hit.completedAt = NOW;        // leaves the live index
  };

  return { rows, record, reclaim, nextNumber, complete };
}

function adapter(calls: unknown[]): EnrichmentProviderAdapter {
  return {
    id: PROVIDER, label: 'Clearbit', supports: ['employee_count'],
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
  resolveCredential: async () => SECRET,
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => NOW,
  ...over,
});

/** Records what the claim was actually asked for, then runs the real claim. */
function recorder(s: ReturnType<typeof store>, seen: Record<string, unknown>[] = []) {
  return {
    seen,
    rec: {
      now: () => NOW,
      nextNumber: s.nextNumber,
      record: s.record,
      complete: s.complete,
      markPending: async () => { /* proven in piA4qProviderCallState */ },
      claim: (i: Record<string, unknown>) => {
        seen.push(i);
        return claimEnrichmentWork({
          ...i, ports: { record: s.record as never, reclaim: s.reclaim as never },
        } as never);
      },
    },
  };
}

const LEASE = { claimedBy: 'worker-1', ttlMs: 60_000 };

const run = (
  s: ReturnType<typeof store>,
  calls: unknown[],
  options: Record<string, unknown> = {},
  seen: Record<string, unknown>[] = [],
) => executeEnrichmentRecorded(request(), PROVIDER, ports(), {
  adapter: adapter(calls),
  recorder: recorder(s, seen).rec as never,
  lease: LEASE,
  requireAttemptRecord: true,
  ...options,
} as never);

// ── the forwarding itself ───────────────────────────────────────────────────

describe('A7I — abandonedBefore reaches the claim', () => {
  it('is forwarded verbatim from the recorded execution', async () => {
    const s = store();
    const seen: Record<string, unknown>[] = [];
    await run(s, [], { abandonedBefore: CUTOFF }, seen);

    expect(seen).toHaveLength(1);
    expect(seen[0].abandonedBefore).toBe(CUTOFF);
  });

  it('is undefined when the caller supplies none — no duration is invented', async () => {
    const s = store();
    const seen: Record<string, unknown>[] = [];
    await run(s, [], {}, seen);

    expect(seen[0].abandonedBefore).toBeUndefined();
  });

  it('the work item identity travels with it, unchanged', async () => {
    const s = store();
    const seen: Record<string, unknown>[] = [];
    await run(s, [], { abandonedBefore: CUTOFF }, seen);

    expect(seen[0]).toMatchObject({
      organizationId: ORG, entityId: ACCOUNT, providerId: PROVIDER,
      requestedAttributes: ['employee_count'],
      claimedBy: 'worker-1',
    });
  });
});

// ── adoption, both shapes ───────────────────────────────────────────────────

describe('A7I — an abandoned attempt is ADOPTED, never duplicated', () => {
  it('EXPIRED LEASE: the existing row is taken and the provider is called once', async () => {
    const s = store([{ claimedBy: 'dead-worker', claimedUntil: LEASE_EXPIRED }]);
    const calls: unknown[] = [];

    const out = await run(s, calls, { abandonedBefore: CUTOFF });

    expect(out.attemptId).toBe('seeded-1');          // the SAME row, adopted
    expect(out.attemptNumber).toBe(1);               // and its number, not a new one
    expect(s.rows).toHaveLength(1);                  // no second attempt was opened
    expect(s.rows[0].claimedBy).toBe('worker-1');    // ownership transferred
    expect(calls).toHaveLength(1);                   // exactly one paid call
    expect(out.result.outcome).toBe('enriched');
  });

  it('UNLEASED STALE: the A4U wedge is now reachable through execution', async () => {
    const s = store([{ claimedBy: null, claimedUntil: null, startedAt: STARTED_OLD }]);
    const calls: unknown[] = [];

    const out = await run(s, calls, { abandonedBefore: CUTOFF });

    expect(out.attemptId).toBe('seeded-1');
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBe('worker-1');
    expect(calls).toHaveLength(1);
  });

  it('REPRODUCES the gap: without the cutoff the unleased wedge is unreachable', async () => {
    // This is what the seam did before A7I, and why A7E needed its own reclaim.
    const s = store([{ claimedBy: null, claimedUntil: null, startedAt: STARTED_OLD }]);
    const calls: unknown[] = [];

    await expect(run(s, calls)).rejects.toBeInstanceOf(EnrichmentWorkClaimedError);
    expect(calls).toHaveLength(0);                   // and it fails CLOSED
    expect(s.rows).toHaveLength(1);
  });

  it('a RECENT unleased attempt is never stolen merely for lacking a lease', async () => {
    // An unleased execution may be perfectly alive — that is how the manual path
    // runs. Taking it would let two workers call one provider.
    const s = store([{ claimedBy: null, claimedUntil: null, startedAt: STARTED_RECENT }]);
    const calls: unknown[] = [];

    await expect(run(s, calls, { abandonedBefore: CUTOFF }))
      .rejects.toBeInstanceOf(EnrichmentWorkClaimedError);
    expect(calls).toHaveLength(0);
    expect(s.rows[0].claimedBy).toBeNull();          // untouched
  });

  it('an ACTIVE lease is never stolen, cutoff or not', async () => {
    const s = store([{ claimedBy: 'live-worker', claimedUntil: LEASE_ACTIVE }]);
    const calls: unknown[] = [];

    await expect(run(s, calls, { abandonedBefore: CUTOFF }))
      .rejects.toBeInstanceOf(EnrichmentWorkClaimedError);
    expect(calls).toHaveLength(0);
    expect(s.rows[0].claimedBy).toBe('live-worker');
  });

  it('adoption drives the attempt to a TERMINAL state — this is why the loop ends', async () => {
    // The livelock was not that recovery was wrong, it was that recovery
    // returned without progressing. Here the adopted row is completed, which
    // frees the live slot; the next cycle reads a finished attempt, not an
    // abandoned one, so it can never re-enter recovery for this work.
    const s = store([{ claimedBy: 'dead-worker', claimedUntil: LEASE_EXPIRED }]);
    await run(s, [], { abandonedBefore: CUTOFF });

    expect(s.rows[0].completedAt).not.toBeNull();
    expect(s.rows.filter((r) => r.completedAt === null)).toHaveLength(0);
  });
});

// ── concurrency ─────────────────────────────────────────────────────────────

describe('A7I — the database still arbitrates, not this change', () => {
  it('two workers on ONE abandoned attempt: one adopts, ONE provider call', async () => {
    const s = store([{ claimedBy: 'dead-worker', claimedUntil: LEASE_EXPIRED }]);
    const calls: unknown[] = [];

    const settled = await Promise.allSettled([
      run(s, calls, { abandonedBefore: CUTOFF }),
      run(s, calls, { abandonedBefore: CUTOFF }),
    ]);

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(calls).toHaveLength(1);                   // exactly one paid call
    expect(s.rows).toHaveLength(1);                  // and no duplicate attempt
  });

  it('two workers on FREE work: one claim, one call, one row', async () => {
    const s = store();
    const calls: unknown[] = [];

    const settled = await Promise.allSettled([
      run(s, calls, { abandonedBefore: CUTOFF }),
      run(s, calls, { abandonedBefore: CUTOFF }),
    ]);

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(s.rows).toHaveLength(1);
  });

  it('the loser reaches no provider, credential or cost', async () => {
    const s = store([{ claimedBy: 'dead-worker', claimedUntil: LEASE_EXPIRED }]);
    const calls: unknown[] = [];
    const touched = { credential: 0, cost: 0 };
    const spy = ports({
      resolveCredential: async () => { touched.credential += 1; return SECRET; },
      authorizeCost: async () => {
        touched.cost += 1;
        return { authorized: true, holdId: null, cost: { kind: 'unknown' } };
      },
    });

    const go = () => executeEnrichmentRecorded(request(), PROVIDER, spy, {
      adapter: adapter(calls),
      recorder: recorder(s).rec as never,
      lease: LEASE,
      requireAttemptRecord: true,
      abandonedBefore: CUTOFF,
    } as never);

    await Promise.allSettled([go(), go()]);

    // One winner only: the loser stops at the claim, before any of these.
    expect(touched.credential).toBe(1);
    expect(touched.cost).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

// ── the boundary this change must not cross ─────────────────────────────────

describe('A7I — the executor carries policy, it does not own it', () => {
  it('the unleased path is untouched: no lease, no cutoff, no claim', async () => {
    const s = store();
    const seen: Record<string, unknown>[] = [];
    const calls: unknown[] = [];

    await executeEnrichmentRecorded(request(), PROVIDER, ports(), {
      adapter: adapter(calls),
      recorder: recorder(s, seen).rec as never,
      // No `lease`, and therefore no claim — A4A's manual path, unchanged.
      abandonedBefore: CUTOFF,
    } as never);

    expect(seen).toHaveLength(0);                    // the claim was never entered
    expect(s.rows[0].claimedBy).toBeNull();          // and no lease was written
    expect(calls).toHaveLength(1);
  });

  it('no abandonment duration is defined in the executor', () => {
    // The cutoff must remain the caller's policy. A default here would silently
    // become THE platform's abandonment window.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../..', 'services/enrichment/recordedExecution.ts'),
      'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/abandonedBefore\s*[:=]\s*(new Date|Date\.|['"`]|\d)/);
    expect(src).not.toMatch(/abandonedBefore\s*\?\?/);
  });
});
