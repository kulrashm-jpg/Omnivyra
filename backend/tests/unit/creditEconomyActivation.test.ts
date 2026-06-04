/**
 * Phase 11B — single activation source.
 *
 * Proves getCreditEconomyExecutionMode is THE one authoritative verdict every
 * customer-activity path consults: master switch OFF ⇒ 'off' for everyone with
 * NO per-org gate read (byte-identical to pre-11B production), and when the
 * master switch is ON the verdict uniformly defers to the existing per-org
 * enforcement gate. Only 'enforce' activates the entry-consumption engine.
 */

const gate = { resolveEnforcementMode: jest.fn() };
jest.mock('../../services/billing/phase2EnforcementGate', () => gate);
jest.mock('../../services/creditExecutionService', () => ({
  isEntryConsumptionEnabled: () =>
    String(process.env.PHASE2_ENTRY_CONSUMPTION ?? '').toLowerCase() === 'true',
}));

import { getCreditEconomyExecutionMode } from '../../services/billing/creditEconomyActivation';

const FLAG = 'PHASE2_ENTRY_CONSUMPTION';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env[FLAG];
  gate.resolveEnforcementMode.mockResolvedValue({ mode: 'enforce', reason: 'org-canary' });
});
afterAll(() => { delete process.env[FLAG]; });

describe('getCreditEconomyExecutionMode (Phase 11B — single activation source)', () => {
  it('master OFF → "off" for every path, with NO per-org gate read (identical to pre-11B)', async () => {
    expect(await getCreditEconomyExecutionMode({ organizationId: 'org-1', surface: 'route.x' })).toBe('off');
    expect(gate.resolveEnforcementMode).not.toHaveBeenCalled();
  });

  it('master ON + no org context → "enforce" (system activity, flag-driven)', async () => {
    process.env[FLAG] = 'true';
    expect(await getCreditEconomyExecutionMode()).toBe('enforce');
    expect(gate.resolveEnforcementMode).not.toHaveBeenCalled();
  });

  it('master ON + org → defers to the uniform per-org enforcement gate', async () => {
    process.env[FLAG] = 'true';
    gate.resolveEnforcementMode.mockResolvedValue({ mode: 'shadow', reason: 'canary' });
    const mode = await getCreditEconomyExecutionMode({ organizationId: 'org-1', surface: 'queue.content-generation' });
    expect(mode).toBe('shadow'); // gate not in enforce → entry-consumption NOT activated
    expect(gate.resolveEnforcementMode).toHaveBeenCalledWith('org-1', 'queue.content-generation');
  });

  it('master ON + org in enforce mode → "enforce" (uniform across all paths)', async () => {
    process.env[FLAG] = 'true';
    gate.resolveEnforcementMode.mockResolvedValue({ mode: 'enforce', reason: 'canary' });
    expect(await getCreditEconomyExecutionMode({ organizationId: 'org-2' })).toBe('enforce');
  });
});
