/**
 * Phase 27B.2 — long-form operation claim tests.
 */

import {
  claimLongFormOperation,
  createInMemoryLongFormClaimSqlClient,
  markLongFormOperationCompleted,
  markLongFormOperationFailed,
  LongFormClaimError,
} from '../../../../../services/orchestration/distributed/domain/production/longFormOperationClaim';

describe('claimLongFormOperation', () => {
  test('first caller wins, second caller observes duplicate', async () => {
    const sql = createInMemoryLongFormClaimSqlClient();
    const first = await claimLongFormOperation({
      operationKey: 'lf:gen-1:v1',
      sql,
      metadata: { generationId: 'gen-1', model: 'opus' },
      telemetry: { emit: () => {} },
    });
    expect(first.outcome).toBe('won');

    const second = await claimLongFormOperation({
      operationKey: 'lf:gen-1:v1',
      sql,
      metadata: { generationId: 'gen-1', model: 'opus' },
      telemetry: { emit: () => {} },
    });
    expect(second.outcome).toBe('duplicate');
    if (second.outcome === 'duplicate') {
      expect(second.existing.status).toBe('in_flight');
    }
  });

  test('completion is observable by losers', async () => {
    const sql = createInMemoryLongFormClaimSqlClient();
    await claimLongFormOperation({ operationKey: 'lf:gen-2:v1', sql });
    await markLongFormOperationCompleted({
      operationKey: 'lf:gen-2:v1',
      resultRowId: 'reco-99',
      sql,
    });

    const second = await claimLongFormOperation({
      operationKey: 'lf:gen-2:v1',
      sql,
    });
    expect(second.outcome).toBe('duplicate');
    if (second.outcome === 'duplicate') {
      expect(second.existing.status).toBe('completed');
      expect(second.existing.resultRowId).toBe('reco-99');
    }
  });

  test('failure leaves the row in failed state', async () => {
    const sql = createInMemoryLongFormClaimSqlClient();
    await claimLongFormOperation({ operationKey: 'lf:gen-3:v1', sql });
    await markLongFormOperationFailed({
      operationKey: 'lf:gen-3:v1',
      lastError: 'gateway timeout',
      sql,
    });
    const second = await claimLongFormOperation({ operationKey: 'lf:gen-3:v1', sql });
    expect(second.outcome).toBe('duplicate');
    if (second.outcome === 'duplicate') {
      expect(second.existing.status).toBe('failed');
      expect(second.existing.lastError).toBe('gateway timeout');
    }
  });

  test('concurrent claimants resolve to exactly one winner', async () => {
    const sql = createInMemoryLongFormClaimSqlClient();
    const results = await Promise.all(
      Array.from({ length: 8 }).map(() =>
        claimLongFormOperation({ operationKey: 'lf:gen-4:v1', sql }),
      ),
    );
    const winners = results.filter((r) => r.outcome === 'won').length;
    const duplicates = results.filter((r) => r.outcome === 'duplicate').length;
    expect(winners).toBe(1);
    expect(duplicates).toBe(7);
  });

  test('emits won + duplicate telemetry events', async () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    const sql = createInMemoryLongFormClaimSqlClient();
    const telemetry = { emit: (event: string, payload: Record<string, unknown>) => events.push({ event, payload }) };

    await claimLongFormOperation({ operationKey: 'lf:gen-5:v1', sql, telemetry });
    await claimLongFormOperation({ operationKey: 'lf:gen-5:v1', sql, telemetry });

    expect(events.filter((e) => e.event === 'long_form_claim_won').length).toBe(1);
    expect(events.filter((e) => e.event === 'long_form_claim_lost_duplicate').length).toBe(1);
  });

  test('rejects missing operationKey', async () => {
    const sql = createInMemoryLongFormClaimSqlClient();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claimLongFormOperation({ operationKey: '', sql } as any),
    ).rejects.toThrow(LongFormClaimError);
  });

  test('surfaces SQL_ERROR on insertIfAbsent throw', async () => {
    const sql = createInMemoryLongFormClaimSqlClient();
    const throwingSql = {
      ...sql,
      insertIfAbsent: async () => { throw new Error('connection refused'); },
    };
    await expect(
      claimLongFormOperation({ operationKey: 'lf:gen-6:v1', sql: throwingSql }),
    ).rejects.toMatchObject({ code: 'SQL_ERROR' });
  });
});
