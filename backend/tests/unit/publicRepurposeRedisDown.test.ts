/**
 * e9 ruling (after 05): when Redis is DOWN the public-repurpose limits are 'strict' - the REAL configured cap in an
 * in-process bucket. REAL checkRateLimit; only the Redis client is faked (every pipeline throws -> degraded path).
 */
jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => ({
    multi: () => { throw new Error('ECONNREFUSED (redis down)'); },
    disconnect: () => undefined,
    quit: async () => undefined,
  }),
}));
import { checkRateLimit, __resetRateLimitFallbackForTest } from '../../../lib/auth/rateLimit';
import { PUBLIC_REPURPOSE_COMPANY_LIMIT } from '../../../pages/api/blogs/[id]/repurpose';

describe('Redis down -> the in-process cap still limits (not closed, not unlimited)', () => {
  beforeEach(() => __resetRateLimitFallbackForTest());
  it('per company: exactly the configured cap is allowed, then refused', async () => {
    let allowed = 0;
    for (let i = 0; i < PUBLIC_REPURPOSE_COMPANY_LIMIT.limit + 3; i++) {
      const r = await checkRateLimit('co-redis-down', PUBLIC_REPURPOSE_COMPANY_LIMIT);
      expect(r.bypassed).toBe(true);
      if (r.allowed) allowed += 1;
    }
    expect(allowed).toBe(PUBLIC_REPURPOSE_COMPANY_LIMIT.limit);
  });
});
