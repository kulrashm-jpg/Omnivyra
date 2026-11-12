/**
 * Unread-error sites (2026-11-12): creditEfficiencyEngine. A failed read is
 * never "no discount" / "standard tier" / "no ROI data"; a failed score persist
 * is logged.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockUpdates: string[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const b: any = {};
    const result = () => (mockScript[table] ?? (() => ({ data: null, error: null })))();
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
    b.update = () => { const u: any = { eq: () => u, then: (ok: any, ko: any) => { mockUpdates.push(table); return Promise.resolve((mockScript[table + ':update'] ?? (() => ({ data: null, error: null })))()).then(ok, ko); } }; return u; };
    b.upsert = () => { const u: any = { then: (ok: any, ko: any) => Promise.resolve((mockScript[table + ':upsert'] ?? (() => ({ data: null, error: null })))()).then(ok, ko) }; return u; };
    b.maybeSingle = async () => result();
    b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  },
}));

jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: async () => 1 }));
jest.mock('../../services/outcomeTrackingService', () => ({ getCompanyOutcomeStats: async () => ({ avgCreditsPerOutcome: 5, totalOutcomes: 10 }) }));
jest.mock('../../services/patternAmplificationService', () => ({ amplifyWinningPatterns: async () => ({ amplified: [], context: '' }) }));
import { getEfficiencyDiscount, getEfficiencyTier, optimizeCreditEfficiency } from '../../services/creditEfficiencyEngine';

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

// MUTANT SURVIVOR (2026-11-12): the score PERSIST (upsert) failure logs its own
// line and must not fail the report; it had no case.
it('score persist (upsert) error -> report still returned, the failure is logged', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    mockScript['credit_efficiency_scores:upsert'] = DOWN;
    mockScript.content_type_efficiency = () => ({ data: [], error: null });
    const r = await optimizeCreditEfficiency('c1');
    expect(r.company_id).toBe('c1');
    expect(spy.mock.calls.some((c) => String(c[0]).includes('score persist failed'))).toBe(true);
  } finally { spy.mockRestore(); }
});

// (2026-11-12) the credits-saved write was `void <lazy builder>` - it never
// executed. It must actually run (the fake records only an EXECUTED update).
it('credits-saved update is actually EXECUTED (it was a never-run lazy builder)', async () => {
  mockUpdates.length = 0;
  mockScript.content_type_efficiency = () => ({ data: [], error: null });
  await optimizeCreditEfficiency('c1');
  expect(mockUpdates).toContain('credit_efficiency_scores');
});
