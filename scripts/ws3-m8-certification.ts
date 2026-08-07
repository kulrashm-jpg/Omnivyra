/**
 * WS-3 Milestone-8 — final production certification & execution proof.
 *
 * Runs the whole WS-3 runtime against real infrastructure and reports what it
 * observed. Nothing here is estimated; every number printed was measured on
 * this run.
 *
 * PRODUCTION BASELINES DO NOT EXIST. WS-3 is undeployed and production holds
 * zero outreach tasks, so these are STRUCTURAL measurements against a local
 * certification instance — real PostgreSQL, real PostgREST, real Redis, real
 * telemetry registry, stubbed provider port only. They characterise the
 * runtime's behaviour and shape; they are not production numbers.
 *
 *   npx tsx scripts/ws3-m8-certification.ts [proof...]
 */
/* eslint-disable no-console */

import { assertCertenv } from './ws3-m8/harness';

assertCertenv();

async function main(): Promise<void> {
  const { CERTENV_URL, closeSql, section, stubProvider, summarise } = await import('./ws3-m8/harness');
  const runtime = await import('../backend/services/leadOutreachExecution');

  console.log(`\n${'='.repeat(74)}`);
  console.log('  WS-3 MILESTONE-8 — PRODUCTION CERTIFICATION & EXECUTION PROOF');
  console.log(`  target: ${CERTENV_URL}   node ${process.version}   pid ${process.pid}`);
  console.log(`${'='.repeat(74)}`);

  // Email must be explicitly enabled for the external path to run at all; the
  // flag being OFF by default is itself asserted in the safety matrix.
  process.env[runtime.EMAIL_ENABLED_ENV] = 'true';
  runtime.__clearTransportsForTests();
  runtime.registerDefaultTransports({ emailProvider: stubProvider });

  const pipeline = await import('./ws3-m8/pipeline');
  const resilience = await import('./ws3-m8/resilience');
  const infra = await import('./ws3-m8/infrastructure');
  const observability = await import('./ws3-m8/observability');

  const proofs: Record<string, () => Promise<void>> = {
    e2e: pipeline.proofEndToEnd,
    dispatch: pipeline.proofConcurrentDispatch,
    feedback: pipeline.proofConcurrentFeedback,
    idempotency: pipeline.proofIdempotencyLayers,
    determinism: pipeline.proofDeterminism,
    safety: resilience.proofOperationalSafety,
    database: infra.proofDatabase,
    redis: infra.proofRedis,
    taxonomy: infra.proofFailureTaxonomy,
    telemetry: observability.proofTelemetry,
    health: observability.proofHealth,
    operations: observability.proofOperations,
    performance: observability.proofPerformance,
  };

  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const selected = requested.length ? requested : Object.keys(proofs);

  for (const name of selected) {
    const fn = proofs[name];
    if (!fn) { console.error(`unknown proof: ${name}`); continue; }
    try {
      await fn();
    } catch (e) {
      section(`PROOF ${name} — UNCAUGHT`);
      console.error(e);
      process.exitCode = 1;
    }
  }

  const failures = summarise();
  await closeSql();
  process.exit(failures === 0 && !process.exitCode ? 0 : 1);
}

main().catch((e) => { console.error('\nFATAL', e); process.exit(1); });
