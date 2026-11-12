/**
 * (2026-11-12) listMonetizationBetaHealthSummary:
 *  - quarantined_reservations counted hold-row metadata stamps that the prod
 *    ledger immutability trigger never lets be written (always 0); it now
 *    counts DISTINCT reservations from the reservation_quarantined events;
 *  - its four reads never read `error`, so an outage answered 'healthy'; a
 *    read error now throws.
 */
export {};
type Res = { data: unknown; error: { message: string } | null };
let mockData: Record<string, unknown[]> = {};
let mockFail: string | null = null;
function mockQuery(table: string) {
  const filters: Record<string, unknown> = {};
  const b: any = {};
  for (const m of ['select', 'gte', 'limit', 'neq']) b[m] = () => b;
  b.eq = (c: string, v: unknown) => { filters[c] = v; return b; };
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => {
    const key = table === 'monetization_operational_events' && filters.event_name ? 'quarantine_events' : table;
    const r: Res = mockFail === key ? { data: null, error: { message: 'down' } } : { data: mockData[key] ?? [], error: null };
    return Promise.resolve(r).then(ok, ko);
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockQuery(t) }));
jest.mock('../../services/monetizationOpsService', () => ({ recordMonetizationOperationalEvent: jest.fn() }));
import { listMonetizationBetaHealthSummary } from '../../services/monetizationBetaAccessService';

beforeEach(() => { mockData = {}; mockFail = null; });

it('quarantined_reservations = DISTINCT reservations from the quarantine events', async () => {
  mockData.quarantine_events = [{ reservation_id: 'h1' }, { reservation_id: 'h1' }, { reservation_id: 'h2' }];
  const r = await listMonetizationBetaHealthSummary();
  expect(r.quarantined_reservations).toBe(2);
});
it.each(['monetization_operational_events', 'credit_purchases', 'quarantine_events', 'monetization_beta_support_cases'])('%s read error -> THROWS (never "healthy")', async (key) => {
  mockFail = key;
  await expect(listMonetizationBetaHealthSummary()).rejects.toThrow(/health summary read failed/);
});
it('control: clean empty reads -> healthy', async () => {
  await expect(listMonetizationBetaHealthSummary()).resolves.toMatchObject({ economic_health: 'healthy', quarantined_reservations: 0 });
});
