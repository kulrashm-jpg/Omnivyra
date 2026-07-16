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
