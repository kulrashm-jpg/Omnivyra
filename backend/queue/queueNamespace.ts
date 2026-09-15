/**
 * SEC-C2 (STEP 3AH-91) — BullMQ environment isolation, fail closed.
 *
 * Every Queue / Worker / QueueEvents in this codebase takes its key prefix
 * from getQueuePrefix() (bullmqClient), which delegates here. Production has
 * always used BullMQ's shared default prefix `bull` (the env-scoped prefix is
 * behind the OMNIVYRA_QUEUE_PREFIX_ENABLED migration flag, which is unset in
 * production — flipping it would strand in-flight production jobs).
 *
 * The hazard: `.env.local` points a developer laptop at the PRODUCTION Redis
 * (and database). A laptop running `npm run dev:full` therefore used the same
 * `bull:*` keyspace as the Railway production worker — its workers could
 * claim production jobs (publishing posts with unreviewed local code), and its
 * producers could hand work to the production worker. A local worker once
 * wrote ~42k rows into production.
 *
 * Rules (production behaviour is byte-identical):
 *
 *   1. OMNIVYRA_QUEUE_PREFIX_ENABLED=true → `omnivyra:<env>:` (unchanged).
 *   2. NODE_ENV === 'production' → `bull` (unchanged). Every deployed runtime
 *      lands here deterministically: Next.js forces NODE_ENV=production on
 *      Vercel, and Dockerfile.worker/Dockerfile.cron set ENV NODE_ENV=production
 *      for Railway. This rule deliberately does NOT depend on platform marker
 *      variables, so a platform that stops exposing them can never silently
 *      move production onto another keyspace.
 *   3. Any other process (next dev, ts-node workers/cron, scripts, tests)
 *      → an ENV-SCOPED prefix `omnivyra:<env>:` — it can neither consume nor
 *      produce on the production queues. FAIL CLOSED: isolation is the
 *      default; sharing is the exception.
 *   4. Explicit, logged opt-in for rule 3: OMNIVYRA_ALLOW_SHARED_QUEUES=1
 *      (an operator deliberately driving production queues from a laptop).
 *
 * Second seatbelt for rule 2 (consumers only): a process that claims
 * NODE_ENV=production but carries NO deployment-platform marker and targets a
 * non-local Redis — e.g. the docker-compose "Railway parity" worker pointed at
 * the Upstash URL from .env.local, or `node dist/backend/workers/main.js` run
 * by hand — must not start consumers on the shared keyspace.
 * assertQueueConsumerRuntimeAllowed() refuses (throws) in that case unless the
 * opt-in is set. It is called by the consumer bootstraps (worker main, the dev
 * worker bootstrap, the scheduler) — never by producers, so a web runtime is
 * unaffected even if its platform markers were missing.
 */

type Env = Record<string, string | undefined>;

/** Opt-in that lets a non-production / unmarked process use the shared `bull` keyspace. */
export const SHARED_QUEUE_OPT_IN_ENV = 'OMNIVYRA_ALLOW_SHARED_QUEUES';

/** The legacy shared BullMQ prefix every production runtime uses. */
export const SHARED_PRODUCTION_PREFIX = 'bull';

/**
 * Variables injected by the deployment platform itself. Railway injects the
 * RAILWAY_* set into every deployment (the worker boot log records
 * RAILWAY_GIT_COMMIT_SHA / RAILWAY_DEPLOYMENT_ID); Vercel exposes VERCEL /
 * VERCEL_ENV.
 */
const DEPLOYMENT_MARKERS = [
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_DEPLOYMENT_ID',
  'RAILWAY_GIT_COMMIT_SHA',
  'VERCEL',
  'VERCEL_ENV',
] as const;

function optedIn(env: Env): boolean {
  return /^(1|true|yes)$/i.test(String(env[SHARED_QUEUE_OPT_IN_ENV] ?? ''));
}

/** Environment label used inside the env-scoped prefix (unchanged from bullmqClient). */
export function getQueueRuntimeEnv(env: Env = process.env): string {
  if (env.VERCEL_ENV) return env.VERCEL_ENV;
  if (env.RAILWAY_ENVIRONMENT) {
    return env.RAILWAY_ENVIRONMENT === 'production'
      ? 'production'
      : `railway-${env.RAILWAY_ENVIRONMENT}`;
  }
  if (env.NODE_ENV === 'test') return 'test';
  return 'local';
}

export function hasDeploymentMarker(env: Env = process.env): boolean {
  return DEPLOYMENT_MARKERS.some((k) => typeof env[k] === 'string' && env[k]!.trim() !== '');
}

/**
 * True when the Redis URL points at this machine or a docker-compose service
 * (loopback, `host.docker.internal`, or a single-label host such as `redis`).
 * An unset URL means the localhost default. Anything else is treated as a
 * shared/managed Redis (fail closed).
 */
export function isLocalRedisTarget(url: string | undefined): boolean {
  if (!url || !url.trim()) return true;
  const match = url.match(/rediss?:\/\/\S+/);
  let host: string;
  try {
    host = new URL(match ? match[0] : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === 'host.docker.internal') return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true;
  return host !== '' && !host.includes('.') && !host.includes(':');
}

export type QueueNamespaceReason =
  | 'prefix-migration-flag'
  | 'production-runtime'
  | 'explicit-opt-in'
  | 'non-production-isolated';

export interface QueueNamespace {
  prefix: string;
  /** True when this process shares the production `bull` keyspace. */
  shared: boolean;
  reason: QueueNamespaceReason;
}

/** Pure resolution of the BullMQ prefix for a process environment. */
export function resolveQueueNamespace(env: Env = process.env): QueueNamespace {
  if (env.OMNIVYRA_QUEUE_PREFIX_ENABLED === 'true') {
    return { prefix: `omnivyra:${getQueueRuntimeEnv(env)}:`, shared: false, reason: 'prefix-migration-flag' };
  }
  if (env.NODE_ENV === 'production') {
    return { prefix: SHARED_PRODUCTION_PREFIX, shared: true, reason: 'production-runtime' };
  }
  if (optedIn(env)) {
    return { prefix: SHARED_PRODUCTION_PREFIX, shared: true, reason: 'explicit-opt-in' };
  }
  return { prefix: `omnivyra:${getQueueRuntimeEnv(env)}:`, shared: false, reason: 'non-production-isolated' };
}

export class QueueIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueIsolationError';
  }
}

/**
 * Consumer-bootstrap seatbelt. Throws QueueIsolationError when a process
 * would consume the shared production keyspace from outside a deployment
 * platform against a non-local Redis. No-op for every deployed runtime, for
 * isolated (non-production) processes, for local/compose Redis, and when the
 * explicit opt-in is set.
 */
export function assertQueueConsumerRuntimeAllowed(context: string, env: Env = process.env): void {
  const ns = resolveQueueNamespace(env);
  if (!ns.shared) return;
  if (ns.reason === 'explicit-opt-in') return;
  if (hasDeploymentMarker(env)) return;
  if (isLocalRedisTarget(env.REDIS_URL)) return;
  if (optedIn(env)) return;
  throw new QueueIsolationError(
    `[queue-isolation] ${context}: refusing to start BullMQ consumers on the shared production ` +
    `keyspace ("${ns.prefix}") — NODE_ENV=production but no deployment-platform marker ` +
    `(RAILWAY_* / VERCEL*) is present and REDIS_URL points at a non-local Redis. ` +
    `This is how a developer machine ends up processing production jobs. ` +
    `Point REDIS_URL at a local Redis, or set ${SHARED_QUEUE_OPT_IN_ENV}=1 if you really ` +
    `intend to consume production queues from this process.`,
  );
}
