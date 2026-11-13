/**
 * e1 2026-11-13: an action's ceiling_usd is per billed unit of its USUAL size. A unit whose size varies per request
 * (a bulk batch of N replies) passes ceilingScale = N so the charge is not capped at one call's price. The floor is
 * per unit and is never scaled.
 */
import { applyPricingLayer } from '../../services/pricingService';

const ROW = { cost_multiplier: 15, minimum_charge_usd: 0.007, ceiling_usd: 0.014 } as any;

it('default: the ceiling caps the unit price (one call\'s worth)', () => {
  expect(applyPricingLayer(0.01, ROW)).toBeCloseTo(0.014);
});
it('ceilingScale N lifts the cap to N x ceiling (20 replies are not charged as 1)', () => {
  expect(applyPricingLayer(0.01, ROW, true, 20)).toBeCloseTo(0.15);
  expect(applyPricingLayer(0.1, ROW, true, 20)).toBeCloseTo(0.28);
});
it('the floor is per unit and NOT scaled', () => {
  expect(applyPricingLayer(0, ROW, true, 20)).toBeCloseTo(0.007);
});
it('a non-integer / < 1 scale is treated as 1; applyCeiling=false ignores the ceiling entirely', () => {
  expect(applyPricingLayer(0.01, ROW, true, 2.5)).toBeCloseTo(0.014);
  expect(applyPricingLayer(0.01, ROW, true, 0)).toBeCloseTo(0.014);
  expect(applyPricingLayer(0.01, ROW, false, 1)).toBeCloseTo(0.15);
});
