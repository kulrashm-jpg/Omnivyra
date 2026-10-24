/**
 * Closure-014 (F) — certification connection targets are an ALLOW-list (loopback),
 * not only a production deny-list. Pure scan; no network, no env files read.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { scanCertEnv, assertCertIsolationInProcess, LOOPBACK_REQUIRED_VARS } = require('../../../scripts/lib/certAwareEnv.cjs');

const LOCAL = {
  CERT_ENV: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:54322/postgres',
  REDIS_URL: 'redis://127.0.0.1:6390/0',
};

describe('scanCertEnv (CERT_ENV=1 loopback allow-list)', () => {
  it('a fully loopback certification env is clean', () => {
    expect(scanCertEnv(LOCAL)).toEqual([]);
    expect(scanCertEnv({ ...LOCAL, REDIS_URL: 'redis://[::1]:6390' })).toEqual([]);
  });

  it.each(LOOPBACK_REQUIRED_VARS.map((k: string) => [k]))('%s pointing at a non-loopback host is refused', (key: string) => {
    const v = scanCertEnv({ ...LOCAL, [key]: 'redis://shared-redis.internal:6379/14' });
    expect(v.some((x: string) => x.startsWith(`${key} → non-loopback host`))).toBe(true);
  });

  it('SUPABASE_POOLER_URL (which supabaseClient prefers over SUPABASE_URL) is covered', () => {
    expect(scanCertEnv({ ...LOCAL, SUPABASE_POOLER_URL: 'postgresql://u:p@db.example.com:6543/postgres' }))
      .toContain('SUPABASE_POOLER_URL → non-loopback host "db.example.com"');
  });

  it('production markers are still refused, including the production Upstash host', () => {
    const v = scanCertEnv({ ...LOCAL, REDIS_URL: 'rediss://default:x@noble-dane-77325.upstash.io:6379' });
    expect(v).toContain('REDIS_URL → "noble-dane-77325.upstash.io"');
  });

  it('the shared production queue keyspace cannot be selected from certification', () => {
    expect(scanCertEnv({ ...LOCAL, OMNIVYRA_ALLOW_SHARED_QUEUES: '1' }).length).toBe(1);
    expect(scanCertEnv({ ...LOCAL, NODE_ENV: 'production' }).length).toBe(1);
  });

  it('a non-URL value for a connection var is refused (cannot be proven loopback)', () => {
    expect(scanCertEnv({ ...LOCAL, REDIS_URL: 'shared-redis:6379' })[0]).toMatch(/^REDIS_URL → not a URL/);
  });

  it('violations never contain credentials', () => {
    const v = scanCertEnv({ ...LOCAL, DATABASE_URL: 'postgresql://admin:SuperSecret@prod.example.com:5432/db' });
    expect(v.join(' ')).not.toContain('SuperSecret');
  });

  it('outside CERT_ENV=1 the in-process guard is inert (normal dev/prod unchanged)', () => {
    expect(assertCertIsolationInProcess({ ...LOCAL, CERT_ENV: undefined, REDIS_URL: 'redis://shared:6379' }))
      .toEqual({ ok: true, violations: [] });
  });
});
