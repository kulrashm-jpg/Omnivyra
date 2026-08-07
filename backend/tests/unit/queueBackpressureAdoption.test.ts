/**
 * WS1-E6-T002 — queue backpressure adoption gate.
 *
 * The incident class: `safeEnqueue` (backpressure + trace stamping) existed but
 * had TWO consumers, so every other producer could flood a queue without limit
 * and enqueued jobs carried no trace context.
 *
 * The migration is COMPLETE: `expectedMaxDirectAdds` is 0, so this started as
 * a monotonic ratchet (the scripts/check-bridge-cookie-usage.js idiom) and has
 * become a hard gate. A new direct `queue.add` now fails the build unless it is
 * added to EXEMPT with a documented reason.
 *
 * Exempt paths are NOT counted — see EXEMPT below. Backpressure sheds new
 * tenant work; applying it to a recovery path would destroy the thing being
 * recovered.
 *
 * No database, no network, no Redis.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['backend', 'pages', 'lib'];

/**
 * Direct-enqueue sites that must NEVER route through safeEnqueue.
 *
 *  1. Dead-letter republication — a full queue would silently DROP the dead
 *     letter, which is the only durable evidence the job failed.
 *  2. Operator requeue from the DLQ — an operator draining a backlog must not
 *     be blocked by that backlog.
 *  3. The helper itself.
 */
const EXEMPT = new Set([
  'backend/queue/leadQueueHardening.ts', // DLQ republish (WS1-E6-T001)
  'backend/services/creatorRenderDurableQueue.ts', // own DLQ + durable render queue
  'backend/services/jobInspection.ts', // operator requeue from DLQ
  'backend/middleware/queueBackpressure.ts', // the helper itself
]);

/**
 * Ratchet, now at ZERO: every non-exempt enqueue routes through the helper.
 * This is no longer a migration odometer — it is a hard gate. A new direct
 * `queue.add` fails the build unless it is added to EXEMPT with a reason.
 */
const expectedMaxDirectAdds = 0;

// `await` is required: every real BullMQ enqueue awaits, while Set/collection
// calls such as `depthQueues.add(queue)` in queueObservability.ts do not. That
// single anchor removes the Set false-positive class without an allowlist.
const ADD_RE = /await\s+(?:\w*[Qq]ueue\w*|q)\s*(?:\(\s*\))?\s*\.add\(/;

function walk(rel: string, out: string[] = []): string[] {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (['node_modules', 'tests', '__tests__', '.next'].includes(e.name)) continue;
      walk(child, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      out.push(child);
    }
  }
  return out;
}

/** Files containing at least one direct, non-exempt queue.add call. */
function directAddSites(): string[] {
  const hits: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(dir)) {
      if (EXEMPT.has(rel)) continue;
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
      for (const line of src.split('\n')) {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//')) continue; // doc/comment
        if (ADD_RE.test(line)) {
          hits.push(rel);
          break;
        }
      }
    }
  }
  return hits.sort();
}

describe('safeEnqueue contract', () => {
  const src = fs.readFileSync(
    path.join(REPO, 'backend/middleware/queueBackpressure.ts'),
    'utf8',
  );

  it('forwards the FULL JobsOptions to BullMQ', () => {
    // It previously whitelisted only jobId/delay/priority, so adopting it at a
    // site that set attempts/backoff/removeOnComplete would have silently
    // disabled that job's retry policy — including the lead enqueue whose
    // exhaustion semantics WS1-E6-T001 depends on.
    expect(src).toMatch(/opts\?:\s*JobsOptions\s*&/);
    expect(src).toMatch(/queue\.add\(jobName,\s*withTraceMeta\(payload\),\s*jobOptions\)/);
  });

  it('strips backpressure-only knobs before they reach BullMQ', () => {
    expect(src).toMatch(/const\s*\{\s*softLimit:[^}]*hardLimit:[^}]*\}\s*=\s*opts/);
  });

  it('still stamps trace context onto every enqueued payload', () => {
    expect(src).toMatch(/withTraceMeta\(payload\)/);
  });

  it('returns null rather than throwing when the queue is full', () => {
    expect(src).toMatch(/if\s*\(err instanceof QueueFullError\)\s*\{\s*return null/);
  });

  it('documents the exempt recovery paths', () => {
    expect(src).toMatch(/Exempt paths/);
  });
});

describe('direct queue.add ratchet', () => {
  it('never increases', () => {
    const sites = directAddSites();
    // Printed on failure so the offending file is named, not just a number.
    expect({ count: sites.length, sites }).toEqual({
      count: expect.any(Number),
      sites: expect.any(Array),
    });
    expect(sites.length).toBeLessThanOrEqual(expectedMaxDirectAdds);
  });

  it('converted call sites stay converted', () => {
    // Regression lock for the sites migrated by WS1-E6-T002. If any of these
    // reverts to a direct queue.add, backpressure AND trace stamping are lost
    // for that path.
    const converted = [
      'pages/api/leads/job/create.ts',
      'pages/api/market-pulse/job/create.ts',
      'pages/api/market-pulse/run.ts',
      'pages/api/bolt/execute.ts',
      'pages/api/whatsapp/webhook/index.ts',
      'pages/api/cron/analytics-ingestion.ts',
      'pages/api/cron/market-pulse-automation.ts',
      'backend/adapters/campaign/masterContentAdapter.ts',
      'backend/adapters/commandCenter/blogContentAdapter.ts',
      'backend/adapters/commandCenter/creatorContentAdapter.ts',
      'backend/adapters/engagement/responseAdapter.ts',
      'backend/queue/intelligencePollingQueue.ts',
      'backend/scheduler/cron.ts',
      'backend/scheduler/schedulerIntelligenceJobs.ts',
      'backend/scheduler/schedulerPostQueueControl.ts',
      'backend/scheduler/schedulerService.ts',
      'backend/services/asyncSemanticRuntimeService.ts',
      'backend/services/campaignAiOrchestrator/asyncRefinement.ts',
      'backend/services/creator/boltCreatorQueueBridge.ts',
      'backend/services/engagementNormalizationService.ts',
      'backend/services/leadThreadScoring.ts',
      'backend/services/listeningExecutionService.ts',
      'backend/services/replayCoordinationService.ts',
      'backend/services/structuredPlanSchedulerExecWeeklyA.ts',
      'backend/services/whatsappBroadcastService.ts',
    ];
    for (const rel of converted) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
      expect({ file: rel, usesSafeEnqueue: src.includes('safeEnqueue(') || src.includes('enqueueOrThrow(') }).toEqual({
        file: rel,
        usesSafeEnqueue: true,
      });
    }
    expect(directAddSites().filter((f) => converted.includes(f))).toEqual([]);
  });

  it('exempt recovery paths are enumerated, not merely absent', () => {
    for (const rel of EXEMPT) {
      expect(fs.existsSync(path.join(REPO, rel))).toBe(true);
    }
  });
});
