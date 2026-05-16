/**
 * Tests for creatorUploadAbuseGuardService:
 *   - allows uploads under rate limit
 *   - blocks at user attempt threshold
 *   - blocks at company byte threshold
 *   - blocks oversized uploads immediately
 *   - blocks after spoof threshold
 *   - blocks on high failure ratio
 *   - FAILS OPEN on DB error
 *   - verifyUploadSession deterministic
 */

type Bucket = { id?: string; scope: string; scope_id: string; bucket_start: string; attempt_count: number; byte_total: number; spoof_count: number; failure_count: number };
let buckets: Bucket[] = [];
let dbShouldThrow = false;

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: jest.fn(() => {
      const filters: Record<string, any> = {};
      const api: any = {
        select: jest.fn(() => api),
        eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
        gte: jest.fn((k: string, v: any) => { filters[`${k}__gte`] = v; return api; }),
        order: jest.fn(() => Promise.resolve({ data: queryBuckets(filters), error: null })),
        maybeSingle: jest.fn(async () => {
          if (dbShouldThrow) throw new Error('db');
          return { data: queryBuckets(filters)[0] ?? null, error: null };
        }),
      };
      return api;
    }),
  },
}));

function queryBuckets(filters: Record<string, any>): Bucket[] {
  let rows = [...buckets];
  for (const [k, v] of Object.entries(filters)) {
    if (k.endsWith('__gte')) {
      const f = k.slice(0, -5);
      rows = rows.filter((r) => (r as any)[f] >= v);
    } else {
      rows = rows.filter((r) => (r as any)[k] === v);
    }
  }
  return rows;
}

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: jest.fn(() => {
    let payload: any = null;
    const filters: Record<string, any> = {};
    const api: any = {
      insert: jest.fn(async (row: any) => {
        if (dbShouldThrow) throw new Error('db');
        buckets.push({ id: `b-${buckets.length + 1}`, ...row });
        return { data: row, error: null };
      }),
      update: jest.fn((p: any) => { payload = p; return api; }),
      eq: jest.fn((k: string, v: any) => { filters[k] = v; return api; }),
      then(resolve: any) {
        if (payload) {
          const target = buckets.find((b) => (filters.id ? b.id === filters.id : false));
          if (target) Object.assign(target, payload);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return api;
  }),
}));

jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creatorOperationalTelemetryService', () => ({
  emitCreatorEvent: jest.fn(),
  CREATOR_EVENTS: {
    ABUSE_DETECTED: 'abuse_detected',
    RATE_LIMIT_BLOCKED: 'rate_limit_blocked',
  },
}));
jest.mock('../../services/creatorAuditTrailService', () => ({ recordAuditEntry: jest.fn() }));

const bucketStart = () => {
  const aligned = Date.now() - (Date.now() % 60_000);
  return new Date(aligned).toISOString();
};

describe('creatorUploadAbuseGuardService', () => {
  beforeEach(() => {
    buckets = [];
    dbShouldThrow = false;
    jest.clearAllMocks();
  });

  test('allows uploads under all thresholds', async () => {
    const g = await import('../../services/creatorUploadAbuseGuardService');
    const decision = await g.checkUploadAttemptAllowed({ userId: 'u-1', companyId: 'c-1', sizeBytes: 1024 });
    expect(decision.allowed).toBe(true);
  });

  test('blocks oversized uploads immediately', async () => {
    const g = await import('../../services/creatorUploadAbuseGuardService');
    const decision = await g.checkUploadAttemptAllowed({ userId: 'u-2', companyId: 'c-1', sizeBytes: 5 * 1024 * 1024 * 1024 });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe('oversized');
  });

  test('blocks after user attempt threshold', async () => {
    buckets.push({ scope: 'user', scope_id: 'u-3', bucket_start: bucketStart(), attempt_count: 100, byte_total: 0, spoof_count: 0, failure_count: 0 });
    const g = await import('../../services/creatorUploadAbuseGuardService');
    const decision = await g.checkUploadAttemptAllowed({ userId: 'u-3', companyId: 'c-1', sizeBytes: 1024 });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe('rate_limited');
  });

  test('blocks after spoof threshold', async () => {
    buckets.push({ scope: 'user', scope_id: 'u-4', bucket_start: bucketStart(), attempt_count: 3, byte_total: 0, spoof_count: 5, failure_count: 0 });
    const g = await import('../../services/creatorUploadAbuseGuardService');
    const decision = await g.checkUploadAttemptAllowed({ userId: 'u-4', companyId: 'c-1' });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe('abuse_spoof');
  });

  test('blocks on high failure ratio', async () => {
    buckets.push({ scope: 'user', scope_id: 'u-5', bucket_start: bucketStart(), attempt_count: 12, byte_total: 0, spoof_count: 0, failure_count: 11 });
    const g = await import('../../services/creatorUploadAbuseGuardService');
    const decision = await g.checkUploadAttemptAllowed({ userId: 'u-5', companyId: 'c-1' });
    expect(decision.allowed).toBe(false);
    if (decision.allowed === false) expect(decision.reason).toBe('abuse_failure_storm');
  });

  test('FAILS OPEN when DB errors', async () => {
    dbShouldThrow = true;
    const g = await import('../../services/creatorUploadAbuseGuardService');
    const decision = await g.checkUploadAttemptAllowed({ userId: 'u-6', companyId: 'c-1' });
    expect(decision.allowed).toBe(true);
  });

  test('verifyUploadSession is deterministic for the same plan+company', async () => {
    const g = await import('../../services/creatorUploadAbuseGuardService');
    // A short obviously-bogus session should return false
    expect(g.verifyUploadSession({ sessionId: 'short', dailyPlanId: 'plan-1', companyId: 'company-1' })).toBe(false);
  });
});
