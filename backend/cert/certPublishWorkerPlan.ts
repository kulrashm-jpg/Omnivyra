/**
 * Closure-014 (G) — the pure safety check for the certification publish
 * worker (scripts/cert/publish-worker-cert.ts). Returns the refusals; the
 * launcher refuses to construct any Worker unless this list is empty.
 *
 * Requires, beyond resolveCertFakePublisher's own conditions:
 *   - a dedicated certification BullMQ prefix (never the shared `bull`);
 *   - a Redis URL that names an explicit database index (the parser now
 *     honours it — Closure-014 D-1), so the cert worker never shares DB 0;
 *   - ENABLE_AUTO_WORKERS is not '1' (no other consumer in this process).
 */
import { certFakePublisherRefusals } from '../adapters/certFakePublisher';
import { parseRedisConnectionUrl } from '../../lib/redis/redisUrl';

type Env = Record<string, string | undefined>;

export function certPublishWorkerRefusals(env: Env, queuePrefix: string): string[] {
  const out = [...certFakePublisherRefusals(env)];
  if (env.CERT_FAKE_PUBLISHER !== '1') out.push('CERT_FAKE_PUBLISHER is not 1 (the real provider path must never run in certification)');
  if (queuePrefix === 'bull' || !queuePrefix.trim()) out.push(`queue prefix "${queuePrefix}" is the shared production keyspace`);
  if (env.ENABLE_AUTO_WORKERS === '1') out.push('ENABLE_AUTO_WORKERS=1 would start other consumers');
  if (env.REDIS_URL) {
    try {
      const r = parseRedisConnectionUrl(env.REDIS_URL);
      if (r.db === undefined || r.db === 0) out.push('REDIS_URL must select a dedicated non-zero database index for certification');
    } catch (e) {
      out.push(`REDIS_URL is invalid (${(e as Error).name})`);
    }
  }
  return out;
}
