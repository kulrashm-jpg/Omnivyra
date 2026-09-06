/**
 * A4U — an abandoned attempt is recoverable even when it was never leased.
 *
 * A4T Blocker 1. A4N made the live partial unique index the concurrency
 * arbiter: at most one OPEN attempt per (tenant, entity, provider). Recovery
 * from an abandoned attempt was `reclaimExpiredAttempt`, whose predicate is
 * `completed_at IS NULL AND claimed_until < now`.
 *
 * The manual path never sets `claimed_until` — it does not claim — so an
 * abandoned manual attempt has a NULL lease, and `NULL < now()` evaluates to
 * NULL, which a WHERE clause treats as false. The row could therefore never be
 * reclaimed, while the live index went on blocking every future attempt for
 * that work item. One dead manual execution, or merely one failed completion
 * write (A4E's `close()` is best-effort), wedged the work item permanently with
 * no code path able to recover it.
 *
 * ─── WHY A CUTOFF AND NOT AN UNCONDITIONAL NULL RECLAIM ───────────────────
 * `claimed_until IS NULL` does not mean "dead". It means "unleased", and an
 * unleased execution may be perfectly alive — the manual path is unleased by
 * design. Reclaiming every NULL-lease row on sight would steal work from a
 * running manual execution and let two workers call one provider.
 *
 * The schema affords exactly one discriminator between a live unleased
 * execution and a dead one: how long ago it started. So recovery of an unleased
 * row requires an EXPLICIT cutoff supplied by the caller, exactly as the lease
 * TTL already is. Omit it and behaviour is byte-identical to A4N.
 *
 * That cutoff is a heuristic, not a proof, and this file does not pretend
 * otherwise — see the report's residual note.
 *
 * SECRETS: all synthetic. No credential, no network, no provider call.
 */

import {
  reclaimExpiredAttempt, claimEnrichmentWork,
  type ProviderCallState,
} from '../../services/enrichment/attempts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = '33333333-3333-4333-8333-333333333333';
const PROVIDER = 'clearbit';

const T = (iso: string) => iso;
const STARTED_OLD = T('2026-09-06T10:00:00.000Z');
const STARTED_RECENT = T('2026-09-06T11:59:00.000Z');
const NOW = T('2026-09-06T12:00:00.000Z');
const CUTOFF = T('2026-09-06T11:30:00.000Z');          // 30 minutes of grace
const LEASE_ACTIVE = T('2026-09-06T12:05:00.000Z');
const LEASE_EXPIRED = T('2026-09-06T11:00:00.000Z');
const NEW_LEASE = T('2026-09-06T12:01:00.000Z');

interface Row {
  id: string; org: string; entity: string; provider: string; n: number;
  claimedBy: string | null; claimedUntil: string | null; completedAt: string | null;
  startedAt: string; callState: ProviderCallState; providerCalled: boolean;
  outcome: string | null; sourceRecordId: string | null;
  requestedAttributes: string[]; correlationId: string; attributesReturned: string[] | null;
}

const ms = (s: string) => Date.parse(s);

/**
 * Models the deployed table faithfully: both unique indexes, and the exact
 * reclaim predicate including PostgreSQL's NULL comparison semantics.
 */
function store(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((r, i) => ({
    id: `attempt-${i + 1}`, org: ORG_A, entity: ACCOUNT, provider: PROVIDER, n: i + 1,
    claimedBy: null, claimedUntil: null, completedAt: null, startedAt: STARTED_OLD,
    callState: 'not_called', providerCalled: false, outcome: null, sourceRecordId: null,
    requestedAttributes: ['employee_count'], correlationId: 'corr-original',
    attributesReturned: null, ...r,
  }));
  const dup = () => Object.assign(
    new Error('duplicate key value violates unique constraint'), { code: '23505' });

  const record = async (i: {
    organizationId: string; entityId: string; providerId: string; attemptNumber: number;
    claimedBy?: string; claimedUntil?: string; startedAt: string;
  }) => {
    const same = (r: Row) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId;
    if (rows.some((r) => same(r) && r.n === i.attemptNumber)) throw dup();
    if (rows.some((r) => same(r) && r.completedAt === null)) throw dup();   // live index
    const row: Row = {
      id: `attempt-${rows.length + 1}`, org: i.organizationId, entity: i.entityId,
      provider: i.providerId, n: i.attemptNumber, claimedBy: i.claimedBy ?? null,
      claimedUntil: i.claimedUntil ?? null, completedAt: null, startedAt: i.startedAt,
      callState: 'not_called', providerCalled: false, outcome: null, sourceRecordId: null,
      requestedAttributes: ['employee_count'], correlationId: 'corr-new', attributesReturned: null,
    };
    rows.push(row);
    return { attemptId: row.id };
  };

  /**
   * The conditional UPDATE, with PostgreSQL's real NULL semantics: a comparison
   * against NULL yields NULL, which a WHERE clause treats as NOT MATCHED.
   */
  const reclaim = async (i: {
    organizationId: string; entityId: string; providerId: string;
    claimedBy: string; claimedUntil: string; now: string; abandonedBefore?: string;
  }) => {
    const hit = rows.find((r) => r.org === i.organizationId && r.entity === i.entityId
      && r.provider === i.providerId && r.completedAt === null
      && (
        (r.claimedUntil !== null && ms(r.claimedUntil) < ms(i.now))          // leased + expired
        || (i.abandonedBefore !== undefined && r.claimedUntil === null
            && ms(r.startedAt) < ms(i.abandonedBefore))                      // unleased + stale
      ));
    if (!hit) return null;
    // Ownership ONLY. Nothing else may be touched.
    hit.claimedBy = i.claimedBy;
    hit.claimedUntil = i.claimedUntil;
    return { attemptId: hit.id, attemptNumber: hit.n };
  };

  return { rows, record, reclaim };
}

const recoverVia = (s: ReturnType<typeof store>, over: Record<string, unknown> = {}) =>
  reclaimExpiredAttempt({
    organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
    claimedBy: 'worker-2', claimedUntil: NEW_LEASE, now: NOW,
    ports: { reclaim: s.reclaim as never },
    ...over,
  } as never);

// ── the defect, and its fix ─────────────────────────────────────────────────

describe('A4U — an unleased abandoned attempt is recoverable', () => {
  it('REPRODUCES A4T Blocker 1: without a cutoff it is NOT reclaimable', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    // This is exactly A4N's behaviour, and it is preserved: `NULL < now` is not
    // true, so the row is not matched and the work item stays wedged.
    expect(await recoverVia(s)).toBeNull();
    expect(s.rows[0].claimedBy).toBeNull();
  });

  it('and the live index keeps blocking a new attempt for that work item', async () => {
    const s = store([{ claimedUntil: null, completedAt: null }]);
    await expect(s.record({
      organizationId: ORG_A, entityId: ACCOUNT, providerId: PROVIDER,
      attemptNumber: 2, startedAt: NOW,
    })).rejects.toMatchObject({ code: '23505' });
  });

  it('WITH an explicit cutoff, the abandoned unleased attempt IS recovered', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    const out = await recoverVia(s, { abandonedBefore: CUTOFF });
    expect(out).toMatchObject({ attemptId: 'attempt-1', attemptNumber: 1 });
    expect(s.rows[0].claimedBy).toBe('worker-2');
    expect(s.rows[0].claimedUntil).toBe(NEW_LEASE);
    expect(s.rows).toHaveLength(1);            // taken over, not forked
  });

  it('an ACTIVE unleased (manual) execution is NOT stolen merely for lacking a lease', async () => {
    // Started one minute ago; the cutoff is thirty minutes back.
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_RECENT }]);
    expect(await recoverVia(s, { abandonedBefore: CUTOFF })).toBeNull();
    expect(s.rows[0].claimedBy).toBeNull();
  });

  it('a completed attempt is never recovered — it holds no live slot', async () => {
    const s = store([{ claimedUntil: null, completedAt: NOW, startedAt: STARTED_OLD }]);
    expect(await recoverVia(s, { abandonedBefore: CUTOFF })).toBeNull();
  });
});

// ── A4N behaviour is unchanged ──────────────────────────────────────────────

describe('A4U — A4N lease semantics are preserved exactly', () => {
  it('an ACTIVE lease cannot be reclaimed, cutoff or not', async () => {
    const s = store([{ claimedUntil: LEASE_ACTIVE, startedAt: STARTED_OLD }]);
    expect(await recoverVia(s)).toBeNull();
    expect(await recoverVia(s, { abandonedBefore: CUTOFF })).toBeNull();
    expect(s.rows[0].claimedBy).toBeNull();
  });

  it('an EXPIRED lease is reclaimable, with or without a cutoff', async () => {
    const a = store([{ claimedUntil: LEASE_EXPIRED, startedAt: STARTED_OLD }]);
    expect(await recoverVia(a)).toMatchObject({ attemptId: 'attempt-1' });

    const b = store([{ claimedUntil: LEASE_EXPIRED, startedAt: STARTED_OLD }]);
    expect(await recoverVia(b, { abandonedBefore: CUTOFF })).toMatchObject({ attemptId: 'attempt-1' });
  });

  it('a fresh claim on a free work item still works', async () => {
    const s = store();
    const out = await claimEnrichmentWork({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
      requestedAttributes: ['employee_count'], correlationId: 'c', attemptNumber: 1,
      startedAt: NOW, claimedBy: 'worker-1', claimedUntil: NEW_LEASE,
      ports: { record: s.record as never, reclaim: s.reclaim as never },
    } as never);
    expect(out).toMatchObject({ claimed: true, reclaimed: false });
  });

  it('claim falls through to recovery when the live slot is held by an abandoned unleased row', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    const out = await claimEnrichmentWork({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
      requestedAttributes: ['employee_count'], correlationId: 'c', attemptNumber: 2,
      startedAt: NOW, claimedBy: 'worker-2', claimedUntil: NEW_LEASE,
      abandonedBefore: CUTOFF,
      ports: { record: s.record as never, reclaim: s.reclaim as never },
    } as never);
    expect(out).toMatchObject({ claimed: true, reclaimed: true });
    expect(s.rows).toHaveLength(1);
  });

  it('without a cutoff, that same claim is REFUSED rather than silently proceeding', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    const out = await claimEnrichmentWork({
      organizationId: ORG_A, subject: 'account', entityId: ACCOUNT, providerId: PROVIDER,
      requestedAttributes: ['employee_count'], correlationId: 'c', attemptNumber: 2,
      startedAt: NOW, claimedBy: 'worker-2', claimedUntil: NEW_LEASE,
      ports: { record: s.record as never, reclaim: s.reclaim as never },
    } as never);
    expect(out).toMatchObject({ claimed: false, reason: 'held_by_another_worker' });
  });
});

// ── provider-call state and evidence are immutable under recovery ───────────

describe('A4U — recovery changes ownership and nothing else', () => {
  it.each(['not_called', 'called', 'unknown'] as ProviderCallState[])(
    'reclaim(%s) => %s', async (state) => {
      const s = store([{
        claimedUntil: null, completedAt: null, startedAt: STARTED_OLD,
        callState: state, providerCalled: state === 'called',
      }]);
      await recoverVia(s, { abandonedBefore: CUTOFF });
      expect(s.rows[0].callState).toBe(state);
    });

  it('unknown remains unknown — it is never downgraded to not_called', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD, callState: 'unknown' }]);
    await recoverVia(s, { abandonedBefore: CUTOFF });
    expect(s.rows[0].callState).toBe('unknown');
    expect(s.rows[0].callState).not.toBe('not_called');
  });

  it('provider_called, outcome, evidence, attributes and correlation are untouched', async () => {
    const s = store([{
      claimedUntil: null, completedAt: null, startedAt: STARTED_OLD,
      callState: 'called', providerCalled: true, outcome: 'no_match',
      sourceRecordId: 'src-1', requestedAttributes: ['employee_count', 'founded_year'],
      correlationId: 'corr-original', attributesReturned: ['employee_count'],
    }]);
    await recoverVia(s, { abandonedBefore: CUTOFF });
    const r = s.rows[0];
    expect(r.providerCalled).toBe(true);
    expect(r.outcome).toBe('no_match');
    expect(r.sourceRecordId).toBe('src-1');
    expect(r.requestedAttributes).toEqual(['employee_count', 'founded_year']);
    expect(r.correlationId).toBe('corr-original');
    expect(r.attributesReturned).toEqual(['employee_count']);
    // Only ownership moved.
    expect(r.claimedBy).toBe('worker-2');
  });
});

// ── concurrency ─────────────────────────────────────────────────────────────

describe('A4U — recovery is atomic', () => {
  it('two racing recoverers produce exactly ONE winner', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    const [a, b] = await Promise.all([
      recoverVia(s, { abandonedBefore: CUTOFF, claimedBy: 'worker-A' }),
      recoverVia(s, { abandonedBefore: CUTOFF, claimedBy: 'worker-B' }),
    ]);
    // The predicate re-checks liveness, so once the first recoverer has taken
    // the row the second no longer matches it.
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    expect(s.rows).toHaveLength(1);            // never forked into two live rows
  });

  it('recovery never creates a second live attempt', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    await recoverVia(s, { abandonedBefore: CUTOFF });
    const live = s.rows.filter((r) => r.completedAt === null);
    expect(live).toHaveLength(1);
  });
});

// ── tenant isolation ────────────────────────────────────────────────────────

describe('A4U — recovery is tenant-scoped', () => {
  it('tenant B cannot recover tenant A\'s abandoned attempt', async () => {
    const s = store([{ org: ORG_A, claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    const out = await recoverVia(s, { organizationId: ORG_B, abandonedBefore: CUTOFF });
    expect(out).toBeNull();
    expect(s.rows[0].claimedBy).toBeNull();
    expect(s.rows[0].org).toBe(ORG_A);
  });

  it('a tenant-less or entity-less recovery is refused', async () => {
    const s = store();
    await expect(recoverVia(s, { organizationId: '  ', abandonedBefore: CUTOFF }))
      .rejects.toThrow(/organizationId is required/);
    await expect(recoverVia(s, { entityId: ' ', abandonedBefore: CUTOFF }))
      .rejects.toThrow(/entityId is required/);
  });

  it('a different entity or provider is a different work item', async () => {
    const s = store([{ claimedUntil: null, completedAt: null, startedAt: STARTED_OLD }]);
    expect(await recoverVia(s, {
      entityId: '44444444-4444-4444-8444-444444444444', abandonedBefore: CUTOFF,
    })).toBeNull();
    expect(await recoverVia(s, { providerId: 'apollo', abandonedBefore: CUTOFF })).toBeNull();
  });
});
