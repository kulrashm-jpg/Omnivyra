/**
 * Mode B stop-gap (PI review): a PAID vendor answer whose persistence failed
 * must never be re-paid by the automated retry sweep.
 *
 * The recorded executor closes that case as execution_status 'platform_failed',
 * provider_call_state 'called', outcome NULL (recordedExecution.ts). The retry
 * sweep admits only an explicit RETRYABLE outcome, so a NULL outcome is never a
 * candidate: zero further vendor calls. This pins that guarantee where the
 * retry decision is made (isRetryCandidate + the DB predicate it mirrors).
 */
import { isRetryCandidate, retryClassOf, RETRYABLE_OUTCOMES } from '../../services/enrichment/retryCandidates';

const NOW = '2026-11-10T12:00:00.000Z';
const paidNotStored = {
  outcome: null, execution_status: 'platform_failed', provider_call_state: 'called',
  completed_at: '2026-11-10T11:00:00.000Z', next_retry_at: '2026-11-10T11:30:00.000Z',
};

it('a paid-but-not-stored attempt is NEVER a retry candidate, even with a due retry time', () => {
  expect(isRetryCandidate(paidNotStored, NOW)).toBe(false);
  expect(retryClassOf(null)).not.toBe('retryable');
  expect(RETRYABLE_OUTCOMES).not.toContain(null as never);
});

it('NEGATIVE CONTROL: a COMPLETED call with a retryable outcome IS a candidate', () => {
  expect(isRetryCandidate({ ...paidNotStored, execution_status: 'completed', outcome: 'rate_limited' }, NOW)).toBe(true);
});

it('a vendor-answered miss is final too (no re-pay of a no_match)', () => {
  expect(isRetryCandidate({ ...paidNotStored, outcome: 'no_match', execution_status: 'completed' }, NOW)).toBe(false);
});

it('HARDENED: paid-not-stored is never retried even if it later carries a retryable outcome', () => {
  expect(isRetryCandidate({ ...paidNotStored, outcome: 'rate_limited' }, NOW)).toBe(false);
  // NEGATIVE CONTROL: a platform failure with NO call stays retryable when its outcome is.
  expect(isRetryCandidate({ ...paidNotStored, provider_call_state: 'not_called', outcome: 'rate_limited' }, NOW)).toBe(true);
});

describe('USER path: the existing rule (decideEnrichmentAction) refuses a re-pay', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { executeEnrichmentRecorded, EnrichmentOperatorReviewRequired } = require('../../services/enrichment/recordedExecution');
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const request = { organizationId: ORG, subject: 'account', entityId: 'acct-1', attributes: ['employee_count'], selectors: { domain: 'x.com' }, purpose: 't', correlationId: 'c1' };
  const latestRow = (over: Record<string, unknown>) => ({
    executionStatus: 'platform_failed', providerCallState: 'called', outcome: null,
    completedAt: '2026-11-10T11:00:00.000Z', claimedUntil: null, ...over,
  });
  const run = async (latest: unknown, lease?: unknown) => {
    const log: string[] = [];
    const ports = {
      authorizeCost: async () => { log.push('cost'); return { authorized: true, holdId: null, cost: { kind: 'unknown' } }; },
      releaseCost: async () => undefined,
      resolveCredential: async () => { log.push('credential'); return 'k'; },
      findRecentObservation: async () => null,
      persistObservation: async () => ({ sourceRecordId: 's', canonicalWithheld: [] }),
      now: () => NOW,
    };
    const adapter = { id: 'apollo', label: 'A', supports: ['employee_count'], credentialEnvVar: null, isAvailable: () => false,
      enrich: async () => { log.push('CALL'); return { outcome: 'no_match', fields: [], notReturned: ['employee_count'] }; } };
    const recorder = {
      now: () => NOW, latest: async () => latest, nextNumber: async () => 1,
      record: async () => { log.push('record'); return { attemptId: 'a1' }; },
      complete: async () => undefined, markPending: async () => undefined,
      claim: async () => ({ attemptId: 'a1', attemptNumber: 1, reclaimed: false }),
    };
    let error: unknown = null;
    try { await executeEnrichmentRecorded(request, 'apollo', ports, { adapter, recorder, ...(lease ? { lease } : {}) }); }
    catch (e) { error = e; }
    return { log, error };
  };

  it('latest attempt PAID, NOT STORED -> refused before any record, credential, cost or call', async () => {
    const { log, error } = await run(latestRow({}));
    expect(error).toBeInstanceOf(EnrichmentOperatorReviewRequired);
    expect((error as { decision: string }).decision).toBe('OPERATOR_REVIEW');
    expect((error as Error).message).toContain('response was not persisted');
    expect(log).toEqual([]);
  });

  it('NEGATIVE CONTROL: a clean prior attempt (completed miss) proceeds as before', async () => {
    const { log, error } = await run(latestRow({ executionStatus: 'completed', outcome: 'no_match' }));
    expect(error).toBeNull();
    expect(log).toContain('CALL');
  });

  it('no history -> proceeds', async () => {
    const { log, error } = await run(null);
    expect(error).toBeNull();
    expect(log).toContain('CALL');
  });

  it('the LEASED (queue) path is not gated here: consumeEnrichmentWork already applies the rule', async () => {
    const { error } = await run(latestRow({}), { claimedBy: 'w1', ttlMs: 60_000 });
    expect(error).not.toBeInstanceOf(EnrichmentOperatorReviewRequired);
  });
});
