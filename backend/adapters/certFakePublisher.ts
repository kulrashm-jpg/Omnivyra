/**
 * Closure-014 (G) — certification-only fake publishing provider.
 *
 * Lets the REAL publish worker (claim → PUBLISH_CALL_STARTED → outcome
 * handling, queue_jobs.metadata.platform_call, PUBLISH_OUTCOME_UNCERTAIN) run
 * end-to-end against an isolated certification stack without any platform
 * call. publishToPlatform consults it immediately after the capability check —
 * BEFORE the social account, token read/decrypt and OAuth refresh — so the
 * real adapters and token refresh are unreachable while it is active.
 *
 * Activation requires ALL of (evaluated once, memoized):
 *   CERT_ENV=1 and CERT_FAKE_PUBLISHER=1; NODE_ENV !== 'production'; no
 *   Railway/Vercel deployment marker; OMNIVYRA_ALLOW_SHARED_QUEUES unset;
 *   no production marker in any connection variable; and every set connection
 *   target (SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_POOLER_URL,
 *   SUPABASE_POOLER_DB_URL, DATABASE_URL, REDIS_URL) on a loopback host.
 * CERT_FAKE_PUBLISHER unset → inert (null), the production path is unchanged.
 * CERT_FAKE_PUBLISHER set but any condition failing → THROWS (fail closed): the
 * caller's catch reports `delivery: 'not_sent'` and no adapter is reached.
 *
 * Outcomes are chosen per post by a tag in its content (synthetic posts only):
 *   [cert-fake:reject]    confirmed rejection, nothing created ('not_created')
 *   [cert-fake:ambiguous] provider 5xx after the call left ('ambiguous')
 *   [cert-fake:throw]     the adapter throws after dispatch ('ambiguous')
 *   [cert-fake:no-id]     success without a platform id ('ambiguous')
 *   (none)                success with id cert_fake_<postId> ('published')
 */
import type { PublishResult } from './platformAdapterTypes';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const TARGET_VARS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_POOLER_URL', 'SUPABASE_POOLER_DB_URL', 'DATABASE_URL', 'REDIS_URL'];
/** Kept in sync with scripts/lib/certAwareEnv.cjs PROD_MARKERS (asserted by test). */
export const CERT_FAKE_PROD_MARKERS = ['klkiseupptzbecbxwrky', 'aws-1-ap-southeast-1.pooler.supabase', 'noble-dane-77325.upstash.io'];
const DEPLOYMENT_MARKERS = ['RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID', 'RAILWAY_SERVICE_ID', 'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_GIT_COMMIT_SHA', 'VERCEL', 'VERCEL_ENV'];

type Env = Record<string, string | undefined>;

/** Reasons the fake may NOT activate in this environment (empty → safe). Never includes values. */
export function certFakePublisherRefusals(env: Env = process.env): string[] {
  const out: string[] = [];
  if (env.CERT_ENV !== '1') out.push('CERT_ENV is not 1');
  if (env.NODE_ENV === 'production') out.push('NODE_ENV is production');
  for (const k of DEPLOYMENT_MARKERS) if (typeof env[k] === 'string' && env[k]!.trim() !== '') out.push(`deployment marker ${k} is set`);
  if (/^(1|true|yes)$/i.test(String(env.OMNIVYRA_ALLOW_SHARED_QUEUES ?? ''))) out.push('OMNIVYRA_ALLOW_SHARED_QUEUES is set');
  for (const k of TARGET_VARS) {
    const v = env[k];
    if (typeof v !== 'string' || !v.trim()) continue;
    if (CERT_FAKE_PROD_MARKERS.some((m) => v.includes(m))) { out.push(`${k} carries a production marker`); continue; }
    const m = v.match(/[a-z][a-z0-9+.-]*:\/\/\S+/i);
    let host: string | null = null;
    try { host = m ? new URL(m[0]).hostname.toLowerCase() : null; } catch { host = null; }
    if (!host || !LOOPBACK.has(host)) out.push(`${k} is not a loopback target`);
  }
  if (!env.REDIS_URL) out.push('REDIS_URL is not set (the worker must point at a dedicated loopback Redis)');
  return out;
}

export interface CertFakePublisher {
  publish(post: { id: string; content?: string | null }): Promise<PublishResult>;
}

export type CertFakeCall = { scheduledPostId: string; outcome: string; at: string };
const calls: CertFakeCall[] = [];
/** Calls made in this process (tests and the cert launcher assert on it). */
export function certFakePublisherCalls(): ReadonlyArray<CertFakeCall> { return calls; }

function outcomeFor(content: string | null | undefined): string {
  const m = /\[cert-fake:(reject|ambiguous|throw|no-id)\]/.exec(String(content ?? ''));
  return m ? m[1] : 'success';
}

const FAKE: CertFakePublisher = {
  async publish(post) {
    const outcome = outcomeFor(post.content);
    calls.push({ scheduledPostId: post.id, outcome, at: new Date().toISOString() });
    switch (outcome) {
      case 'reject':
        return { success: false, error: { code: 'CERT_FAKE_REJECTED', message: 'cert fake: rejected before creation', retryable: false, delivery: 'not_sent' } };
      case 'ambiguous':
        return { success: false, error: { code: 'CERT_FAKE_PROVIDER_5XX', message: 'cert fake: provider 503 after the call left', retryable: true } };
      case 'throw':
        throw new Error('cert fake: adapter threw after dispatch');
      case 'no-id':
        return { success: true };
      default:
        return { success: true, platform_post_id: `cert_fake_${post.id}`, published_at: new Date() };
    }
  },
};

let memo: { publisher: CertFakePublisher | null } | null = null;

/**
 * null when CERT_FAKE_PUBLISHER is not set (production path unchanged); the
 * fake when every isolation condition holds; THROWS when the flag is set in an
 * environment that is not provably certification-only.
 */
export function resolveCertFakePublisher(env: Env = process.env): CertFakePublisher | null {
  if (memo) return memo.publisher;
  if (env.CERT_FAKE_PUBLISHER !== '1') { memo = { publisher: null }; return null; }
  const refusals = certFakePublisherRefusals(env);
  if (refusals.length) {
    // Not memoized as success; every call refuses again (fail closed).
    throw new Error(`CERT_FAKE_PUBLISHER_REFUSED: ${refusals.join('; ')}`);
  }
  memo = { publisher: FAKE };
  return FAKE;
}

export function __resetCertFakePublisherForTest(): void {
  memo = null;
  calls.length = 0;
}
