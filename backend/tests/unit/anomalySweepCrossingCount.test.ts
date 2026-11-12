/**
 * runAnomalySweep.anomaliesFound counts threshold crossings. It used to be
 * declared and returned but never incremented, so it always read 0, a
 * confidently wrong number on the worker's cron report (the post-deploy fire
 * check reads it).
 *
 * Not kinder than the real thing: the REAL sweepDetector, detectionEngine,
 * computeThreshold, ANOMALY_CONFIGS and SWEEP_EVENT_MAP run. Only I/O is faked:
 * the auth_audit_logs read, the 24 h baseline read, the system_anomalies insert
 * and the Slack alert. A mock answers ONLY the call it declares; anything else throws.
 */
import { ANOMALY_CONFIGS } from '../../../lib/anomaly/types';

const auditRows: { value: Array<{ event: string | null }> } = { value: [] };
const inserts: unknown[] = [];
const sendCriticalAlert = jest.fn(async () => undefined);

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'auth_audit_logs') throw new Error(`undeclared table ${table}`);
      return {
        select: (cols: string) => {
          if (cols !== 'event') throw new Error(`undeclared select ${cols}`);
          return { gte: () => ({ limit: async () => ({ data: auditRows.value, error: null }) }) };
        },
      };
    },
  }),
}));
jest.mock('../../db/supabaseKeys', () => ({ requireSupabaseSecretKey: () => 'test-key' }));
jest.mock('../../../lib/anomaly/baselineService', () => ({
  ...jest.requireActual('../../../lib/anomaly/baselineService'),
  getHourlyBaseline: async () => 0, // quiet history: threshold = the config's minThreshold
}));
jest.mock('../../../lib/anomaly/notificationService', () => ({ sendCriticalAlert }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    if (table !== 'system_anomalies') throw new Error(`undeclared table ${table}`);
    return { insert: (row: unknown) => { inserts.push(row); return Promise.resolve({ error: null }); } };
  },
}));

// A real sweep-mapped config (has an auth_audit_logs event), chosen from the live table.
const cfg = Object.values(ANOMALY_CONFIGS).find((c) => c.dbEventType !== null && c.minThreshold >= 2)!;
const rows = (n: number, event = cfg.dbEventType) => Array.from({ length: n }, () => ({ event }));

describe('runAnomalySweep.anomaliesFound', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runAnomalySweep } = require('../../../lib/anomaly/sweepDetector');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { evaluateAnomalyCount } = require('../../../lib/anomaly/detectionEngine');

  it('uses a real sweep-mapped config', () => {
    expect(cfg).toBeDefined();
    expect(typeof cfg.dbEventType).toBe('string');
  });

  it('is 0 below the threshold (checked, not crossed)', async () => {
    auditRows.value = rows(cfg.minThreshold - 1);
    const r = await runAnomalySweep();
    expect(r.checkedTypes).toBe(1);
    expect(r.anomaliesFound).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('is >0 when a count crosses the threshold, and the crossing is persisted', async () => {
    auditRows.value = [...rows(cfg.minThreshold), { event: 'not_a_sweep_event' }];
    const r = await runAnomalySweep();
    expect(r.checkedTypes).toBe(1);
    expect(r.anomaliesFound).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ type: cfg.type, metric_value: cfg.minThreshold });
  });

  it('still counts the crossing on the next sweep, when dedup suppresses the row', async () => {
    auditRows.value = rows(cfg.minThreshold + 3);
    const r = await runAnomalySweep();
    expect(r.anomaliesFound).toBe(1);
    expect(inserts).toHaveLength(1); // dedup: no second row within its TTL
  });

  it('evaluateAnomalyCount answers the crossing directly', async () => {
    await expect(evaluateAnomalyCount(cfg.type, cfg.minThreshold - 1)).resolves.toBe(false);
    await expect(evaluateAnomalyCount(cfg.type, cfg.minThreshold)).resolves.toBe(true);
    await expect(evaluateAnomalyCount('no_such_type', 10_000)).resolves.toBe(false);
  });
});
