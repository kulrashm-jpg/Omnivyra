/**
 * PI-LDB P0 — a successful projection means a ROW, not an absence of exceptions.
 *
 * ─── WHAT THIS SUITE EXISTS TO CATCH ──────────────────────────────────────
 * The import route used to answer `leadProjection: { emitted: true }` whenever
 * the sink did not throw — and the sink never threw, because
 * `upsertCanonicalLead` caught every failure and returned `null`, and the sink
 * turned that `null` into a bare `return`. A record whose write was refused for
 * a missing table, a missing column, an RLS denial or a failed CHECK reported
 * exactly what a record that landed reported.
 *
 * Twelve tests passed over that defect. They passed because the only suite
 * watching the projection doubled the SINK ITSELF, so its observation point was
 * a `jest.fn` and `emitted.length === 1` meant "the mock was invoked". No test
 * in this repository ran the real sink against a database that said no.
 *
 * This suite does. `backend/db/writeOwner` is doubled — the lowest seam that
 * still leaves the repository's error handling, the sink's verdict logic and the
 * real `toRow` payload in the path — and the fake answers with genuine Postgres
 * SQLSTATEs and PostgREST codes. Everything above it is production code.
 *
 * The companion suite `piLdbDurableLeadProjection.test.ts` keeps proving that
 * the orchestrator CALLS the sink with the right payload. The two questions are
 * deliberately in different files: a payload test that also claims to prove
 * persistence is precisely how this got through.
 */

import {
  buildAttributionContract,
  computeLeadDedupeKey,
  LEAD_PROJECTION_STATUSES,
  classifyWriteError,
  needsAttention,
  projectionFailureFrom,
  isProjected,
  type CanonicalLead,
} from '../../../lib/leadIntelligence';

/* ── the fake database ─────────────────────────────────────────────────────*/

type DbError = { code?: string; message?: string };

/** Rows that actually "landed", keyed as the real unique index is. */
const rows = new Map<string, Record<string, unknown>>();
const upsertPayloads: Array<Record<string, unknown>> = [];
const timelinePayloads: Array<Record<string, unknown>> = [];

/** The database's answer to the next upsert. One knob per failure mode. */
let upsertError: DbError | null = null;
/** Accepted, no error, and no row handed back — the ambiguous case. */
let upsertReturnsNoRow = false;
/** A rejected thenable rather than an `error` field. */
let upsertRejectsWith: Error | null = null;
/** The timeline insert fails while the lead row itself landed. */
let timelineError: DbError | null = null;
/**
 * The reconciliation READ the repository issues after an unconfirmed write.
 *
 * This fake used to expose only `upsert` and `insert`, so when
 * `upsertCanonicalLeadWithOutcome` began reading the row back on its dedupe
 * key, `.select` was `undefined`, the call threw a TypeError, and
 * `findCanonicalLeadIdByDedupeKey`'s catch turned that into
 * `{ outcome: 'unknown' }`. The two `pending_reconciliation` tests below then
 * passed — for the right verdict, by the wrong route: an exception, not the
 * read. That is precisely the shape of accident this suite exists to refuse,
 * so the read is now served properly, from the SAME `rows` map the upsert
 * writes to, and counted so a future test can assert it happened.
 */
const reconcileReads: Array<{ companyId: string; dedupeKey: string }> = [];
/** Makes the read itself fail, which must leave the verdict unestablished. */
let reconcileReadError: DbError | null = null;

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => ({
    upsert(row: Record<string, unknown>) {
      upsertPayloads.push(row);
      return {
        select: () => ({
          maybeSingle: async () => {
            if (upsertRejectsWith) throw upsertRejectsWith;
            if (upsertError) return { data: null, error: upsertError };
            if (upsertReturnsNoRow) return { data: null, error: null };
            // Real upsert semantics, so an idempotency assertion means
            // something: same (company_id, dedupe_key) => same row, same id.
            const key = `${String(row.company_id)}|${String(row.dedupe_key)}`;
            const existing = rows.get(key);
            const id = existing ? String(existing.id) : `row-${rows.size + 1}`;
            rows.set(key, { ...row, id });
            return { data: { id }, error: null };
          },
        }),
      };
    },
    async insert(row: Record<string, unknown>) {
      if (table === 'lead_intelligence_events') {
        timelinePayloads.push(row);
        return timelineError ? { data: null, error: timelineError } : { data: null, error: null };
      }
      return { data: null, error: null };
    },
    // The reconciliation read. Keyed EXACTLY as the real unique index is, and
    // served from the same store the upsert writes to — so "the read finds the
    // row" can only be true here if the upsert really put it there under the
    // same (company_id, dedupe_key).
    select(_columns: string) {
      const filters: Record<string, string> = {};
      const chain = {
        eq(column: string, value: string) {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => {
          reconcileReads.push({ companyId: filters.company_id, dedupeKey: filters.dedupe_key });
          if (reconcileReadError) return { data: null, error: reconcileReadError };
          if (table !== 'lead_intelligence') return { data: null, error: null };
          const hit = rows.get(`${filters.company_id}|${filters.dedupe_key}`);
          return { data: hit ? { id: hit.id } : null, error: null };
        },
      };
      return chain;
    },
  }),
}));

import { durableLeadIntelligenceSink, LeadProjectionFailure } from '../../services/leadIntelligence/durableLeadIntelligenceSink';
import {
  upsertCanonicalLeadWithOutcome,
  upsertCanonicalLead,
} from '../../services/leadIntelligence/leadIntelligenceRepository';

const ORG = '00000000-0000-4000-8000-0000000000aa';

function lead(over: Partial<CanonicalLead> = {}): CanonicalLead {
  const identity = { email: 'ada@example.com', unifiedPersonId: 'person-1' };
  return {
    organizationId: ORG,
    source: 'import',
    identity,
    attribution: buildAttributionContract({ Email: 'ada@example.com' }, identity),
    status: null,
    occurredAt: '2026-11-02T10:00:00.000Z',
    display: { name: 'Ada Lovelace', title: 'Senior Procurement Manager', contentText: null },
    sourceRef: { table: 'canonical_leads', id: 'prospect-1' },
    unifiedPersonId: 'person-1',
    ingestedAt: '2026-11-02T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  rows.clear();
  upsertPayloads.length = 0;
  timelinePayloads.length = 0;
  upsertError = null;
  upsertReturnsNoRow = false;
  upsertRejectsWith = null;
  timelineError = null;
  reconcileReads.length = 0;
  reconcileReadError = null;
});

/* ── the contract itself ───────────────────────────────────────────────────*/

describe('the four states are genuinely four', () => {
  it('has four distinct status values', () => {
    // The ONE assertion that catches a contract which keeps all four names and
    // aliases two of them to the same value — a one-line change that silently
    // restores the old two-valued behaviour while every call site still reads
    // correctly. Without this, `pending_reconciliation = persisted` passes.
    expect(new Set(LEAD_PROJECTION_STATUSES).size).toBe(4);
    expect(LEAD_PROJECTION_STATUSES).toHaveLength(4);
  });

  it('treats only `persisted` as projected', () => {
    expect(isProjected({ status: 'persisted', leadId: 'x', reason: null, warnings: [], error: null })).toBe(true);
    for (const status of LEAD_PROJECTION_STATUSES.filter((s) => s !== 'persisted')) {
      expect(isProjected({ status, leadId: null, reason: null, warnings: [], error: null })).toBe(false);
    }
  });

  it('asks for attention on failure and ambiguity, but never on a legitimate skip', () => {
    expect(needsAttention({ status: 'failed', leadId: null, reason: null, warnings: [], error: null })).toBe(true);
    expect(
      needsAttention({ status: 'pending_reconciliation', leadId: null, reason: null, warnings: [], error: null }),
    ).toBe(true);
    // A skip means there was nothing to list. Warning about it would train an
    // operator to ignore the warning that matters.
    expect(needsAttention({ status: 'skipped', leadId: null, reason: 'no_prospect', warnings: [], error: null })).toBe(false);
    expect(needsAttention({ status: 'persisted', leadId: 'x', reason: null, warnings: [], error: null })).toBe(false);
  });
});

describe('a thrown verdict is recovered without instanceof', () => {
  // Regression. The orchestrator first used `e instanceof LeadProjectionFailure`
  // to unwrap this, and that broke the moment a suite did
  // `jest.mock('.../durableLeadIntelligenceSink')`: the imported class became
  // `undefined`, and `e instanceof undefined` does not return false — it throws
  // a TypeError. So the classification crashed in precisely the case it exists
  // to handle, and the symptom was an unrelated-looking test failure.
  it('recovers the verdict from a carried error', () => {
    const verdict = failedVerdict();
    expect(projectionFailureFrom(new LeadProjectionFailure(verdict))).toEqual(verdict);
    // A plain object carrying the same shape works too — that is the point.
    expect(projectionFailureFrom({ result: verdict })).toEqual(verdict);
  });

  it('returns null for an error carrying nothing usable', () => {
    expect(projectionFailureFrom(new Error('durable store unreachable'))).toBeNull();
    expect(projectionFailureFrom({ result: { status: 'not_a_status', warnings: [] } })).toBeNull();
    expect(projectionFailureFrom(null)).toBeNull();
    expect(projectionFailureFrom('boom')).toBeNull();
  });

  function failedVerdict() {
    return {
      status: 'failed' as const,
      leadId: null,
      reason: 'schema_not_applied' as const,
      warnings: [] as string[],
      error: 'column "display" does not exist',
    };
  }
});

describe('a database error is classified, not flattened', () => {
  it.each([
    ['42P01', 'schema_not_applied'],
    ['42703', 'schema_not_applied'],
    ['PGRST204', 'schema_not_applied'],
    ['PGRST205', 'schema_not_applied'],
    ['42501', 'denied'],
    ['23502', 'invalid'],
    ['23514', 'invalid'],
    ['XX000', 'write_failed'],
  ])('maps %s to a definitive failure (%s)', (code, reason) => {
    const result = classifyWriteError(code, 'boom');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe(reason);
    expect(result.leadId).toBeNull();
  });

  // `08006` USED TO BE in the table above, asserted as `write_failed`. That was
  // wrong, and the test defending it was worse than the defect: a connection
  // that drops after the upsert was sent may have committed, so calling it a
  // definitive failure tells an operator to re-enter data that may already be
  // there. The contract's fourth state exists for exactly this.
  it.each([
    ['08006', 'connection_failure'],
    ['08003', 'connection_does_not_exist'],
    ['08007', 'transaction_resolution_unknown'],
    ['57014', 'query_canceled / statement_timeout'],
    ['40001', 'serialization_failure'],
    ['40P01', 'deadlock_detected'],
    ['55P03', 'lock_not_available'],
  ])('maps %s (%s) to pending_reconciliation, never a definitive failure', (code) => {
    const result = classifyWriteError(code, 'connection terminated');
    expect(result.status).toBe('pending_reconciliation');
    expect(result.status).not.toBe('failed');
    expect(result.reason).toBe('no_row_returned');
    expect(result.leadId).toBeNull();
    expect(needsAttention(result)).toBe(true);
  });

  it('keeps the message, because a reason without a detail is not actionable', () => {
    expect(classifyWriteError('42703', 'column "display" does not exist').error).toContain('display');
  });
});

/* ── the write path ────────────────────────────────────────────────────────*/

describe('a confirmed write is reported as persisted', () => {
  it('returns the stored row id', async () => {
    const out = await upsertCanonicalLeadWithOutcome(lead());
    expect(out.status).toBe('persisted');
    expect(out.leadId).toBe('row-1');
    // The row-count baseline: a fake that stored nothing must not be able to
    // satisfy the assertions above.
    expect(rows.size).toBe(1);
  });

  it('writes the display label, which is the column the migration adds', async () => {
    await upsertCanonicalLeadWithOutcome(lead());
    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0].display).toEqual({
      name: 'Ada Lovelace',
      title: 'Senior Procurement Manager',
      contentText: null,
    });
  });

  it('is idempotent on (company_id, dedupe_key)', async () => {
    const first = await upsertCanonicalLeadWithOutcome(lead());
    const second = await upsertCanonicalLeadWithOutcome(lead({ status: 'reviewing' }));
    expect(first.leadId).toBe(second.leadId);
    expect(rows.size).toBe(1);
    // The paired negative: a DIFFERENT prospect must produce a second row, or
    // this test would also pass against a fake that dropped every write.
    const other = await upsertCanonicalLeadWithOutcome(
      lead({ sourceRef: { table: 'canonical_leads', id: 'prospect-2' } }),
    );
    expect(other.leadId).not.toBe(first.leadId);
    expect(rows.size).toBe(2);
  });
});

describe('NEGATIVE CONTROL — a refused write can never read as persisted', () => {
  it.each([
    ['42P01', 'relation "public.lead_intelligence" does not exist', 'schema_not_applied'],
    ['PGRST205', "Could not find the table 'public.lead_intelligence' in the schema cache", 'schema_not_applied'],
    ['42703', 'column "display" of relation "lead_intelligence" does not exist', 'schema_not_applied'],
    ['PGRST204', "Could not find the 'display' column of 'lead_intelligence' in the schema cache", 'schema_not_applied'],
    ['42501', 'new row violates row-level security policy', 'denied'],
    ['23502', 'null value in column "company_id" violates not-null constraint', 'invalid'],
    ['23514', 'violates check constraint "lead_intelligence_display_is_object"', 'invalid'],
  ])('%s is reported as a failure, not success', async (code, message, reason) => {
    upsertError = { code, message };
    // A definitive failure THROWS a typed error, so `origin/main`'s adoption
    // telemetry still counts the dropped lead. The verdict rides on it.
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadProjectionFailure);
    const out = (err as LeadProjectionFailure).result;

    expect(out.status).toBe('failed');
    expect(out.status).not.toBe('persisted');
    expect(out.reason).toBe(reason);
    expect(out.leadId).toBeNull();
    expect(out.error).toContain(message.slice(0, 20));
    // Nothing landed, so nothing may be hung off it.
    expect(rows.size).toBe(0);
    expect(timelinePayloads).toHaveLength(0);
  });

  it('is the realistic 20270201000003-unapplied case, and it is loud', async () => {
    // The composite the programme actually faces: the migration that adds
    // `lead_intelligence.display` is unapplied, `toRow` always supplies the
    // key, so the WHOLE upsert is refused — not "a row without a label".
    // Every record in the batch fails, and before this change every record
    // reported success.
    upsertError = { code: 'PGRST204', message: "Could not find the 'display' column" };
    const results = await Promise.all([
      durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e),
      durableLeadIntelligenceSink
        .emit(lead({ sourceRef: { table: 'canonical_leads', id: 'prospect-2' } }))
        .catch((e: unknown) => e),
    ]);
    const verdicts = results.map((r) => (r as LeadProjectionFailure).result);
    expect(results.every((r) => r instanceof LeadProjectionFailure)).toBe(true);
    expect(verdicts.every((v) => v.status === 'failed')).toBe(true);
    expect(verdicts.every((v) => v.reason === 'schema_not_applied')).toBe(true);
    expect(rows.size).toBe(0);
  });

  it('a thrown driver error is a failure, with its message kept', async () => {
    upsertRejectsWith = new Error('connection terminated unexpectedly');
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadProjectionFailure);
    const out = (err as LeadProjectionFailure).result;
    expect(out.status).toBe('failed');
    expect(out.reason).toBe('write_failed');
    expect(out.error).toContain('connection terminated');
  });

  it('a THROWN error carrying an ambiguous code is unconfirmed, not failed', async () => {
    // The driver can reject the statement instead of returning an error field.
    // Before this, the catch flattened every throw to `write_failed`, which
    // re-opened the ambiguity the classifier had just closed.
    const e = Object.assign(new Error('connection terminated unexpectedly'), { code: '08006' });
    upsertRejectsWith = e;
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((x: unknown) => x);
    const out = (err as LeadProjectionFailure).result;
    expect(out.status).toBe('pending_reconciliation');
    expect(out.status).not.toBe('failed');
  });

  it('a missing tenant is refused before any write is attempted', async () => {
    const err = await durableLeadIntelligenceSink.emit(lead({ organizationId: '' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadProjectionFailure);
    const out = (err as LeadProjectionFailure).result;
    expect(out.status).toBe('failed');
    expect(out.reason).toBe('no_organization');
    expect(upsertPayloads).toHaveLength(0);
  });
});

describe('an unconfirmed write is reported as ambiguous, not guessed', () => {
  it('reports pending_reconciliation when no row comes back and no error is given', async () => {
    upsertReturnsNoRow = true;
    // THROWN, not returned: main's `adoptLeadAsync` counts any throw as
    // `lead_adoption:failed`, and main's own sink threw for every non-row
    // outcome. Returning this would have silently removed observability main
    // already had. The verdict rides on the error, so the import path still
    // distinguishes "unconfirmed" from "failed".
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LeadProjectionFailure);
    const out = (err as LeadProjectionFailure).result;
    // NOT `failed`: the row may well exist, and telling an operator it failed
    // would send them to re-enter data that is already there. NOT `persisted`
    // either — nothing confirmed it. This is the state a boolean cannot hold,
    // and the reason the contract has four values rather than three.
    expect(out.status).toBe('pending_reconciliation');
    expect(out.reason).toBe('no_row_returned');
    expect(out.leadId).toBeNull();
    expect(needsAttention(out)).toBe(true);
    // The reconciliation read RAN, and ran on the key the upsert used. Without
    // this the four assertions above are satisfied by a TypeError from a fake
    // that has no `select` — which is exactly how they used to pass.
    expect(reconcileReads).toEqual([{ companyId: ORG, dedupeKey: computeLeadDedupeKey(lead()) }]);
    // It looked and found nothing, and that did NOT become `failed`: the lost
    // write may still be executing server-side, so an immediate read cannot
    // prove absence. The warning records that we looked.
    expect(out.warnings.join(' ')).toContain('did not find it yet');
  });

  it('upgrades to persisted when the row IS found by its dedupe key', async () => {
    // The staged "it committed and the answer was lost" case: the row is in the
    // store under the key the upsert would use, and the upsert reports no row.
    const l = lead();
    rows.set(`${ORG}|${computeLeadDedupeKey(l)}`, { id: 'row-committed' });
    upsertReturnsNoRow = true;

    const out = await durableLeadIntelligenceSink.emit(l);
    expect(out.status).toBe('persisted');
    expect(out.leadId).toBe('row-committed');
    expect(out.reconciled).toBe(true);
    expect(isProjected(out)).toBe(true);
    expect(needsAttention(out)).toBe(false);
    // Read, never re-written: one upsert attempt, one read, and the store is
    // unchanged — no second identity.
    expect(reconcileReads).toHaveLength(1);
    expect(rows.size).toBe(1);
    // And NO timeline event, because `lead_intelligence_events` has no unique
    // constraint: appending here would duplicate provenance in exactly the case
    // where the first attempt had in fact recorded it.
    expect(timelinePayloads).toHaveLength(0);
  });

  it('stays unestablished when the reconciliation read itself cannot answer', async () => {
    upsertReturnsNoRow = true;
    reconcileReadError = { code: '08006', message: 'connection terminated' };
    const err = await durableLeadIntelligenceSink.emit(lead()).catch((e: unknown) => e);
    const out = (err as LeadProjectionFailure).result;
    // A failed READ must never be read as a proven absence.
    expect(out.status).toBe('pending_reconciliation');
    expect(out.warnings.join(' ')).toContain('could not read this row back');
  });
});

describe('a timeline failure does not downgrade a lead that landed', () => {
  it('stays persisted and carries a warning', async () => {
    timelineError = { code: '42P01', message: 'relation "lead_intelligence_events" does not exist' };
    const out = await durableLeadIntelligenceSink.emit(lead());

    // The lead row IS there and the Lead Database will list it. Reporting a
    // failure here would send an operator hunting for a lead that is present.
    expect(out.status).toBe('persisted');
    expect(out.leadId).toBe('row-1');
    expect(rows.size).toBe(1);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('timeline');
    expect(needsAttention(out)).toBe(false);
  });

  it('carries no warning when the timeline event did land', async () => {
    const out = await durableLeadIntelligenceSink.emit(lead());
    expect(out.status).toBe('persisted');
    expect(out.warnings).toEqual([]);
    expect(timelinePayloads).toHaveLength(1);
  });
});

describe('the pre-existing fail-open wrapper is unchanged', () => {
  it('still answers null on failure, so its existing consumers and tests are untouched', async () => {
    // `upsertCanonicalLead` keeps its `{id} | null` contract deliberately: it
    // is pinned by a tracked, pre-existing suite owned by another track, and
    // the richer verdict is available beside it rather than instead of it.
    upsertError = { code: '42P01', message: 'nope' };
    expect(await upsertCanonicalLead(lead())).toBeNull();
  });

  it('still answers the row id on success', async () => {
    expect(await upsertCanonicalLead(lead())).toEqual({ id: 'row-1' });
  });
});
