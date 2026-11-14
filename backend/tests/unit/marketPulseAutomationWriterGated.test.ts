/**
 * 05 (indirect producers): the settings WRITER enforces the automated-Market-Pulse gate itself, so any caller of
 * upsertAutomationSettings - including a future one that forgets the route-level check - cannot enrol a company while
 * MARKET_PULSE_AUTOMATION_ENABLED !== 'true'. Disabling stays allowed; flag 'true' enrols (positive control).
 */
const writes: Array<{ table: string; row: unknown }> = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: any = {};
    b.upsert = (row: unknown) => { writes.push({ table, row }); return b; };
    b.select = () => b;
    b.single = async () => ({ data: { ok: true }, error: null });
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no read expected'); } } }));

import { upsertAutomationSettings } from '../../services/marketPulseV2ServiceEngine';
import { MarketPulseAutomationDisabledError } from '../../services/marketPulse/automationGate';

const FLAG = 'MARKET_PULSE_AUTOMATION_ENABLED';
const saved = process.env[FLAG];
afterAll(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });
beforeEach(() => { writes.length = 0; delete process.env[FLAG]; });

describe('upsertAutomationSettings enforces the gate', () => {
  test('enrolling (is_active true) with the flag off throws the typed error and writes nothing', async () => {
    await expect(upsertAutomationSettings('c1', { is_active: true })).rejects.toBeInstanceOf(MarketPulseAutomationDisabledError);
    await expect(upsertAutomationSettings('c1', { is_active: true })).rejects.toMatchObject({ code: 'MARKET_PULSE_AUTOMATION_DISABLED', retryable: false });
    expect(writes).toEqual([]);
  });

  test('disabling (is_active false) is always written', async () => {
    await upsertAutomationSettings('c1', { is_active: false });
    expect(writes).toEqual([{ table: 'market_pulse_automation_settings', row: { company_id: 'c1', is_active: false } }]);
  });

  test("positive control: flag 'true' enrols", async () => {
    process.env[FLAG] = 'true';
    await upsertAutomationSettings('c1', { is_active: true });
    expect(writes).toHaveLength(1);
  });
});
