/**
 * A4N — the enrichment attempt lease.
 *
 * A4J stopped UNRECORDED provider calls. It did not stop two RECORDED ones:
 * `nextAttemptNumber` is read-then-increment, so if worker A commits attempt
 * N+1 before worker B reads, B computes N+2, both INSERTs succeed, and the
 * tenant is charged twice for one piece of work. Distinct attempt numbers are
 * two independent executions, not safe concurrency.
 *
 * The arbiter is therefore not this code but the database: migration
 * 20261016000000 adds a partial unique index over LIVE (open) attempts, so of
 * two racing workers exactly one INSERT survives and the other is rejected with
 * 23505. History is untouched — every completed attempt leaves the live index
 * immediately, so append-only retries still accumulate.
 *
 * The fake store below enforces that index faithfully. The same property is
 * asserted against real PostgreSQL in `backend/tests/realschema/`.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  claimEnrichmentWork, type AttemptClaim,
} from '../../services/enrichment/attempts';
import {
  executeEnrichmentRecorded,
  EnrichmentWorkClaimedError,
  AttemptRecordRequiredError,
} from '../../services/enrichment/recordedExecution';
import type { ExecuteEnrichmentPorts } from '../../services/enrichment/providers/execute';
import type {
  EnrichmentProviderAdapter, EnrichmentRequest,
} from '../../services/enrichment/providers/contract';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_2 = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-09-06T12:00:00.000Z';
const LATER = '2026-09-06T13:00:00.000Z';   // past a 1-minute lease
const SECRET = 'synthetic-tenant-provider-key';

const request = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: ORG_A, subject: 'account', entityId: ACCOUNT,
  attributes: ['employee_count'], selectors: { domain: 'example.com' },
  purpose: 'a4n', correlationId: 'corr-a4n', ...over,
});

// ── a store that enforces the real indexes ──────────────────────────────────

interface Row {
  id: string; org: string; subject: string; entity: string; provider: string;
  n: number; claimedBy: string | null; claimedUntil: string | null; completedAt: string | null;
}

/**
 * Enforces BOTH deployed constraints:
 *   - `(org, entity, provider, attempt_number)`            — A4A numbering
 *   - `(org, entity, provider) WHERE completed_at IS NULL` — A4N live slot
 * and rejects with SQLSTATE 23505, exactly as PostgreSQL does.
 */
function store() {
  const rows: Row[] = [];
  const dup = () => Object.assign(
    new Error('duplicate key value violates unique constraint'), { code: '23505' });

  const record = async (i: {
    organizationId: string; subject: string; entityId: string; providerId: string;
    attemptNumber: number; claimedBy?: string; claimedUntil?: string;
  }) => {
    const same = (r: Row) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId;
    if (rows.some((r) => same(r) && r.n === i.attemptNumber)) throw dup();
    if (rows.some((r) => same(r) && r.completedAt === null)) throw dup();   // the live index
    const row: Row = {
      id: `attempt-${rows.length + 1}`, org: i.organizationId, subject: i.subject,
      entity: i.entityId, provider: i.providerId, n: i.attemptNumber,
      claimedBy: i.claimedBy ?? null, claimedUntil: i.claimedUntil ?? null, completedAt: null,
    };
    rows.push(row);
    return { attemptId: row.id };
  };

  /** The conditional UPDATE: expiry is re-checked in the predicate. */
  const reclaim = async (i: {
    organizationId: string; subject: string; entityId: string; providerId: string;
    claimedBy: string; claimedUntil: string; now: string;
  }) => {
    const hit = rows.find((r) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId && r.completedAt === null
      && r.claimedUntil !== null && Date.parse(r.claimedUntil) < Date.parse(i.now));
    if (!hit) return null;
    hit.claimedBy = i.claimedBy;
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
    if (hit) hit.completedAt = NOW;             // leaves the live index
  };

  return { rows, record, reclaim, nextNumber, complete };
}

const claimVia = (s: ReturnType<typeof store>, over: Record<string, unknown> = {}): Promise<AttemptClaim> =>
  claimEnrichmentWork({
    organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
    requestedAttributes: ['employee_count'], correlationId: 'corr-a4n',
    attemptNumber: 1, startedAt: NOW,
    claimedBy: 'worker-1', claimedUntil: '2026-09-06T12:01:00.000Z',
    ports: { record: s.record as never, reclaim: s.reclaim as never },
    ...over,
  } as never);

function adapter(calls: unknown[]): EnrichmentProviderAdapter {
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
  resolveCredential: async () => SECRET,
  findRecentObservation: async () => null,
  persistObservation: async () => ({ sourceRecordId: 'src-1', canonicalWithheld: [] }),
  now: () => NOW,
  ...over,
});

const recorder = (s: ReturnType<typeof store>) => ({
  now: () => NOW,
  nextNumber: s.nextNumber,
  record: s.record,
  complete: s.complete,
  // A4Q added the pre-transport call-state marker to the recorder port set.
  // Stubbed here like its siblings so this suite stays database-free.
  markPending: async () => { /* proven in piA4qProviderCallState */ },
  claim: (i: Record<string, unknown>) => claimEnrichmentWork({
    ...i, ports: { record: s.record as never, reclaim: s.reclaim as never },
  } as never),
});

const LEASE = { claimedBy: 'worker-1', ttlMs: 60_000 };

// ── claim mechanics ─────────────────────────────────────────────────────────

describe('A4N — the claim is arbitrated by the live index, not by a number', () => {
  it('1. a single worker claims', async () => {
    const s = store();
    const out = await claimVia(s);
    expect(out).toMatchObject({ claimed: true, attemptNumber: 1, reclaimed: false });
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBe('worker-1');
  });

  it('2. a second worker cannot claim the same live work — even with a DIFFERENT number', async () => {
    const s = store();
    await claimVia(s);
    // This is the case A4J could not stop: a distinct attempt_number.
    const second = await claimVia(s, { attemptNumber: 2, claimedBy: 'worker-2' });
    expect(second).toMatchObject({ claimed: false, reason: 'held_by_another_worker' });
    expect(s.rows).toHaveLength(1);
  });

  it('6. an ACTIVE claim cannot be stolen', async () => {
    const s = store();
    await claimVia(s);   // lease until 12:01
    const thief = await claimVia(s, {
      attemptNumber: 2, claimedBy: 'worker-2', startedAt: NOW,   // still 12:00
    });
    expect(thief).toMatchObject({ claimed: false });
    expect(s.rows[0].claimedBy).toBe('worker-1');
  });

  it('5. an EXPIRED lease permits legitimate recovery', async () => {
    const s = store();
    await claimVia(s);   // lease until 12:01
    const recovered = await claimVia(s, {
      attemptNumber: 2, claimedBy: 'worker-2',
      startedAt: LATER, claimedUntil: '2026-09-06T13:01:00.000Z',
    });
    expect(recovered).toMatchObject({ claimed: true, reclaimed: true });
    // Reclaim TAKES OVER the abandoned attempt; it does not fork a second one.
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].claimedBy).toBe('worker-2');
  });

  it('a completed attempt frees the slot, so the next attempt may claim', async () => {
    const s = store();
    const first = await claimVia(s);
    await s.complete({ attemptId: (first as { attemptId: string }).attemptId });
    const second = await claimVia(s, { attemptNumber: 2, claimedBy: 'worker-2' });
    expect(second).toMatchObject({ claimed: true, reclaimed: false });
    expect(s.rows).toHaveLength(2);          // history accumulates
  });

  it('7. tenant A cannot claim tenant B\'s work', async () => {
    const s = store();
    await claimVia(s);                                   // ORG_A holds it
    const other = await claimVia(s, { organizationId: ORG_B, claimedBy: 'worker-b' });
    // A different tenant is a DIFFERENT work item — it claims its own slot.
    expect(other).toMatchObject({ claimed: true });
    expect(s.rows.filter((r) => r.org === ORG_B)).toHaveLength(1);
    expect(s.rows.find((r) => r.org === ORG_A)!.claimedBy).toBe('worker-1');
  });

  it('8. different entities execute independently', async () => {
    const s = store();
    await claimVia(s);
    const other = await claimVia(s, { entityId: ACCOUNT_2, claimedBy: 'worker-2' });
    expect(other).toMatchObject({ claimed: true });
    expect(s.rows).toHaveLength(2);
  });

  it('9. different providers execute independently', async () => {
    const s = store();
    await claimVia(s);
    const other = await claimVia(s, { providerId: 'apollo', claimedBy: 'worker-2' });
    expect(other).toMatchObject({ claimed: true });
    expect(s.rows).toHaveLength(2);
  });

  it('a real insert failure is NOT swallowed as a lost race', async () => {
    const s = store();
    const broken = { ...s, record: async () => { throw new Error('database is on fire'); } };
    await expect(claimEnrichmentWork({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: 'clearbit',
      requestedAttributes: ['employee_count'], correlationId: 'c', attemptNumber: 1,
      startedAt: NOW, claimedBy: 'w', claimedUntil: LATER,
      ports: { record: broken.record as never, reclaim: s.reclaim as never },
    } as never)).rejects.toThrow('database is on fire');
  });

  it('a tenant-less or unidentified claim is refused', async () => {
    const s = store();
    await expect(claimVia(s, { organizationId: '  ' })).rejects.toThrow(/organizationId is required/);
    await expect(claimVia(s, { claimedBy: '' })).rejects.toThrow(/claimedBy is required/);
    await expect(claimVia(s, { claimedUntil: '' })).rejects.toThrow(/claimedUntil is required/);
  });
});

// ── the property that matters: exactly one provider call ────────────────────

describe('A4N — under concurrency exactly one worker reaches the provider', () => {
  it('3/4. two concurrent leased executions ⇒ one claim, ONE provider call', async () => {
    const s = store();
    const calls: unknown[] = [];
    const run = (who: string) => executeEnrichmentRecorded(request(), 'clearbit', ports(), {
      adapter: adapter(calls), recorder: recorder(s) as never,
      lease: { claimedBy: who, ttlMs: 60_000 },
    });

    const [a, b] = await Promise.allSettled([run('worker-1'), run('worker-2')]);
    const settled = [a, b];

    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // THE assertion. Before A4N this was two calls.
    expect(calls).toHaveLength(1);
    expect(s.rows).toHaveLength(1);

    const loser = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(EnrichmentWorkClaimedError);
  });

  it('4/13. the loser performs ZERO transport, and never resolves a credential or cost', async () => {
    const s = store();
    await claimVia(s);                                   // slot already held
    const calls: unknown[] = [];
    let credentialAsked = false;
    let costAsked = false;

    await expect(executeEnrichmentRecorded(request(), 'clearbit', ports({
      resolveCredential: async () => { credentialAsked = true; return SECRET; },
      authorizeCost: async () => { costAsked = true; return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
    }), {
      adapter: adapter(calls), recorder: recorder(s) as never,
      lease: { claimedBy: 'worker-2', ttlMs: 60_000 },
    })).rejects.toThrow(EnrichmentWorkClaimedError);

    expect(calls).toHaveLength(0);
    expect(credentialAsked).toBe(false);
    expect(costAsked).toBe(false);
  });

  it('a leased execution that wins proceeds normally', async () => {
    const s = store();
    const calls: unknown[] = [];
    const out = await executeEnrichmentRecorded(request(), 'clearbit', ports(), {
      adapter: adapter(calls), recorder: recorder(s) as never, lease: LEASE,
    });
    expect(out.result.outcome).toBe('enriched');
    expect(calls).toHaveLength(1);
    expect(out.attemptId).toBe('attempt-1');
  });

  it('10. a provider failure still closes the attempt, freeing the slot', async () => {
    const s = store();
    const failing: EnrichmentProviderAdapter = {
      ...adapter([]),
      enrich: async () => ({ outcome: 'no_match', fields: [], notReturned: ['employee_count'] }),
    };
    const out = await executeEnrichmentRecorded(request(), 'clearbit', ports(), {
      adapter: failing, recorder: recorder(s) as never, lease: LEASE,
    });
    expect(out.result.outcome).toBe('no_match');
    expect(s.rows[0].completedAt).toBe(NOW);           // slot released

    // and the next worker may now claim
    const next = await claimVia(s, { attemptNumber: 2, claimedBy: 'worker-2' });
    expect(next).toMatchObject({ claimed: true });
  });
});

// ── prior contracts are preserved ───────────────────────────────────────────

describe('A4N — A4E and A4J semantics are unchanged', () => {
  it('11. A4E: a post-provider persistence failure still closes with provider_called=true, error preserved', async () => {
    const s = store();
    const closed: Record<string, unknown>[] = [];
    const calls: unknown[] = [];
    const rec = { ...recorder(s), complete: async (i: unknown) => { closed.push(i as Record<string, unknown>); } };

    await expect(executeEnrichmentRecorded(request(), 'clearbit', ports({
      persistObservation: async () => { throw new Error('source_records insert failed'); },
    }), { adapter: adapter(calls), recorder: rec as never, lease: LEASE }))
      .rejects.toThrow('source_records insert failed');

    expect(calls).toHaveLength(1);
    expect(closed[0]).toMatchObject({ providerCalled: true, outcome: null, completedAt: NOW });
  });

  it('12. A4J: fail-closed recording is unchanged on the UNLEASED path', async () => {
    const calls: unknown[] = [];
    const rec = {
      now: () => NOW, nextNumber: async () => 1,
      record: async () => { throw new Error('insert failed'); },
      complete: async () => { /* unreachable */ },
    };
    await expect(executeEnrichmentRecorded(request(), 'clearbit', ports(), {
      adapter: adapter(calls), recorder: rec as never, requireAttemptRecord: true,
    })).rejects.toThrow(AttemptRecordRequiredError);
    expect(calls).toHaveLength(0);
  });

  it('14. A4A: the default unleased path still fails OPEN and does the work', async () => {
    const calls: unknown[] = [];
    const rec = {
      now: () => NOW, nextNumber: async () => 1,
      record: async () => { throw new Error('insert failed'); },
      complete: async () => { /* nothing opened */ },
    };
    const out = await executeEnrichmentRecorded(request(), 'clearbit', ports(), {
      adapter: adapter(calls), recorder: rec as never,
    });
    expect(out.result.outcome).toBe('enriched');
    expect(out.attemptId).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('the unleased path never claims — no lease columns are written', async () => {
    const s = store();
    const calls: unknown[] = [];
    await executeEnrichmentRecorded(request(), 'clearbit', ports(), {
      adapter: adapter(calls), recorder: recorder(s) as never,
    });
    expect(s.rows[0].claimedBy).toBeNull();
    expect(s.rows[0].claimedUntil).toBeNull();
  });

  it('no scheduler, queue, cron or retry metadata was introduced', () => {
    const code = (rel: string): string =>
      require('fs').readFileSync(require('path').join(__dirname, '../..', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const rel of ['services/enrichment/attempts.ts', 'services/enrichment/recordedExecution.ts']) {
      const src = code(rel);
      expect(src).not.toMatch(/setInterval|setTimeout|node-cron|new Queue|new Worker|\.schedule\(/);
      // `provider_call_state` was on this list at A4N time because it was
      // deferred. A4Q introduced it deliberately, so it is no longer forbidden;
      // the rest of the list remains correctly absent.
      expect(src).not.toMatch(/next_retry_at|retry_class|prior_attempt_id|retry_policy_version|execution_status/);
    }
  });
});
