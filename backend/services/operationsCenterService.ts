/**
 * operationsCenterService.ts — read-only Production Operations Center snapshot.
 *
 * POP surface completion: aggregates repository-owned operational state that was
 * previously env-only or scattered across the codebase into a single read-only
 * view for Super Admin:
 *   - rollout flags (incl. canonical-grounding) + resolved mode/source/kill,
 *   - deployment/version fingerprint (same source as /api/health/version),
 *   - verified runtime / queue / cron topology + single-points-of-failure.
 *
 * Pure + read-only. Does NOT change any runtime behaviour, flag, or business
 * logic. It only READS the rollout registry, the boot fingerprint, and the
 * committed vercel.json / railway.json topology.
 */
import { listRolloutFlags, resolveRolloutSync } from '../../lib/platform/rollout';
import { emitBootFingerprint } from '../security/startup/bootFingerprint';
import { supabase } from '../db/supabaseClient';
import vercelConfig from '../../vercel.json';
import railwayConfig from '../../railway.json';

export interface RolloutFlagView {
  key: string;
  description: string;
  envPrefix: string;
  mode: string;
  source: string;
  killed: boolean;
}

export interface OperationsCenterSnapshot {
  version: {
    fingerprint: string;
    build: string | null;
    environment: string;
    nodeVersion: string;
    nodeEnv: string;
    authContractVersion: string;
    schemaManifestHash: string | null;
  };
  rolloutFlags: RolloutFlagView[];
  topology: {
    app: { host: string; deploy: string };
    worker: { host: string; entry: string; replicas: number | null; restartPolicy: string | null; deploy: string };
    queues: string[];
    workers: string[];
    vercelCrons: { path: string; schedule: string }[];
    workerCronCoLocated: boolean;
    redis: string;
    db: string;
  };
  singlePointsOfFailure: string[];
  note: string;
}

// ── AI Runtime operational view ────────────────────────────────────────────
// Pure rollup of EXISTING runtime signals (HARDEN-001 recordAi series + LLM pool
// pressure + provider-key presence). Fabricates nothing; unavailable signals are
// listed in `missingSignals`. Does NOT change execution/billing/retry/routing.
export interface AiProviderRollup {
  provider: string; calls: number; errors: number; errorRate: number;
  retries: number; tokensIn: number; tokensOut: number; slow: number; avgDurationMs: number | null;
}
export interface AiRuntimeView {
  healthy: boolean;
  configuredProviders: { provider: string; keyPresent: boolean }[];
  defaultModel: string | null;
  pools: { pool: string; activeCalls: number; pendingAcquires: number; maxAllowed: number; recentAvgWaitMs: number } | null;
  totals: { calls: number; errors: number; errorRate: number; retries: number; tokensIn: number; tokensOut: number; slow: number };
  byProvider: AiProviderRollup[];
  slowTop: { providerModel: string; ms: number }[];
  missingSignals: string[];
  note: string;
}

type CounterEntry = { name: string; labels?: Record<string, unknown>; value: number };
type HistogramEntry = { name: string; labels?: Record<string, unknown>; count: number; sum: number };

export function summarizeAiRuntime(input: {
  counters: CounterEntry[];
  histograms: HistogramEntry[];
  slowAi: { providerModel: string; ms: number }[];
  pools: AiRuntimeView['pools'];
  providerEnv: { provider: string; keyPresent: boolean }[];
  defaultModel: string | null;
}): AiRuntimeView {
  const acc = new Map<string, AiProviderRollup>();
  const get = (p: string): AiProviderRollup => {
    let e = acc.get(p);
    if (!e) { e = { provider: p, calls: 0, errors: 0, errorRate: 0, retries: 0, tokensIn: 0, tokensOut: 0, slow: 0, avgDurationMs: null }; acc.set(p, e); }
    return e;
  };
  const FIELD: Record<string, keyof AiProviderRollup> = {
    'ai.provider.count': 'calls', 'ai.provider.errors': 'errors', 'ai.provider.retries': 'retries',
    'ai.provider.tokens_in': 'tokensIn', 'ai.provider.tokens_out': 'tokensOut', 'ai.provider.slow': 'slow',
  };
  for (const c of input.counters) {
    const p = String(c.labels?.provider ?? '');
    const field = FIELD[c.name];
    if (!p || !field) continue;
    (get(p)[field] as number) += c.value;
  }
  const dur = new Map<string, { sum: number; count: number }>();
  for (const h of input.histograms) {
    if (h.name !== 'ai.provider.duration_ms') continue;
    const p = String(h.labels?.provider ?? '');
    if (!p) continue;
    const d = dur.get(p) ?? { sum: 0, count: 0 };
    d.sum += h.sum; d.count += h.count; dur.set(p, d);
  }
  const byProvider = [...acc.values()].map((e) => {
    const d = dur.get(e.provider);
    return { ...e, errorRate: e.calls ? e.errors / e.calls : 0, avgDurationMs: d && d.count ? Math.round(d.sum / d.count) : null };
  }).sort((a, b) => b.calls - a.calls);

  const totals = byProvider.reduce(
    (t, e) => ({ calls: t.calls + e.calls, errors: t.errors + e.errors, retries: t.retries + e.retries, tokensIn: t.tokensIn + e.tokensIn, tokensOut: t.tokensOut + e.tokensOut, slow: t.slow + e.slow }),
    { calls: 0, errors: 0, retries: 0, tokensIn: 0, tokensOut: 0, slow: 0 },
  );
  const errorRate = totals.calls ? totals.errors / totals.calls : 0;
  const pending = input.pools?.pendingAcquires ?? 0;
  const healthy = totals.calls === 0 ? true : (errorRate < 0.25 && pending === 0);

  return {
    healthy,
    configuredProviders: input.providerEnv,
    defaultModel: input.defaultModel,
    pools: input.pools,
    totals: { ...totals, errorRate },
    byProvider,
    slowTop: (input.slowAi ?? []).slice(0, 5),
    missingSignals: [
      'circuit-breaker state (gateway does not expose a readable getter)',
      'last-successful-execution timestamp (not tracked)',
      'per-provider availability health-check (not tracked)',
    ],
    note: 'AI signals are per-instance (this app instance’s registry). Metrics accumulate since boot; ai-heavy queue backlog is under Queues → Queue Metrics.',
  };
}

// ── Email Runtime operational view ─────────────────────────────────────────
// Read-only aggregation of the EXISTING email_jobs queue table (statuses
// pending/sent/failed). Reads counts + timestamps only — never recipients,
// content, or payload. Does NOT change email/queue/retry/delivery/templates.
export interface EmailRuntimeView {
  available: boolean;
  provider: string;
  counts: { pending: number; sent: number; failed: number };
  backlog: number;
  failureRate: number;
  lastSuccessfulSendAt: string | null;
  mostRecentFailureAt: string | null;
  healthy: boolean;
  missingSignals: string[];
  note: string;
  error?: string;
}

const EMAIL_MISSING = [
  'provider availability / SES health (configured in the send-transactional-email edge function; not app-checkable)',
  'delivery latency + throughput (not recorded as metrics)',
  'worker/cron last-run status (not tracked)',
  'bounce / complaint / dead-letter (not modeled in email_jobs)',
];

/** Pure health rollup from email_jobs status counts. */
export function summarizeEmailRuntime(input: {
  counts: { pending: number; sent: number; failed: number };
  lastSuccessfulSendAt: string | null;
  mostRecentFailureAt: string | null;
  backlogThreshold?: number;
}): EmailRuntimeView {
  const { pending, sent, failed } = input.counts;
  const backlog = pending;
  const denom = sent + failed;
  const failureRate = denom ? failed / denom : 0;
  const threshold = input.backlogThreshold ?? 250;
  const healthy = backlog < threshold && failureRate < 0.25;
  return {
    available: true,
    provider: 'AWS SES (via send-transactional-email edge function)',
    counts: { pending, sent, failed },
    backlog,
    failureRate,
    lastSuccessfulSendAt: input.lastSuccessfulSendAt,
    mostRecentFailureAt: input.mostRecentFailureAt,
    healthy,
    missingSignals: EMAIL_MISSING,
    note: 'Counts are from the email_jobs queue (pending = backlog). No recipient, content, or payload is read.',
  };
}

/** Query the email_jobs queue for a read-only operational view. Best-effort. */
export async function getEmailRuntimeView(): Promise<EmailRuntimeView> {
  try {
    const count = async (status: string): Promise<number> => {
      const { count: c } = await supabase.from('email_jobs').select('*', { count: 'exact', head: true }).eq('status', status);
      return c ?? 0;
    };
    const [pending, sent, failed] = await Promise.all([count('pending'), count('sent'), count('failed')]);
    const { data: ls } = await supabase.from('email_jobs').select('sent_at').eq('status', 'sent').order('sent_at', { ascending: false }).limit(1);
    const { data: lf } = await supabase.from('email_jobs').select('updated_at').eq('status', 'failed').order('updated_at', { ascending: false }).limit(1);
    return summarizeEmailRuntime({
      counts: { pending, sent, failed },
      lastSuccessfulSendAt: (ls?.[0] as { sent_at?: string } | undefined)?.sent_at ?? null,
      mostRecentFailureAt: (lf?.[0] as { updated_at?: string } | undefined)?.updated_at ?? null,
    });
  } catch (e) {
    return {
      available: false,
      provider: 'AWS SES (via send-transactional-email edge function)',
      counts: { pending: 0, sent: 0, failed: 0 },
      backlog: 0, failureRate: 0, lastSuccessfulSendAt: null, mostRecentFailureAt: null,
      healthy: false,
      missingSignals: ['email_jobs queue could not be read', ...EMAIL_MISSING],
      note: 'Email queue state unavailable.',
      error: e instanceof Error ? e.message : 'query failed',
    };
  }
}

// ── Storage Runtime operational view ───────────────────────────────────────
// Read-only aggregation of EXISTING storage state: configured buckets (Supabase
// Storage), asset row counts (media_files / creator_assets), and a stuck-upload
// proxy (daily_content_plans awaiting_media_upload — the janitor's target). Reads
// counts only — never object paths, contents, or signed URLs. Does NOT change
// uploads/downloads/buckets/permissions.
export interface StorageRuntimeView {
  available: boolean;
  provider: string;
  connectivityConfigured: boolean;
  buckets: string[];
  counts: { mediaFiles: number; creatorAssets: number; awaitingUpload: number };
  healthy: boolean;
  missingSignals: string[];
  note: string;
  error?: string;
}

// Documented buckets (scripts/operator/sql/setup-storage-buckets.sql + mediaService).
const STORAGE_BUCKETS = ['media-uploads', 'media-images', 'media-videos', 'media-audios', 'media-documents'];
const STORAGE_MISSING = [
  'upload success / failure rate (not recorded as metrics)',
  'signed-URL generation status (not tracked)',
  'storage bytes / quota (Supabase-managed; not app-readable)',
  'cleanup janitor last-run + deleted-count history (report returned to cron, not persisted queryably)',
  'live storage connectivity (would require a live storage call; only env-configuration is repo-visible)',
];

/** Pure health rollup from storage counts. */
export function summarizeStorageRuntime(input: {
  connectivityConfigured: boolean;
  buckets: string[];
  counts: { mediaFiles: number; creatorAssets: number; awaitingUpload: number };
  awaitingThreshold?: number;
}): StorageRuntimeView {
  const threshold = input.awaitingThreshold ?? 100;
  const healthy = input.connectivityConfigured && input.counts.awaitingUpload < threshold;
  return {
    available: true,
    provider: 'Supabase Storage',
    connectivityConfigured: input.connectivityConfigured,
    buckets: input.buckets,
    counts: input.counts,
    healthy,
    missingSignals: STORAGE_MISSING,
    note: 'Counts from media_files / creator_assets; awaitingUpload = daily_content_plans in awaiting_media_upload (stuck-upload proxy). No object paths, contents, or signed URLs are read.',
  };
}

/** Query storage-related tables for a read-only operational view. Best-effort. */
export async function getStorageRuntimeView(): Promise<StorageRuntimeView> {
  const safeCount = async (fn: () => Promise<number>): Promise<number> => {
    try { return await fn(); } catch { return 0; }
  };
  try {
    const countTable = (table: string) => safeCount(async () => {
      const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
      return count ?? 0;
    });
    const [mediaFiles, creatorAssets, awaitingUpload] = await Promise.all([
      countTable('media_files'),
      countTable('creator_assets'),
      safeCount(async () => {
        const { count } = await supabase.from('daily_content_plans').select('*', { count: 'exact', head: true }).eq('content_status', 'awaiting_media_upload');
        return count ?? 0;
      }),
    ]);
    return summarizeStorageRuntime({
      connectivityConfigured: !!process.env.SUPABASE_URL,
      buckets: STORAGE_BUCKETS,
      counts: { mediaFiles, creatorAssets, awaitingUpload },
    });
  } catch (e) {
    return {
      available: false,
      provider: 'Supabase Storage',
      connectivityConfigured: !!process.env.SUPABASE_URL,
      buckets: STORAGE_BUCKETS,
      counts: { mediaFiles: 0, creatorAssets: 0, awaitingUpload: 0 },
      healthy: false,
      missingSignals: ['storage counts could not be read', ...STORAGE_MISSING],
      note: 'Storage state unavailable.',
      error: e instanceof Error ? e.message : 'query failed',
    };
  }
}

// ── Website Intelligence Runtime operational view ──────────────────────────
// Read-only aggregation of EXISTING website-intelligence state: tracked websites,
// health scores, signals, alerts + the documented deterministic engines. Reads
// counts only — never domains, URLs, crawl contents, or signal payloads. Does NOT
// change crawling / refresh / extraction / scheduling.
export interface WebsiteIntelligenceRuntimeView {
  available: boolean;
  counts: { websitesTracked: number; websitesActive: number; healthScores: number; signals: number; alerts: number };
  engines: string[];
  healthy: boolean;
  missingSignals: string[];
  note: string;
  error?: string;
}

const WI_ENGINES = ['accessibility', 'brand', 'businessImpact', 'content', 'technical'];
const WI_MISSING = [
  'crawl freshness / last-crawled timestamps (per-website; not a platform rollup)',
  'crawl & refresh success/failure rate + latency (event-logged per service; not aggregated)',
  'crawl / refresh backlog + worker participation (policy-driven scheduler; no backlog table)',
  'retry counts (not aggregated)',
  'per-engine extraction success (engines run inline; not tracked as metrics)',
];

/** Pure health rollup from website-intelligence counts. */
export function summarizeWebsiteIntelligenceRuntime(input: {
  counts: { websitesTracked: number; websitesActive: number; healthScores: number; signals: number; alerts: number };
  engines: string[];
}): WebsiteIntelligenceRuntimeView {
  const healthy = input.counts.websitesTracked > 0; // tracking is live
  return {
    available: true,
    counts: input.counts,
    engines: input.engines,
    healthy,
    missingSignals: WI_MISSING,
    note: 'Counts from websites / website_health_scores / website_intelligence_signals / website_intelligence_alerts. Alerts is a total (open+resolved). No domains, URLs, or crawl contents are read.',
  };
}

/** Query website-intelligence tables for a read-only operational view. Best-effort. */
export async function getWebsiteIntelligenceRuntimeView(): Promise<WebsiteIntelligenceRuntimeView> {
  const safe = async (fn: () => Promise<number>): Promise<number> => { try { return await fn(); } catch { return 0; } };
  const countTable = (table: string) => safe(async () => {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    return count ?? 0;
  });
  try {
    const [websitesTracked, websitesActive, healthScores, signals, alerts] = await Promise.all([
      safe(async () => { const { count } = await supabase.from('websites').select('*', { count: 'exact', head: true }).is('deleted_at', null); return count ?? 0; }),
      safe(async () => { const { count } = await supabase.from('websites').select('*', { count: 'exact', head: true }).eq('status', 'active').is('deleted_at', null); return count ?? 0; }),
      countTable('website_health_scores'),
      countTable('website_intelligence_signals'),
      countTable('website_intelligence_alerts'),
    ]);
    return summarizeWebsiteIntelligenceRuntime({ counts: { websitesTracked, websitesActive, healthScores, signals, alerts }, engines: WI_ENGINES });
  } catch (e) {
    return {
      available: false,
      counts: { websitesTracked: 0, websitesActive: 0, healthScores: 0, signals: 0, alerts: 0 },
      engines: WI_ENGINES,
      healthy: false,
      missingSignals: ['website-intelligence counts could not be read', ...WI_MISSING],
      note: 'Website intelligence state unavailable.',
      error: e instanceof Error ? e.message : 'query failed',
    };
  }
}

// Verified runtime topology (POP-A2). Documented constants — BullMQ queue/worker
// names are not enumerable without instantiating, so they are maintained here.
const BULLMQ_QUEUES = ['publish/posting', 'bolt-execution', 'ai-heavy', 'engagement-polling', 'lead-thread-recompute', 'conversation-memory-rebuild'];
const WORKERS = ['publish', 'bolt-execution', 'engagement-polling', 'intelligence-polling', 'creator-render', 'lead-thread-recompute', 'conversation-memory-rebuild', 'engine', 'campaign'];

export function getOperationsCenterSnapshot(): OperationsCenterSnapshot {
  const fp = emitBootFingerprint();

  const rolloutFlags: RolloutFlagView[] = listRolloutFlags()
    .map((f) => {
      let mode = 'unknown';
      let source = 'unknown';
      try {
        const d = resolveRolloutSync(f, {});
        mode = d.mode;
        source = d.source;
      } catch { /* fail-safe: never throw from a read-only snapshot */ }
      return { key: f.key, description: f.description, envPrefix: f.envPrefix, mode, source, killed: source.endsWith('-kill') };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const deploy = (railwayConfig as { deploy?: { numReplicas?: number; restartPolicyType?: string } }).deploy ?? {};
  const crons = ((vercelConfig as { crons?: { path: string; schedule: string }[] }).crons ?? []).map((c) => ({ path: c.path, schedule: c.schedule }));

  return {
    version: {
      fingerprint: fp.fingerprint,
      build: fp.deploymentId,
      environment: fp.vercelEnv ?? fp.railwayEnv ?? fp.nodeEnv,
      nodeVersion: fp.nodeVersion,
      nodeEnv: fp.nodeEnv,
      authContractVersion: fp.authContractVersion,
      schemaManifestHash: fp.schemaManifestHash,
    },
    rolloutFlags,
    topology: {
      app: { host: 'www.omnivyra.com', deploy: 'Vercel (manual; git.deploymentEnabled=false)' },
      worker: {
        host: 'Railway authentic-nature/Omnivyra',
        entry: 'dist/backend/workers/main.js',
        replicas: deploy.numReplicas ?? null,
        restartPolicy: deploy.restartPolicyType ?? null,
        deploy: 'Railway (auto-deploys main)',
      },
      queues: BULLMQ_QUEUES,
      workers: WORKERS,
      vercelCrons: crons,
      workerCronCoLocated: true,
      redis: 'Upstash (single instance) — BullMQ + F-12 cache + locks/semaphores',
      db: 'Supabase Postgres (single project) + Auth + Storage',
    },
    singlePointsOfFailure: [
      `Worker: ${deploy.numReplicas ?? 1} replica — all queues + co-located cron on one instance`,
      'Redis: single Upstash instance (queues/locks not fail-open; F-12 cache is fail-open)',
      'Supabase: single Postgres project (all persistent state)',
      'Deploy skew: Vercel manual vs Railway auto → the two surfaces can run different commits',
    ],
    note: 'Read-only snapshot. Rollout modes reflect this instance’s env resolution; metrics are per-instance (not cross-instance aggregated).',
  };
}
