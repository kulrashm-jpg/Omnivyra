/**
 * Run-set pin for the three platform sweeps scheduled on the worker
 * (owner ruling 2026-11-12): anomaly-sweep, scheduler-lock-sweep,
 * recover-stale-reports. Each had an /api/cron route and nothing calling it.
 *
 * cron.ts cannot be executed under jest (see cronScheduleContractCharacterization),
 * so the registry is read from SOURCE, by the same extractor rules, and pinned BY NAME:
 *   1. each label is registered exactly once, with its interval constant and value;
 *   2. its body imports a module that RESOLVES and EXPORTS the called function;
 *   3. the jobs the owner kept OFF for launch are not reachable from the worker;
 *   4. a known-defective source (a label dropped, an interval changed) FAILS the
 *      extractor, so the pin is not vacuous.
 * Behaviour: an unread auth_audit_logs is an error (worker throws, route 500s),
 * never a quiet "zero anomalies".
 */
import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const CRON_PATH = path.join(REPO, 'backend/scheduler/cron.ts');
const cronSrc = fs.readFileSync(CRON_PATH, 'utf8');

const EXPECTED = [
  { label: 'anomalySweep',        interval: 'ANOMALY_SWEEP_INTERVAL_MS',         ms: 2 * 60_000,  module: '../../lib/anomaly/sweepDetector',   fn: 'runAnomalySweep' },
  { label: 'schedulerLockSweep',  interval: 'SCHEDULER_LOCK_SWEEP_INTERVAL_MS',  ms: 15 * 60_000, module: '../services/schedulerLockSweeper',  fn: 'sweepStaleSchedulerLocks' },
  { label: 'recoverStaleReports', interval: 'RECOVER_STALE_REPORTS_INTERVAL_MS', ms: 5 * 60_000,  module: '../services/reportCardService',     fn: 'recoverStaleGeneratingReports' },
] as const;

type Registration = { interval: string; label: string; body: string };

/** Every scheduleWorker(...) call site: its body text and its `INTERVAL_MS, 'label',` line. */
function registrations(src: string): Registration[] {
  const out: Registration[] = [];
  const starts = [...src.matchAll(/^\s*scheduleWorker\(/gm)].map((m) => m.index ?? 0);
  for (const start of starts) {
    const tail = src.slice(start);
    const m = tail.match(/^\s*([A-Z_0-9]+_MS),\s*'([^']+)'/m);
    if (!m || m.index === undefined) throw new Error('scheduleWorker call without an `INTERVAL_MS, \'label\'` line');
    out.push({ interval: m[1], label: m[2], body: tail.slice(0, m.index) });
  }
  return out;
}

function constantMs(src: string, name: string): number | null {
  const m = src.match(new RegExp(`^const ${name}\\s*=\\s*([0-9_\\s*]+);`, 'm'));
  if (!m) return null;
  return m[1].split('*').map((x) => Number(x.trim().replace(/_/g, ''))).reduce((a, b) => a * b, 1);
}

/** Throws BY NAME when the run-set is wrong; returns nothing when it is right. */
function assertRunSet(src: string): void {
  const regs = registrations(src);
  for (const e of EXPECTED) {
    const hits = regs.filter((r) => r.label === e.label);
    if (hits.length !== 1) throw new Error(`run-set: '${e.label}' registered ${hits.length} times, expected 1`);
    const [r] = hits;
    if (r.interval !== e.interval) throw new Error(`run-set: '${e.label}' uses ${r.interval}, expected ${e.interval}`);
    const ms = constantMs(src, e.interval);
    if (ms !== e.ms) throw new Error(`run-set: ${e.interval} = ${ms}, expected ${e.ms}`);
    if (!r.body.includes(`await import('${e.module}')`)) throw new Error(`run-set: '${e.label}' does not import ${e.module}`);
    if (!new RegExp(`await ${e.fn}\\(`).test(r.body)) throw new Error(`run-set: '${e.label}' does not call ${e.fn}`);
  }
}

/** The module source that defines `fn`, following one level of `export * from`. */
function exportsFunction(fromDir: string, spec: string, fn: string): boolean {
  const base = path.resolve(fromDir, spec);
  const file = [`${base}.ts`, path.join(base, 'index.ts')].find((f) => fs.existsSync(f));
  if (!file) return false;
  const src = fs.readFileSync(file, 'utf8');
  if (new RegExp(`export (async )?function ${fn}\\b`).test(src)) return true;
  return [...src.matchAll(/export \* from '([^']+)'/g)]
    .some((m) => exportsFunction(path.dirname(file), m[1], fn));
}

describe('worker run-set: the three platform sweeps (owner ruling 2026-11-12)', () => {
  it('registers each sweep exactly once, on its interval, calling its job', () => {
    expect(() => assertRunSet(cronSrc)).not.toThrow();
  });

  it.each(EXPECTED)('$label: $module resolves and exports $fn', ({ module, fn }) => {
    expect(exportsFunction(path.dirname(CRON_PATH), module, fn)).toBe(true);
  });

  it('the anomaly body turns an unread audit log into a thrown error (counted in the cron report)', () => {
    const body = registrations(cronSrc).find((r) => r.label === 'anomalySweep')!.body;
    expect(body).toMatch(/if \(r\.queryError\) throw new Error\(/);
  });

  it('none of the three is behind the intent gate (timers, not shouldRunCronJob)', () => {
    for (const e of EXPECTED) {
      expect(cronSrc).not.toContain(`shouldRunCronJob("${e.label}"`);
      expect(cronSrc).not.toContain(`shouldRunCronJob('${e.label}'`);
    }
  });

  // Owner: report-automation and campaign-health-monitor KEEP OFF for launch;
  // autonomous-scheduler / learning-decay / leverage-optimizer stay parked (Phase B).
  it('the jobs kept OFF for launch are not reachable from the worker', () => {
    const workerFiles = [CRON_PATH, ...fs.readdirSync(path.join(REPO, 'backend/workers'))
      .filter((f) => f.endsWith('.ts')).map((f) => path.join(REPO, 'backend/workers', f))];
    const parked = ['reportAutomationService', 'runReportAutomationCycle', 'campaignHealthMonitor',
      'autonomousScheduler', 'runAutonomousScheduler', 'learningDecayService', 'runLearningDecay',
      'creditEfficiencyEngine', 'optimizeCreditEfficiency'];
    for (const f of workerFiles) {
      const src = fs.readFileSync(f, 'utf8');
      for (const name of parked) {
        if (src.includes(name)) throw new Error(`${path.relative(REPO, f)} references kept-off job ${name}`);
      }
    }
  });

  // Known-defective controls: the extractor must FAIL, by name, on each plausible regression.
  describe('CONTROL: a defective cron.ts fails the run-set pin', () => {
    it('a dropped registration', () => {
      const bad = cronSrc.replace(/ANOMALY_SWEEP_INTERVAL_MS, 'anomalySweep',/, "ANOMALY_SWEEP_INTERVAL_MS, 'anomalySweepRenamed',");
      expect(bad).not.toBe(cronSrc);
      expect(() => assertRunSet(bad)).toThrow("'anomalySweep' registered 0 times");
    });
    it('a changed interval', () => {
      const bad = cronSrc.replace(/^const RECOVER_STALE_REPORTS_INTERVAL_MS = 5 \* 60 \* 1000;/m, 'const RECOVER_STALE_REPORTS_INTERVAL_MS = 50 * 60 * 1000;');
      expect(bad).not.toBe(cronSrc);
      expect(() => assertRunSet(bad)).toThrow('RECOVER_STALE_REPORTS_INTERVAL_MS = 3000000, expected 300000');
    });
    it('a body that calls the wrong job', () => {
      const bad = cronSrc.replace('await sweepStaleSchedulerLocks()', 'await Promise.resolve()');
      expect(bad).not.toBe(cronSrc);
      expect(() => assertRunSet(bad)).toThrow("'schedulerLockSweep' does not call sweepStaleSchedulerLocks");
    });
    it('a duplicated registration', () => {
      const block = cronSrc.slice(cronSrc.indexOf('  scheduleWorker(\n    async () => {\n      const { sweepStaleSchedulerLocks }'));
      const one = block.slice(0, block.indexOf("['deleted']\n  );") + "['deleted']\n  );".length);
      expect(one.length).toBeGreaterThan(50);
      const bad = cronSrc.replace(one, `${one}\n${one}`);
      expect(() => assertRunSet(bad)).toThrow("'schedulerLockSweep' registered 2 times");
    });
  });
});

// ── Behaviour: an unread audit log is not "no anomalies" ──────────────────────

const answer: { value: { data: unknown; error: { message: string } | null } } = { value: { data: [], error: null } };
const evaluateAnomalyCount = jest.fn(async () => undefined);

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'auth_audit_logs') throw new Error(`undeclared table ${table}`);
      return { select: () => ({ gte: () => ({ limit: async () => answer.value }) }) };
    },
  }),
}));
jest.mock('../../../lib/anomaly/detectionEngine', () => ({ evaluateAnomalyCount }));
jest.mock('../../db/supabaseKeys', () => ({ requireSupabaseSecretKey: () => 'test-key' }));

describe('runAnomalySweep: queryError', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runAnomalySweep } = require('../../../lib/anomaly/sweepDetector');

  it('is set from the error message', async () => {
    answer.value = { data: null, error: { message: 'permission denied for table auth_audit_logs' } };
    const r = await runAnomalySweep();
    expect(r.queryError).toBe('permission denied for table auth_audit_logs');
    expect(evaluateAnomalyCount).not.toHaveBeenCalled();
  });

  it('is set when there is no data AND no error (still no answer)', async () => {
    answer.value = { data: null, error: null };
    const r = await runAnomalySweep();
    expect(r.queryError).toBe('auth_audit_logs read returned no data');
  });

  it('is absent on a real read, even an empty one', async () => {
    answer.value = { data: [], error: null };
    expect((await runAnomalySweep()).queryError).toBeUndefined();
    answer.value = { data: [{ event: 'login_failed' }, { event: null }], error: null };
    const r = await runAnomalySweep();
    expect(r.queryError).toBeUndefined();
    expect(r.counts).toEqual({ login_failed: 1 });
  });
});

describe('GET /api/cron/anomaly-sweep: an unread audit log is a 500', () => {
  const runAnomalySweep = jest.fn();
  let handler: (req: unknown, res: unknown) => Promise<unknown>;
  beforeAll(() => {
    process.env.CRON_SECRET = 'cron-secret-test';
    jest.isolateModules(() => {
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      jest.doMock('../../../lib/anomaly/sweepDetector', () => ({ runAnomalySweep }));
      jest.doMock('../../services/supabaseAuthService', () => ({
        getSupabaseUserFromRequest: () => { throw new Error('undeclared: auth must be decided by CRON_SECRET here'); },
      }));
      jest.doMock('../../services/rbacService', () => ({ isPlatformSuperAdmin: () => { throw new Error('undeclared'); } }));
      jest.doMock('@/backend/services/superAdminSession', () => ({ getLegacySuperAdminSession: () => null }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/cron/anomaly-sweep').default;
    });
  });
  afterAll(() => { delete process.env.CRON_SECRET; });

  const call = async () => {
    const res: { statusCode: number; body: unknown; status(n: number): typeof res; json(b: unknown): typeof res } = {
      statusCode: 0, body: undefined,
      status(n) { this.statusCode = n; return this; },
      json(b) { this.body = b; return this; },
    };
    await handler({ method: 'GET', headers: { authorization: 'Bearer cron-secret-test' }, query: {} }, res);
    return res;
  };

  it('returns 500 with the reason when auth_audit_logs was not read', async () => {
    runAnomalySweep.mockResolvedValueOnce({ checkedTypes: 0, anomaliesFound: 0, counts: {}, durationMs: 1, queryError: 'boom' });
    const res = await call();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Sweep failed', details: 'boom' });
  });

  it('returns 200 on a real read', async () => {
    runAnomalySweep.mockResolvedValueOnce({ checkedTypes: 1, anomaliesFound: 0, counts: { login_failed: 3 }, durationMs: 1 });
    const res = await call();
    expect(res.statusCode).toBe(200);
  });
});
