/**
 * Low-credit warning contract (owner policy 2026-07-10):
 * ABSOLUTE ladder — early warning when a company's credits drop BELOW 100,
 * again below 50, again below 20, and 'depleted' at 0. Explicitly NO alert
 * at 200. Also locks the severity-order fix: thresholds are evaluated
 * most-severe-first (originally mildest-first + break-on-first, so the
 * severest alert could never fire), and the 24h dedup never downgrades to a
 * milder alert.
 */

// Scripted ownedDbTable: balance + alert log + notifications + weekly
// consumption (confirm-phase credit_transactions) + admin-email resolution.
let balanceRow: any = null;
let recentAlertRows: Record<string, boolean> = {};
let weeklyConfirmRows: any[] = [];
const inserted: Array<{ table: string; payload: any }> = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: any[] = [];
    const builder: any = {};
    for (const op of ['select', 'eq', 'gte', 'limit']) {
      builder[op] = (...args: unknown[]) => { chain.push({ op, args }); return builder; };
    }
    // List-resolution (thenable) — used by credit_transactions (velocity) and
    // user_company_roles (admin resolution).
    builder.then = (res: any, rej: any) => {
      if (table === 'credit_transactions') return Promise.resolve({ data: weeklyConfirmRows, error: null }).then(res, rej);
      if (table === 'user_company_roles') {
        return Promise.resolve({
          data: [{ user_id: 'admin-1', role: 'COMPANY_ADMIN', created_at: '2026-01-01' }],
          error: null,
        }).then(res, rej);
      }
      return Promise.resolve({ data: [], error: null }).then(res, rej);
    };
    builder.maybeSingle = () => ({
      then: (res: any, rej: any) => {
        if (table === 'organization_credits') return Promise.resolve({ data: balanceRow, error: null }).then(res, rej);
        if (table === 'users') return Promise.resolve({ data: { email: 'admin@acme.co' }, error: null }).then(res, rej);
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

jest.mock('../../services/emailService', () => ({
  sendCreditAlert: jest.fn(async () => {}),
}));

import { checkCreditAlerts } from '../../services/creditAlertService';
import { sendCreditAlert } from '../../services/emailService';

const confirmRow = (amount: number) => ({
  credits_delta: -amount, free_delta: -amount, paid_delta: 0, incentive_delta: 0,
});

const setBalance = (free: number, paid = 0, incentive = 0) => {
  balanceRow = { free_balance: free, paid_balance: paid, incentive_balance: incentive };
};

beforeEach(() => {
  balanceRow = null;
  recentAlertRows = {};
  weeklyConfirmRows = [];
  inserted.length = 0;
  (sendCreditAlert as jest.Mock).mockClear();
});

describe('checkCreditAlerts — absolute 100/50/20 ladder', () => {
  it.each([
    [99, 'low_100', 'below 100'],
    [60, 'low_100', 'below 100'],
    [49, 'low_50', 'below 50'],
    [20, 'low_50', 'below 50'], // 20 is not below 20
    [19, 'low_20', 'below 20'],
    [1, 'low_20', 'below 20'],
    [0, 'depleted', 'depleted'],
  ])('balance %s fires %s', async (balance, expectedType, messageFragment) => {
    setBalance(balance as number);
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([expectedType]);
    const notification = inserted.find((i) => i.table === 'notifications');
    expect(notification?.payload.message.toLowerCase()).toContain(messageFragment as string);
  });

  it.each([[100], [150], [200], [500]])(
    'balance %s fires NOTHING (no alert at or above 100 — 200 notice removed)',
    async (balance) => {
      setBalance(balance as number);
      const r = await checkCreditAlerts('org-1');
      expect(r.alerts_fired).toEqual([]);
      expect(inserted).toHaveLength(0);
    },
  );

  it('24h dedup suppresses a repeat AND does not downgrade to a milder alert', async () => {
    setBalance(15); // breaches low_20 (and low_50/low_100)
    recentAlertRows = { low_20: true };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
    expect(r.alerts_suppressed).toEqual(['low_20']);
    expect(inserted).toHaveLength(0); // no low_50/low_100 piggybacking
  });

  it('escalates as the balance keeps dropping (each level has its own dedup)', async () => {
    setBalance(45); // below 50
    recentAlertRows = { low_100: true }; // the earlier <100 warning already sent
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_50']); // severer level still fires
  });

  it('sums all buckets: 40 free + 70 paid = 110 total → no alert', async () => {
    setBalance(40, 70);
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
  });

  it('records balance_at_alert for the audit log', async () => {
    setBalance(42);
    await checkCreditAlerts('org-1');
    const log = inserted.find((i) => i.table === 'credit_alert_log');
    expect(log?.payload).toMatchObject({ alert_type: 'low_50', balance_at_alert: 42 });
  });
});

describe('email escalation — below 20 and depleted also email the admin', () => {
  it('below 20 sends the admin email', async () => {
    setBalance(15);
    await checkCreditAlerts('org-1');
    expect(sendCreditAlert).toHaveBeenCalledTimes(1);
    expect((sendCreditAlert as jest.Mock).mock.calls[0][0]).toMatchObject({
      recipientEmail: 'admin@acme.co',
      remainingCredits: 15,
    });
  });

  it('depleted sends the admin email', async () => {
    setBalance(0);
    await checkCreditAlerts('org-1');
    expect(sendCreditAlert).toHaveBeenCalledTimes(1);
  });

  it('below 100 and below 50 are in-app ONLY (no email)', async () => {
    setBalance(60);
    await checkCreditAlerts('org-1');
    setBalance(45);
    await checkCreditAlerts('org-2');
    expect(sendCreditAlert).not.toHaveBeenCalled();
  });
});

describe('burn-velocity email — below 200 with ≥100 consumed in 7 days', () => {
  it('balance 150 + 120 consumed this week → velocity email fires', async () => {
    setBalance(150);
    weeklyConfirmRows = [confirmRow(50), confirmRow(40), confirmRow(30)]; // 120
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['velocity_200']);
    expect(sendCreditAlert).toHaveBeenCalledTimes(1);
    expect((sendCreditAlert as jest.Mock).mock.calls[0][0]).toMatchObject({
      remainingCredits: 150,
      projectedRequiredCredits: 120,
    });
    const log = inserted.find((i) => i.table === 'credit_alert_log' && i.payload.alert_type === 'velocity_200');
    expect(log?.payload.balance_at_alert).toBe(150);
  });

  it('balance 150 + only 40 consumed this week → NO velocity email', async () => {
    setBalance(150);
    weeklyConfirmRows = [confirmRow(40)];
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
    expect(sendCreditAlert).not.toHaveBeenCalled();
  });

  it('balance 250 (not below 200) → velocity check does not even run', async () => {
    setBalance(250);
    weeklyConfirmRows = [confirmRow(500)];
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
    expect(sendCreditAlert).not.toHaveBeenCalled();
  });

  it('deduped weekly: a velocity email within 7 days suppresses the next', async () => {
    setBalance(150);
    weeklyConfirmRows = [confirmRow(200)];
    recentAlertRows = { velocity_200: true };
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual([]);
    expect(sendCreditAlert).not.toHaveBeenCalled();
  });

  it('velocity email can accompany a ladder alert (below-100 in-app + velocity email)', async () => {
    setBalance(90);
    weeklyConfirmRows = [confirmRow(150)];
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['low_100', 'velocity_200']);
    expect(sendCreditAlert).toHaveBeenCalledTimes(1); // velocity email; low_100 is in-app only
  });

  it('remainder-only settles (credits_delta 0) still count via bucket deltas', async () => {
    setBalance(150);
    weeklyConfirmRows = [
      { credits_delta: 0, free_delta: -60, paid_delta: 0, incentive_delta: 0 },
      { credits_delta: 0, free_delta: -50, paid_delta: 0, incentive_delta: 0 },
    ];
    const r = await checkCreditAlerts('org-1');
    expect(r.alerts_fired).toEqual(['velocity_200']);
  });
});
