/**
 * CORRECT SENDING (2026-11-12): credit alerts.
 * Every dedup read used to answer "not sent" on error and every dedup record
 * write was unread, so a failure RE-SENT the alert (in-app and email). Now:
 *  - a failed dedup read SUPPRESSES (treated as already sent);
 *  - a failed dedup record write means the alert is NOT sent (an unrecorded
 *    alert would be re-sent next run);
 *  - the refusal writes nothing, so the next run retries.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockWrites: string[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    let op = 'select';
    const b: any = {};
    const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
    for (const m of ['select', 'eq', 'in', 'gte', 'limit']) b[m] = () => b;
    b.insert = () => { op = 'insert'; mockWrites.push(table); return b; };
    b.maybeSingle = async () => result();
    b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  },
}));
jest.mock('../../services/emailService', () => ({ sendCreditAlert: jest.fn(async () => undefined) }));

import { checkCreditAlerts, getFiredConsumptionThresholds, emitConsumptionAlert, wasForecastEmailSent, recordForecastEmail } from '../../services/creditAlertService';

const DOWN = () => ({ data: null, error: { message: 'down' } });
const LOW = () => ({ data: { free_balance: 10, paid_balance: 0, incentive_balance: 0 }, error: null });
let warnSpy: jest.SpyInstance;
beforeEach(() => { mockScript = { 'organization_credits:select': LOW }; mockWrites.length = 0; warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => warnSpy.mockRestore());

it('control: a low balance with clean reads records then notifies once', async () => {
  const r = await checkCreditAlerts('o1');
  expect(r.alerts_fired).toEqual(['low_20']);
  expect(mockWrites).toEqual(['credit_alert_log', 'notifications']);
});

it('dedup read error -> treated as SENT: nothing recorded, nothing sent', async () => {
  mockScript['credit_alert_log:select'] = DOWN;
  const r = await checkCreditAlerts('o1');
  expect(r.alerts_fired).toEqual([]);
  expect(mockWrites).toEqual([]);
});

it('dedup record write error -> NOT sent (an unrecorded alert would be re-sent)', async () => {
  mockScript['credit_alert_log:insert'] = DOWN;
  const r = await checkCreditAlerts('o1');
  expect(r.alerts_fired).toEqual([]);
  expect(mockWrites).toEqual(['credit_alert_log']); // the failed attempt only; no notification
});

it('consumption thresholds: read error -> all treated as fired (suppressed)', async () => {
  mockScript['credit_alert_log:select'] = DOWN;
  await expect(getFiredConsumptionThresholds('o1', '2026-11-01')).resolves.toEqual([80, 90, 95]);
});

it('consumption alert: record write error -> no notification', async () => {
  mockScript['credit_alert_log:insert'] = DOWN;
  await emitConsumptionAlert('o1', 80, 81);
  expect(mockWrites).toEqual(['credit_alert_log']);
});

it('forecast email: dedup read error -> treated as sent; record error THROWS (the caller then does not send)', async () => {
  mockScript['credit_alert_log:select'] = DOWN;
  await expect(wasForecastEmailSent('o1', '2026-11-01')).resolves.toBe(true);
  mockScript['credit_alert_log:insert'] = DOWN;
  await expect(recordForecastEmail('o1', 86)).rejects.toThrow(/forecast email record failed/);
});
