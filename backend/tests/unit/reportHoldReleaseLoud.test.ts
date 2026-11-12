/**
 * A failed report's credit hold that is NOT released is loud (e9/e1, 2026-11-12).
 *
 * recoverStaleGeneratingReports marks stuck reports `failed`, then releases each one's hold and
 * swallows any rejection. The row is no longer `generating`, so nothing retries. Before this,
 * a failed release was a console.error line at most, and `already_confirmed` (a FAILED report
 * whose hold was charged) was a console.warn reading "released". Now each one is an ERROR log
 * plus a monetization operational event (alert-ready, human review).
 *
 * REAL: recoverStaleGeneratingReports, releaseReportCreditReservation, releaseCreditReservation
 * (its released / already_released / already_confirmed / throw logic) and
 * recordMonetizationOperationalEvent. FAKED, I/O only: the credit repository's lookups and the
 * reservation RPC, and two tables (reports, monetization_operational_events). Any other table
 * throws.
 *
 * Per-site mutants: there are two loud sites (the throw path, the not-released status). Each
 * has its own named cases (SITE 1 / SITE 2). Removing either site fails exactly its own cases: site 1
 * fails both SITE 1 cases (the event-insert-throws case drives the same path), site 2 fails SITE 2.
 */
const events: Array<Record<string, unknown>> = [];
const eventInsert: { mode: 'ok' | 'throw' } = { mode: 'ok' };
let reportsRow: Record<string, unknown>;
let releasePhase: { existing: 'none' | 'release' | 'confirm'; rpcError: string | null };
const rpcCalls: string[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table === 'monetization_operational_events') {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (eventInsert.mode === 'throw') throw new Error('events table unreachable');
          events.push(row);
          return { error: null };
        },
      };
    }
    if (table === 'reports') {
      const select = {
        eq: () => select, or: () => select, order: () => select,
        limit: async () => ({ data: [reportsRow], error: null }),
      };
      const update = {
        in: () => update,
        eq: () => update,
        select: async () => ({ data: [{ id: reportsRow.id }], error: null }),
      };
      return { select: () => select, update: () => update };
    }
    throw new Error(`undeclared table ${table}`);
  },
  ownedDbRpc: () => { throw new Error('undeclared rpc'); },
}));

jest.mock('../../repositories/creditExecutionRepository', () => {
  const actual = jest.requireActual('../../repositories/creditExecutionRepository');
  return {
    ...actual,
    findCreditTransaction: async (key: string) => {
      if (key.endsWith(':release')) return releasePhase.existing === 'release' ? { id: 'tx-rel', execution_phase: 'release' } : null;
      if (key.endsWith(':confirm')) return releasePhase.existing === 'confirm' ? { id: 'tx-conf', execution_phase: 'confirm' } : null;
      throw new Error(`undeclared lookup ${key}`);
    },
    callCreditReservation: async (cmd: { phase: string; idempotencyKey: string }) => {
      rpcCalls.push(`${cmd.phase}:${cmd.idempotencyKey}`);
      if (cmd.phase !== 'release') throw new Error(`undeclared phase ${cmd.phase}`);
      return releasePhase.rpcError
        ? { error: new Error(releasePhase.rpcError), transactionId: null }
        : { error: null, transactionId: 'tx-new-release' };
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recoverStaleGeneratingReports } = require('../../services/reportCardService');

const ORG = '0c000000-0000-4000-8000-000000000001';
const reservation = {
  holdTransactionId: 'hold-tx-1',
  idempotencyKey: 'report:rep-1',
  action: 'report_generation',
  orgId: ORG,
  userId: '0c000000-0000-4000-8000-0000000000aa',
  referenceType: 'report',
  referenceId: 'rep-1',
  split: { free: 5, incentive: 0, paid: 0 },
  feature_key: 'snapshot_report',
};

let errorLog: jest.SpyInstance;
beforeEach(() => {
  events.length = 0;
  rpcCalls.length = 0;
  eventInsert.mode = 'ok';
  reportsRow = { id: 'rep-1', status: 'generating', metadata: { credit_reservation: reservation } };
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const unreleasedEvents = () => events.filter((e) => String(e.event_name).startsWith('monetization.report_reservation_'));

describe('stale-report recovery: an unreleased hold is loud', () => {
  it('SITE 1: a release that THROWS records an ERROR event, and recovery still completes', async () => {
    releasePhase = { existing: 'none', rpcError: 'apply_credit_reservation: connection reset' };
    const r = await recoverStaleGeneratingReports();
    expect(r.recovered).toBe(1);
    expect(rpcCalls).toEqual(['release:report:rep-1:release']);
    expect(unreleasedEvents()).toHaveLength(1);
    expect(unreleasedEvents()[0]).toMatchObject({
      event_name: 'monetization.report_reservation_release_failed',
      severity: 'ERROR',
      organization_id: ORG,
      reservation_id: 'hold-tx-1',
      alert_ready: true,
      requires_human_review: true,
    });
    expect((unreleasedEvents()[0].metadata as Record<string, unknown>).report_id).toBe('rep-1');
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes('NOT released (monetization.report_reservation_release_failed)'))).toBe(true);
  });

  it('SITE 2: already_confirmed (a failed report was charged) records an ERROR event and no release', async () => {
    releasePhase = { existing: 'confirm', rpcError: null };
    const r = await recoverStaleGeneratingReports();
    expect(r.recovered).toBe(1);
    expect(rpcCalls).toEqual([]);
    expect(unreleasedEvents()).toHaveLength(1);
    expect(unreleasedEvents()[0]).toMatchObject({
      event_name: 'monetization.report_reservation_already_confirmed',
      severity: 'ERROR',
      requires_human_review: true,
    });
    expect((unreleasedEvents()[0].metadata as Record<string, unknown>).detail).toBe('release returned already_confirmed');
  });

  it('released: quiet, no event', async () => {
    releasePhase = { existing: 'none', rpcError: null };
    await recoverStaleGeneratingReports();
    expect(rpcCalls).toEqual(['release:report:rep-1:release']);
    expect(unreleasedEvents()).toHaveLength(0);
  });

  it('already_released: quiet, no event (idempotent replay)', async () => {
    releasePhase = { existing: 'release', rpcError: null };
    await recoverStaleGeneratingReports();
    expect(rpcCalls).toEqual([]);
    expect(unreleasedEvents()).toHaveLength(0);
  });

  it('SITE 1, event insert throws: never masks the outcome; still logged, recovery completes', async () => {
    releasePhase = { existing: 'none', rpcError: 'boom' };
    eventInsert.mode = 'throw';
    const r = await recoverStaleGeneratingReports();
    expect(r.recovered).toBe(1);
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes('could not record the unreleased-hold event'))).toBe(true);
  });

  it('a report with no reservation records nothing', async () => {
    releasePhase = { existing: 'none', rpcError: 'must not be called' };
    reportsRow = { id: 'rep-2', status: 'generating', metadata: {} };
    await recoverStaleGeneratingReports();
    expect(rpcCalls).toEqual([]);
    expect(unreleasedEvents()).toHaveLength(0);
  });
});
