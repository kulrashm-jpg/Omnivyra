#!/usr/bin/env node
/**
 * Queue-topology mutation battery.
 *
 * Each entry reintroduces one way the generic content consumer could again end
 * up on a queue it does not own, or process a job it must refuse. A mutation is
 * KILLED only when the suite runs and at least one test FAILS; a suite that
 * cannot start is reported separately (it proves nothing about behaviour).
 * A SURVIVOR means the tests do not constrain that behaviour — strengthen the
 * TEST, never weaken the mutation.
 *
 * M1 is the reproduction proof: it restores the exact loop that was on main
 * (every CONTENT_QUEUE_CONFIG entry gets the generic consumer).
 *
 * The unmutated suite must pass first (green-baseline gate); otherwise every
 * mutant would read as "killed". Every mutation is applied, run, and reverted
 * even if the run throws.
 *
 * Needs the hermetic test env (CI=true plus placeholder credentials — see
 * .github/workflows/campaign-generation-contracts.yml).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const JEST = path.join('node_modules', 'jest', 'bin', 'jest.js');
const SUITE = [
  'backend/tests/unit/workerTopologyConsumers.test.ts',
  'backend/tests/unit/contentGenerationTopologyGuard.test.ts',
  'backend/tests/unit/workerTopologyGenericConfig.test.ts',
  'backend/tests/unit/workerTopologyParity.test.ts',
  'backend/tests/unit/creatorWorkerBootstrapParity.test.ts',
];
const QUEUES = 'backend/queue/contentGenerationQueues.ts';
const MANIFEST = 'backend/queue/workerTopologyManifest.ts';
const TOPOLOGY = 'backend/queue/workerTopology.ts';
const GUARD = 'backend/queue/jobProcessors/genericContentJobGuard.ts';
const PROCESSOR = 'backend/queue/jobProcessors/contentGenerationProcessor.ts';
const ENGINE = 'backend/services/unifiedContentGenerationEngine.ts';

const MUTATIONS = [
  {
    id: 'M1',
    name: 'restore the original loop over every CONTENT_QUEUE_CONFIG entry (the production defect)',
    file: QUEUES,
    from: '  const queueNames = genericContentQueueNames();',
    to: '  const queueNames = Object.keys(CONTENT_QUEUE_CONFIG);',
  },
  {
    id: 'M2',
    name: 'the generic allowlist becomes every shared queue',
    file: MANIFEST,
    from: "  return queuesOwnedBy('generic-content');",
    to: '  return sharedConsumedQueues().map((q) => q.queue);',
  },
  {
    id: 'M3',
    name: 'analytics-ingestion is (mis)assigned to the generic family',
    file: MANIFEST,
    from: "consumedVia: 'shared', status: 'OK', consumer: 'analytics-ingestion'",
    to: "consumedVia: 'shared', status: 'OK', consumer: 'generic-content'",
  },
  {
    id: 'M4',
    name: 'creator-video is (mis)assigned to the generic family',
    file: MANIFEST,
    from: "{ queue: 'creator-video', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', consumer: 'creator-content' }",
    to: "{ queue: 'creator-video', enqueuedBy: 'boltCreatorQueueBridge', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', consumer: 'generic-content' }",
  },
  {
    id: 'M5',
    name: 'content-refinement loses its generic owner (a generic queue left without a consumer)',
    file: MANIFEST,
    from: "{ queue: 'content-refinement', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', consumer: 'generic-content'",
    to: "{ queue: 'content-refinement', enqueuedBy: 'contentGenerationQueues CONTENT_TYPE map', prodConsumed: true, devConsumed: true, consumedVia: 'shared', status: 'OK', consumer: 'planner-refinement'",
  },
  {
    id: 'M6',
    name: 'a generic queue without config no longer stops registration',
    file: QUEUES,
    from: '  if (unconfigured.length > 0) {',
    to: '  if (unconfigured.length < 0) {',
  },
  {
    id: 'M7',
    name: 'the guard stops checking the queue at all',
    file: GUARD,
    from: "  if (typeof job.queueName !== 'string' || !genericQueues.includes(job.queueName)) {",
    to: '  if (false) {',
  },
  {
    id: 'M8',
    name: 'the guard lets a job with no queue name through',
    file: GUARD,
    from: "  if (typeof job.queueName !== 'string' || !genericQueues.includes(job.queueName)) {",
    to: "  if (typeof job.queueName === 'string' && !genericQueues.includes(job.queueName)) {",
  },
  {
    id: 'M9',
    name: 'the guard stops refusing creator-row (bolt_payload) jobs',
    file: GUARD,
    from: "  if ('bolt_payload' in payload) {",
    to: "  if ('bolt_payload_disabled' in payload) {",
  },
  {
    id: 'M10',
    name: 'the guard stops requiring a company id',
    file: GUARD,
    from: "  if (typeof payload.company_id !== 'string' || payload.company_id.length === 0) {",
    to: '  if (false) {',
  },
  {
    id: 'M11',
    name: 'the guard accepts an empty company id',
    file: GUARD,
    from: "  if (typeof payload.company_id !== 'string' || payload.company_id.length === 0) {",
    to: "  if (typeof payload.company_id !== 'string') {",
  },
  {
    id: 'M12',
    name: 'the guard accepts a bulk payload without items',
    file: GUARD,
    from: '    if (!Array.isArray(payload.items)) {',
    to: '    if (false) {',
  },
  {
    id: 'M13',
    name: 'the guard accepts every content type',
    file: GUARD,
    from: "  if (typeof contentType === 'string' && (isLongFormContentType(contentType) || isSupportedContentType(contentType))) {",
    to: "  if (typeof contentType === 'string') {",
  },
  {
    id: 'M14',
    name: 'the guard accepts arrays and strings as payloads',
    file: GUARD,
    from: "  if (!data || typeof data !== 'object' || Array.isArray(data)) {",
    to: '  if (!data) {',
  },
  {
    id: 'M15',
    name: 'the guard rejects only long-form content types (drops the engine types)',
    file: GUARD,
    from: '(isLongFormContentType(contentType) || isSupportedContentType(contentType))',
    to: '(isLongFormContentType(contentType))',
  },
  {
    id: 'M16',
    name: 'the processor no longer calls the guard',
    file: PROCESSOR,
    from: '  assertGenericContentJob(job);\n',
    to: '\n',
  },
  {
    id: 'M17',
    name: 'the processor restores the old narrow longform-unified-only check',
    file: PROCESSOR,
    from: '  assertGenericContentJob(job);\n',
    to: "  if ((job as { queueName?: string }).queueName === 'longform-unified') assertGenericContentJob(job);\n",
  },
  {
    id: 'M18',
    name: 'the engine reports every string as a supported content type',
    file: ENGINE,
    from: "  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTENT_TYPE_CONFIG, value);",
    to: "  return typeof value === 'string';",
  },
  {
    id: 'M19',
    name: 'the engine type check follows the prototype chain (toString, constructor…)',
    file: ENGINE,
    from: "  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTENT_TYPE_CONFIG, value);",
    to: "  return typeof value === 'string' && value in CONTENT_TYPE_CONFIG;",
  },
  {
    id: 'M20',
    name: 'a dedicated creator queue loses its dedicated consumer',
    file: QUEUES,
    from: "  const creatorQueueNames = ['creator-video', 'creator-carousel', 'creator-story'];",
    to: "  const creatorQueueNames = ['creator-video', 'creator-carousel'];",
  },
  {
    id: 'M21',
    name: 'the analytics consumer is registered twice',
    file: TOPOLOGY,
    from: '    await startAnalyticsIngestionWorker(processAnalyticsIngestionJob);\n',
    to: '    await startAnalyticsIngestionWorker(processAnalyticsIngestionJob);\n    await startAnalyticsIngestionWorker(processAnalyticsIngestionJob);\n',
  },
  {
    id: 'M22',
    name: 'the whatsapp-webhook queue is wired to the broadcast processor',
    file: TOPOLOGY,
    from: '    await startWhatsAppWebhookWorker(processWhatsAppWebhookJob);',
    to: "    const { processWhatsAppBroadcastJob: processWhatsAppBroadcastJob2 } = await import('./jobProcessors/whatsappBroadcastProcessor');\n    await startWhatsAppWebhookWorker(processWhatsAppBroadcastJob2);",
  },
  {
    id: 'M23',
    name: 'bolt-content-jobs gains a consumer again (startBoltContentWorkers wired)',
    file: TOPOLOGY,
    from: "  await family('analytics-ingestion-worker',",
    to: "  await family('bolt-content-worker', 'x', async () => {\n    const { startBoltContentWorkers } = await import('./contentGenerationQueues');\n    await startBoltContentWorkers(async () => undefined);\n  });\n  await family('analytics-ingestion-worker',",
  },
];

function runSuite() {
  try {
    execFileSync(process.execPath, [JEST, ...SUITE, '--runInBand', '--forceExit', '--silent'], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { passed: true, detail: 'suite passed' };
  } catch (err) {
    const out = String(err.stdout || '') + String(err.stderr || '');
    const failedTests = out.match(/Tests:\s+(\d+) failed/);
    const failedSuites = out.match(/Test Suites:\s+(\d+) failed/);
    const suiteCrash = /Test suite failed to run/.test(out);
    if (failedTests) return { passed: false, behavioural: true, detail: `${failedTests[1]} test(s) failed` };
    return {
      passed: false,
      behavioural: false,
      detail: suiteCrash ? 'suite failed to RUN (not a behavioural kill)' : `suite failed (${failedSuites ? failedSuites[1] : '?'} suites)`,
    };
  }
}

const baseline = runSuite();
if (!baseline.passed) {
  console.error(`GREEN-BASELINE GATE FAILED — the unmutated suite does not pass (${baseline.detail}). Aborting.`);
  process.exit(2);
}
console.log('green baseline: unmutated suite passes');

const results = [];
for (const m of MUTATIONS) {
  const original = fs.readFileSync(m.file, 'utf8');
  if (!original.includes(m.from)) {
    results.push({ ...m, verdict: 'NOT APPLICABLE — anchor not found' });
    continue;
  }
  fs.writeFileSync(m.file, original.replace(m.from, m.to), 'utf8');
  let outcome;
  try {
    outcome = runSuite();
  } finally {
    fs.writeFileSync(m.file, original, 'utf8');
  }
  const verdict = outcome.passed
    ? `SURVIVED (${outcome.detail})`
    : outcome.behavioural
      ? `KILLED (${outcome.detail})`
      : `NOT BEHAVIOURAL (${outcome.detail})`;
  results.push({ ...m, verdict });
}

console.log('\n============ QUEUE-TOPOLOGY MUTATION RESULTS ============');
for (const r of results) {
  const tag = r.verdict.startsWith('KILLED') ? 'KILLED  ' : r.verdict.startsWith('SURVIVED') ? 'SURVIVED' : 'NOT-OK  ';
  console.log(`${r.id.padEnd(4)} ${tag} ${r.name}`);
  console.log(`      -> ${r.verdict}`);
}
const bad = results.filter((r) => !r.verdict.startsWith('KILLED'));
console.log(`\n${results.length - bad.length}/${results.length} killed behaviourally`);
process.exit(bad.length === 0 ? 0 : 1);
