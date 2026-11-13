/**
 * scripts/ci/deploy-schedule-gates.js (BLOCKING predeploy gate, e9 2026-11-13).
 *  A: credit-orphan-hold-reap / monetization-reservation-reconcile stay unscheduled until 053 + an in-flight-aware
 *     resolver ship (a hold released mid-run = free work or a double settle).
 *  B: no invoice / usage-aggregation / ledger-export job runs until the confirm_partial reader sweep lands.
 * Positive control: the real repo files pass AND every surface parses to a non-empty set.
 */
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const gates = require('../../../scripts/ci/deploy-schedule-gates.js');

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const real = () => ({
  vercelJson: read('vercel.json'),
  railwayJson: fs.existsSync(path.join(root, 'railway.json')) ? read('railway.json') : '',
  intentSrc: read('backend/services/intentExecutionService.ts'),
  cronSrc: read('backend/scheduler/cron.ts'),
});
const withCron = (p: string) => {
  const r = real();
  const j = JSON.parse(r.vercelJson);
  j.crons = [...(j.crons || []), { path: p, schedule: '0 * * * *' }];
  return { ...r, vercelJson: JSON.stringify(j) };
};

describe('deploy schedule gates', () => {
  it('positive control: the repo as committed passes, every surface parsed non-empty', () => {
    const res = gates.evaluate(real());
    expect(res.errors).toEqual([]);
    expect(res.violations).toEqual([]);
    expect(res.counts.vercel).toBeGreaterThan(0);
    expect(res.counts.alwaysRun).toBeGreaterThan(0);
    expect(res.counts.worker).toBeGreaterThan(0);
  });

  it.each(['/api/cron/credit-orphan-hold-reap', '/api/cron/monetization-reservation-reconcile', '/api/cron/credit-orphan-hold-reap?x=1'])(
    'A: a vercel cron for %s is a violation',
    (p) => {
      expect(gates.evaluate(withCron(p)).violations.some((v: string) => v.startsWith('A:'))).toBe(true);
    },
  );

  it.each(['/api/cron/invoice-preparation', '/api/cron/usage-aggregation', '/api/cron/ledger-export', '/api/cron/billing-export'])(
    'B: a vercel cron for %s is a violation',
    (p) => {
      expect(gates.evaluate(withCron(p)).violations.some((v: string) => v.startsWith('B:'))).toBe(true);
    },
  );

  it('A: railway.json referencing a hold releaser is a violation', () => {
    const r = real();
    const res = gates.evaluate({ ...r, railwayJson: `${r.railwayJson}\n{"cronSchedule":"/api/cron/credit-orphan-hold-reap"}` });
    expect(res.violations).toContain('A: railway.json references /api/cron/credit-orphan-hold-reap');
  });

  it('A/B: ALWAYS_RUN_JOBS and worker job names are scanned', () => {
    const r = real();
    const intentSrc = r.intentSrc.replace('const ALWAYS_RUN_JOBS = new Set([', "const ALWAYS_RUN_JOBS = new Set([\n  'creditOrphanHoldReap',");
    const cronSrc = `${r.cronSrc}\nif (shouldRunCronJob("usageAggregation", 1, 0)) {}\n`;
    const v = gates.evaluate({ ...r, intentSrc, cronSrc }).violations;
    expect(v).toContain('A: ALWAYS_RUN_JOBS runs creditOrphanHoldReap');
    expect(v).toContain('B: cron.ts runs usageAggregation');
  });

  it('a surface that parses to nothing is an error, never a pass', () => {
    const r = real();
    const res = gates.evaluate({ ...r, intentSrc: '// ALWAYS_RUN_JOBS moved', cronSrc: '' });
    expect(res.errors).toEqual(['ALWAYS_RUN_JOBS: no entries parsed', 'cron.ts: no worker job names parsed']);
  });

  it('predeploy-check calls the gate and blocks on failure', () => {
    const src = read('scripts/predeploy-check.js');
    expect(src).toMatch(/execSync\('node scripts\/ci\/deploy-schedule-gates\.js'/);
    const block = src.slice(src.indexOf('deploy-schedule-gates.js\''), src.indexOf('Render parity gate'));
    expect(block).toMatch(/RESULT: BLOCKED/);
    expect(block).toMatch(/process\.exit\(1\)/);
  });
});
