/**
 * PRICING (e9, 2026-11-12) - efficiency tier discount.
 * An EMPTY campaign has outcome_score 0 and credits_per_outcome = credits_used
 * (a small number), so 3 empty campaigns used to earn ELITE (a 40% discount),
 * and ANY member could trigger the recompute that wrote it.
 * Now: the tier counts only SCORED campaigns (outcome_score > 0), and only the
 * server-side cron (persistTier) writes the price-bearing tier.
 *
 * The REAL outcome-stats service runs over a fake campaign_outcomes table.
 */
export {};
type Row = Record<string, unknown>;
let mockOutcomes: Row[] = [];
const mockTierWrites: Row[] = [];
function mockQuery(table: string) {
  const b: any = {};
  for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b;
  b.upsert = (p: Row) => { if (table === 'credit_efficiency_scores') mockTierWrites.push(p); return Promise.resolve({ data: null, error: null }); };
  b.update = (p: Row) => { const u: any = { eq: () => u, then: (ok: any, ko: any) => { if (table === 'credit_efficiency_scores') mockTierWrites.push(p); return Promise.resolve({ data: null, error: null }).then(ok, ko); } }; return u; };
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok: any, ko: any) => Promise.resolve({ data: table === 'campaign_outcomes' ? mockOutcomes : [], error: null }).then(ok, ko);
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockQuery(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockQuery(t) } }));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: async () => 1 }));
jest.mock('../../services/patternAmplificationService', () => ({ amplifyWinningPatterns: async () => ({ amplified: [], prompt_context: '' }) }));

import { optimizeCreditEfficiency } from '../../services/creditEfficiencyEngine';

const campaign = (i: number, score: number, cpo: number) => ({ campaign_id: `c${i}`, leads_generated: score > 0 ? 3 : 0, credits_used: cpo, credits_per_outcome: cpo, outcome_score: score });
beforeEach(() => { mockOutcomes = []; mockTierWrites.length = 0; });

it('three EMPTY campaigns (outcome_score 0, tiny cost) -> standard tier, no discount', async () => {
  mockOutcomes = [campaign(1, 0, 2), campaign(2, 0, 3), campaign(3, 0, 1)];
  const r = await optimizeCreditEfficiency('co1', { persistTier: true });
  expect(r.efficiency_tier).toBe('standard');
  expect(r.discount_multiplier).toBe(1);
});

it('control: three SCORED cheap campaigns -> elite (the discount is earned)', async () => {
  mockOutcomes = [campaign(1, 0.8, 2), campaign(2, 0.7, 3), campaign(3, 0.9, 1)];
  const r = await optimizeCreditEfficiency('co1', { persistTier: true });
  expect(r.efficiency_tier).toBe('elite');
});

it('two scored + many empty -> still below the 3-SCORED floor -> standard', async () => {
  mockOutcomes = [campaign(1, 0.8, 2), campaign(2, 0.7, 3), campaign(3, 0, 1), campaign(4, 0, 1), campaign(5, 0, 1)];
  const r = await optimizeCreditEfficiency('co1', { persistTier: true });
  expect(r.efficiency_tier).toBe('standard');
});

it('member-triggered (no persistTier) -> report computed, NOTHING price-bearing written', async () => {
  mockOutcomes = [campaign(1, 0.8, 2), campaign(2, 0.7, 3), campaign(3, 0.9, 1)];
  const r = await optimizeCreditEfficiency('co1');
  expect(r.efficiency_tier).toBe('elite');
  expect(mockTierWrites).toEqual([]);
});

it('control: the server-side cron (persistTier) DOES write the tier', async () => {
  mockOutcomes = [campaign(1, 0.8, 2), campaign(2, 0.7, 3), campaign(3, 0.9, 1)];
  await optimizeCreditEfficiency('co1', { persistTier: true });
  expect(mockTierWrites.some((w) => w.efficiency_tier === 'elite')).toBe(true);
});
