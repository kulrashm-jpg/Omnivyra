/**
 * Tests for creatorScalabilityHarnessService:
 *   - boundedPaginate respects hardCap + maxPages
 *   - withCache memoizes within TTL
 *   - runIdempotent skips duplicate keys within TTL
 *   - getQueuePressure returns 'normal' when low
 */

jest.mock('../../queue/bullmqClient', () => ({
  getQueue: jest.fn(() => ({
    getWaitingCount: jest.fn(async () => 10),
    getActiveCount: jest.fn(async () => 1),
    getDelayedCount: jest.fn(async () => 0),
  })),
  getEngagementPollingQueue: jest.fn(() => ({})),
}));

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

describe('creatorScalabilityHarnessService', () => {
  let mod: typeof import('../../services/creatorScalabilityHarnessService');

  beforeEach(async () => {
    mod = await import('../../services/creatorScalabilityHarnessService');
    mod.__resetCreatorScalabilityHarnessForTests();
    jest.clearAllMocks();
  });

  test('boundedPaginate caps at hardCap', async () => {
    const result = await mod.boundedPaginate<number, number[]>(
      async (offset, pageSize) => Array.from({ length: pageSize }, (_, i) => offset + i),
      (acc, row) => { acc.push(row); return acc; },
      [],
      { pageSize: 50, maxPages: 10, hardCap: 75 },
    );
    expect(result.rows).toBe(75);
    expect(result.truncated).toBe(true);
  });

  test('boundedPaginate stops when fetcher returns empty', async () => {
    const result = await mod.boundedPaginate<number, number[]>(
      async (offset, pageSize) => offset >= 100 ? [] : Array.from({ length: pageSize }, (_, i) => offset + i),
      (acc, row) => { acc.push(row); return acc; },
      [],
      { pageSize: 50, maxPages: 10 },
    );
    expect(result.rows).toBe(100);
    expect(result.truncated).toBe(false);
  });

  test('withCache memoizes within TTL', async () => {
    let calls = 0;
    const loader = async () => { calls++; return 'value'; };
    await mod.withCache('k1', 1000, loader);
    await mod.withCache('k1', 1000, loader);
    expect(calls).toBe(1);
  });

  test('runIdempotent skips duplicate keys within TTL', async () => {
    let calls = 0;
    const action = async () => { calls++; return 'ok'; };
    const r1 = await mod.runIdempotent('key-1', 1000, action);
    const r2 = await mod.runIdempotent('key-1', 1000, action);
    expect(r1.executed).toBe(true);
    expect(r2.executed).toBe(false);
    expect(calls).toBe(1);
  });

  test('getQueuePressure returns normal when waiting < threshold', async () => {
    const p = await mod.getQueuePressure();
    expect(p.pressure).toBe('normal');
    expect(p.waiting).toBe(10);
  });
});
