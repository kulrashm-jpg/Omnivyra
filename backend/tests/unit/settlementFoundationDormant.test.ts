/**
 * e9 ruling 2026-11-13 (C97 item 1(b)): the dormant, sandbox-only settlement foundation's scheduled jobs - the
 * settlement expiry sweep and the metrics retention/prune - are default-OFF behind SETTLEMENT_FOUNDATION_ENABLED.
 * With the flag off nothing is read, locked or written (its tables do not exist in production; the lock fails OPEN);
 * with it on, the jobs run (positive control).
 */
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no db expected while dormant'); } } }));

import * as fs from 'fs';
import * as path from 'path';
import { runSettlementExpirySweepJob } from '../../jobs/settlementExpirySweepJob';
import { runSettlementMetricsRetention, pruneRolledSettlementMetrics } from '../../services/billing/payments/settlementMetricsRetention';

const ENV = 'SETTLEMENT_FOUNDATION_ENABLED';
const saved = process.env[ENV];
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

describe('flag OFF (default): dormant - nothing read, locked or written', () => {
  beforeEach(() => { delete process.env[ENV]; });

  it('the expiry sweep takes no lock, reads nothing and reports dormant', async () => {
    const acquireLock = jest.fn();
    const recordMetric = jest.fn();
    const sweep = jest.fn();
    const r = await runSettlementExpirySweepJob(undefined, { findCandidates: sweep } as never, { acquireLock, recordMetric } as never);
    expect(r).toMatchObject({ ran: false, dormant: true, candidates: 0 });
    expect(acquireLock).not.toHaveBeenCalled();
    expect(recordMetric).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it('retention and prune touch no backend (calls are RECORDED - both functions swallow backend errors, so a throwing fake would prove nothing)', async () => {
    // Explicit own methods (the functions merge {...DEFAULT, ...override}; a Proxy has no own keys and would be ignored).
    const used: string[] = [];
    const rec = <T,>(name: string, v: T) => async () => { used.push(name); return v; };
    const retention = { readRawMetricRows: rec('readRawMetricRows', []), readRolledPeriodStarts: rec('readRolledPeriodStarts', new Set<string>()), appendRollups: rec('appendRollups', undefined) };
    const prune = { readRollupRows: rec('readRollupRows', []), readRawMetricRows: rec('readRawMetricRows', []), prunePeriods: rec('prunePeriods', 0) };
    await expect(runSettlementMetricsRetention({}, retention as never)).resolves.toEqual({ ok: true, periodsRolledUp: 0, rollupRowsWritten: 0, rawRowsCompacted: 0 });
    await expect(pruneRolledSettlementMetrics(prune as never)).resolves.toMatchObject({ ok: true, prunedRows: 0, eligiblePeriods: 0 });
    expect(used).toEqual([]);
  });

  it("cron does not even tick the two jobs unless the foundation is active (source pin)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/scheduler/cron.ts'), 'utf8');
    expect(src).toMatch(/isSettlementFoundationActive\(\) && shouldRunCronJob\("settlementExpirySweep"/);
    expect(src).toMatch(/isSettlementFoundationActive\(\) && shouldRunCronJob\("settlementMetricsRetention"/);
  });
});

describe("flag ON: the jobs run (positive control - 'true' only)", () => {
  it('the sweep reaches its lock when enabled', async () => {
    process.env[ENV] = 'true';
    const acquireLock = jest.fn(async () => ({ acquired: false, ownerToken: 't', degraded: false }));
    const r = await runSettlementExpirySweepJob(undefined, undefined, { acquireLock } as never);
    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(r.dormant).toBeUndefined();
  });

  it("any value other than 'true' stays dormant", async () => {
    process.env[ENV] = '1';
    const acquireLock = jest.fn();
    await runSettlementExpirySweepJob(undefined, undefined, { acquireLock } as never);
    expect(acquireLock).not.toHaveBeenCalled();
  });
});
