/**
 * Unread-error sites (2026-11-12): creditEfficiencyEngine. A failed read is
 * never "no discount" / "standard tier" / "no ROI data"; a failed score persist
 * is logged.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockScript: Record<string, () => Res> = {};
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: any = {};
    const result = () => (mockScript[table] ?? (() => ({ data: null, error: null })))();
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
    b.maybeSingle = async () => result();
    b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  },
}));

import { getEfficiencyDiscount, getEfficiencyTier } from '../../services/creditEfficiencyEngine';

const DOWN = () => ({ data: null, error: { message: 'down' } });
beforeEach(() => { mockScript = {}; });

it('discount: read error THROWS (never "no discount" = 1.0)', async () => {
  mockScript.credit_efficiency_scores = DOWN;
  await expect(getEfficiencyDiscount('o1')).rejects.toThrow(/discount read failed/);
});
it('tier: read error THROWS (never "standard")', async () => {
  mockScript.credit_efficiency_scores = DOWN;
  await expect(getEfficiencyTier('o1')).rejects.toThrow(/tier read failed/);
});
it('controls: clean empty reads keep the documented defaults', async () => {
  await expect(getEfficiencyDiscount('o1')).resolves.toBe(1.0);
  await expect(getEfficiencyTier('o1')).resolves.toBe('standard');
});
