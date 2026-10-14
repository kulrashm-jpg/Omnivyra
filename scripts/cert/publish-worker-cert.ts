/**
 * Closure-014 (G) — certification-only publish worker launcher.
 *
 * Starts EXACTLY ONE BullMQ consumer: queue 'publish' with the real
 * processPublishJob, behind the cert fake provider. It never imports
 * backend/workers/main, backend/queue/startWorkers or backend/scheduler/cron,
 * so no cron, OAuth refresh, intelligence/engagement polling, shared consumers
 * or the publishing_jobs loop can start.
 *
 * Usage (certification stack only):
 *   ENV_FILE=.env.cert CERT_FAKE_PUBLISHER=1 node scripts/cert/publish-worker-cert.cjs [--check]
 * (also `npm run cert:publish-worker -- --check`). The .cjs runner loads this
 * file through ts-node in CommonJS mode (the repository's established form, as
 * `audit:blog-matrix`). Closure-014A: plain
 * `npx ts-node …` does NOT work here — the root tsconfig emits ES modules, so
 * the dynamic imports below resolve as native ESM and fail (closed) for lack
 * of a file extension.
 * `--check` performs every guard and prints the plan, then exits without
 * constructing a Worker.
 *
 * Refuses (exit 1) unless: the cert env loader's loopback allow-list passes,
 * the egress guard is installed, the fake provider resolves, the queue prefix
 * is not `bull`, and Redis names a dedicated non-zero database.
 */
/* eslint-disable no-console */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadCertAwareEnv } = require('../lib/certAwareEnv.cjs');

async function main(): Promise<void> {
  process.env.CERT_ENV = '1';
  loadCertAwareEnv(process.cwd()); // exits non-zero on any non-loopback / production target

  const { installLoopbackEgressGuard } = await import('../../backend/cert/loopbackEgressGuard');
  const refusedEgress = installLoopbackEgressGuard();

  const { resolveCertFakePublisher } = await import('../../backend/adapters/certFakePublisher');
  const { certPublishWorkerRefusals } = await import('../../backend/cert/certPublishWorkerPlan');
  const { resolveQueueNamespace, assertQueueConsumerRuntimeAllowed } = await import('../../backend/queue/queueNamespace');

  const ns = resolveQueueNamespace(process.env);
  const refusals = certPublishWorkerRefusals(process.env, ns.prefix);
  if (refusals.length) {
    console.error('[cert-publish-worker] REFUSING:\n  ' + refusals.join('\n  '));
    process.exit(1);
  }
  if (!resolveCertFakePublisher()) {
    console.error('[cert-publish-worker] REFUSING: the cert fake provider did not activate');
    process.exit(1);
  }
  assertQueueConsumerRuntimeAllowed('cert-publish-worker');

  console.log(`[cert-publish-worker] plan: queue=publish prefix=${ns.prefix} consumers=1 provider=cert-fake egress=loopback-only`);
  if (process.argv.includes('--check')) { console.log('[cert-publish-worker] --check OK; no worker started'); return; }

  const { getWorker } = await import('../../backend/queue/bullmqClient');
  const { processPublishJob } = await import('../../backend/queue/jobProcessors/publishProcessor');
  const worker = getWorker('publish', processPublishJob, { concurrency: 1 });
  console.log('[cert-publish-worker] publish consumer started');

  const stop = async (signal: string) => {
    console.log(`[cert-publish-worker] ${signal}: closing; refused egress attempts: ${refusedEgress().length}`);
    await worker.close();
    process.exit(0);
  };
  process.on('SIGINT', () => { void stop('SIGINT'); });
  process.on('SIGTERM', () => { void stop('SIGTERM'); });
}

main().catch((err) => {
  console.error('[cert-publish-worker] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
