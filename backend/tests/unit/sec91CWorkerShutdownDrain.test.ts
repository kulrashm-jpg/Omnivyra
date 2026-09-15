/**
 * SEC-C6 (STEP 3AH-91) — Railway worker restart hygiene (code-side part).
 *
 * 1. SIGTERM drain. The worker (backend/workers/main.ts) co-hosts the
 *    scheduler. Both registered SIGTERM handlers, and the scheduler's called
 *    process.exit(0) synchronously — so every redeploy cut main.ts's bounded
 *    drain (worker.close(), BOLT claim release, connection close) before it
 *    started. The scheduler now leaves process exit to its host when started
 *    with { hostOwnsShutdown: true }; standalone cron.ts and the Next.js
 *    embedding keep exiting exactly as before.
 * 2. Boot cycle. Every last-run timestamp the scheduler persists is also
 *    restored at boot (confidenceCalibration was saved but never restored, so
 *    it re-ran on every deploy).
 *
 * The scheduler module is too heavy to boot in a unit test (it runs a full
 * cycle), so the shutdown contract is pinned on its source; the drain order
 * in main.ts is pinned the same way.
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('scheduler shutdown does not pre-empt the worker drain', () => {
  const cron = strip(read('backend/scheduler/cron.ts'));
  const shutdownStart = cron.indexOf('const shutdown = async (signal: string) =>');
  const shutdownBody = cron.slice(shutdownStart, cron.indexOf("process.on('SIGTERM'", shutdownStart));

  it('startCron accepts a hostOwnsShutdown option', () => {
    expect(cron).toMatch(/async function startCron\(\s*opts:\s*\{\s*hostOwnsShutdown\?:\s*boolean\s*\}\s*=\s*\{\}\s*\)/);
  });

  it('the scheduler only exits the process when it owns shutdown', () => {
    expect(shutdownStart).toBeGreaterThan(-1);
    const exits = [...shutdownBody.matchAll(/process\.exit\(/g)].map((m) => m.index as number);
    expect(exits.length).toBeGreaterThan(0);
    for (const at of exits) {
      const before = shutdownBody.slice(Math.max(0, at - 160), at);
      expect(before).toMatch(/if\s*\(\s*!opts\.hostOwnsShutdown\s*\)/);
    }
  });

  it('the worker starts the co-located scheduler with hostOwnsShutdown: true', () => {
    const main = strip(read('backend/workers/main.ts'));
    expect(main).toMatch(/startCron\(\{\s*hostOwnsShutdown:\s*true\s*\}\)/);
    // …and still owns the exit after its bounded drain.
    const drain = main.slice(main.indexOf('const shutdown = async (signal: string) =>'));
    expect(drain.indexOf('await closeConnections()')).toBeGreaterThan(-1);
    const drainEnd = drain.indexOf("process.on('SIGTERM'");
    expect(drain.lastIndexOf('process.exit(0)', drainEnd)).toBeGreaterThan(drain.indexOf('await closeConnections()'));
    // A hard, unref'd backstop guarantees exit even if close hangs.
    expect(drain).toMatch(/const hardExit = setTimeout\([\s\S]{0,160}process\.exit\(0\)[\s\S]{0,40}\}, drainDeadlineMs \+ 10_000\);/);
  });

  it('standalone cron.ts and the Next.js embedding keep the default (exit)', () => {
    expect(cron).toMatch(/if \(require\.main === module\) \{\s*startCron\(\)\.catch/);
    expect(read('instrumentation.node.ts')).toMatch(/startCron\(\)\.catch/);
  });
});

describe('every persisted scheduler timestamp is restored at boot', () => {
  const cron = read('backend/scheduler/cron.ts');
  const saveBlock = cron.slice(cron.indexOf('void cronGuard.save({'), cron.indexOf('});', cron.indexOf('void cronGuard.save({')));
  const restoreBlock = cron.slice(cron.indexOf('const saved = await cronGuard.load();'), cron.indexOf("console.info('[cron-guard] last-run timestamps restored"));
  const savedPairs = [...saveBlock.matchAll(/^\s+(\w+):\s+(last\w+),/gm)].map((m) => [m[1], m[2]] as const);

  it('the save block is parsed (guards against a silently empty check)', () => {
    expect(savedPairs.length).toBeGreaterThanOrEqual(25);
  });

  it.each(savedPairs.map(([k, v]) => [k, v]))('%s → %s', (key, variable) => {
    expect(restoreBlock).toMatch(new RegExp(`${variable}\\s*=\\s*saved\\.${key}\\s*\\?\\?\\s*0`));
  });
});
