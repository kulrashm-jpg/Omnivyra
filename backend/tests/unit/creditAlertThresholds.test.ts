/**
 * Low-credit warning contract (2026-07-10, requested by owner):
 * THE warning fires when a company's credits drop BELOW 100. Also locks the
 * severity-order fix: previously thresholds were evaluated mildest-first
 * with break-on-first, so any balance under 100 sent only the mild "below
 * 20%" notice and the critical alert could never fire.
 */

// Scripted ownedDbTable: organization_credits balance + alert log + notifications.
let balanceRow: any = null;
let recentAlertRows: Record<string, boolean> = {};
const inserted: Array<{ table: string; payload: any }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: any[] = [];
    const builder: any = {};
    for (const op of ['select', 'eq', 'gte', 'limit']) {
      builder[op] = (...args: unknown[]) => { chain.push({ op, args }); return builder; };
    }
    builder.maybeSingle = () => ({
      then: (res: any, rej: any) => {
        if (table === 'organization_credits') return Promise.resolve({ data: balanceRow, error: null }).then(res, rej);
        if (table === 'credit_alert_log') {
          const type = chain.find((c) => c.op === 'eq' && c.args[0] === 'alert_type')?.args[1] as string;
          return Promise.resolve({ data: recentAlertRows[type] ? { id: 'x' } : null, error: null }).then(res, rej);
        }
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      },
    });
    builder.insert = (payload: any) => {
      inserted.push({ table, payload });
      return { then: (res: any) => Promise.resolve({ error: null }).then(res) };
    };
    return builder;
  },
}));

import { checkCreditAlerts } from '../../services/creditAlertService';

const firedTypes = () =>
  inserted.filter((i) => i.table === 'credit_alert_log').map((i) => i.payload.alert_type);

beforeEach(() => {
  balanceRow = null;
  recentAlertRows = {};
  inserted.length = 0;
});

describe('checkCreditAlerts — below-100 warning contract', () => {
  it('balance 99 (< 100) fires the low-credit warning, not the mild notice', async () => {
    balanceRow = { free_balance: 99, paid_balance: 0, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_10pct']);
    expect(firedTypes()).toEqual(['low_10pct']);
    const notification = inserted.find((i) => i.table === 'notifications');
    expect(notification?.payload.message).toContain('below 100');
  });

  it('balance 60 fires the below-100 warning (severity beats the mild notice)', async () => {
    balanceRow = { free_balance: 60, paid_balance: 0, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_10pct']);
  });

  it('balance exactly 100 is NOT below 100 — only the early (below-200) notice fires', async () => {
    balanceRow = { free_balance: 100, paid_balance: 0, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_20pct']);
  });

  it('balance 150 fires the early below-200 notice', async () => {
    balanceRow = { free_balance: 150, paid_balance: 0, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_20pct']);
  });

  it('balance 0 fires depleted', async () => {
    balanceRow = { free_balance: 0, paid_balance: 0, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['depleted']);
  });

  it('balance 500 fires nothing', async () => {
    balanceRow = { free_balance: 500, paid_balance: 0, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
    expect(inserted).toHaveLength(0);
  });

  it('24h dedup suppresses a repeat AND does not downgrade to a milder alert', async () => {
    balanceRow = { free_balance: 60, paid_balance: 0, incentive_balance: 0 };
    recentAlertRows = { low_10pct: true };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
    expect(r.alerts_suppressed).toEqual(['low_10pct']);
    expect(inserted).toHaveLength(0); // no mild low_20pct piggybacking
  });

  it('buckets sum: 40 free + 70 paid = 110 total → early notice, not the below-100 warning', async () => {
    balanceRow = { free_balance: 40, paid_balance: 70, incentive_balance: 0 };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_20pct']);
  });
});
