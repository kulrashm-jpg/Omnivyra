/**
 * Mode B: paid central vendor access as a tenant opt-in, and its quote.
 */
const priced = jest.fn();
const upserts: unknown[] = [];
let flagRow: unknown = null;

jest.mock('../../services/pricingService', () => {
  class PricingMissingError extends Error { constructor() { super('missing'); this.name = 'PricingMissingError'; } }
  return { PricingMissingError, resolveVendorUnitCost: (i: unknown) => priced(i) };
});
jest.mock('../../services/featureFlagService', () => ({ upsertFeatureFlag: async (i: unknown) => { upserts.push(i); return {}; } }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) c[m] = () => c;
    c.limit = async () => ({ data: flagRow ? [flagRow] : [], error: null, status: 200 });
    return c;
  },
}));

import { PricingMissingError } from '../../services/pricingService';
import {
  CENTRAL_VENDORS, quoteCentralVendorAccess, readCentralVendorOptIns, STANDARD_CREDIT_RATE_USD, writeCentralVendorOptIns,
} from '../../services/enrichment/centralVendorAccess';

const ORG = '00000000-0000-4000-8000-0000000000aa';
beforeEach(() => { priced.mockReset(); upserts.length = 0; flagRow = null; });

it('the quote comes from the SAME pricing function that charges; public quotes use the standard rate', async () => {
  priced.mockResolvedValue({ credits: 30 });
  expect(await quoteCentralVendorAccess(null)).toEqual([{ vendor: 'apollo', unit: 'credit', creditsPerUnit: 30, available: true }]);
  expect(priced).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apollo', unit: 'credit', units: 1, actionKey: 'prospect_enrichment', quoteAtCreditRateUsd: STANDARD_CREDIT_RATE_USD }));
  await quoteCentralVendorAccess(ORG);
  expect(priced.mock.calls[1][0]).toMatchObject({ orgId: ORG });
  expect(priced.mock.calls[1][0]).not.toHaveProperty('quoteAtCreditRateUsd');
});

it('no vendor cost in Super Admin -> unavailable, no number invented', async () => {
  priced.mockRejectedValue(new (PricingMissingError as unknown as new () => Error)());
  expect(await quoteCentralVendorAccess(ORG)).toEqual([{ vendor: 'apollo', unit: 'credit', creditsPerUnit: null, available: false }]);
});

it('opt-in validates vendors, never drops an unknown one silently, and [] opts out', async () => {
  await expect(writeCentralVendorOptIns(ORG, ['apollo', 'zoominfo'], 'u1')).rejects.toThrow(/unknown_vendor/);
  await expect(writeCentralVendorOptIns(ORG, 'apollo', 'u1')).rejects.toThrow(/invalid_selection/);
  expect(upserts).toEqual([]);
  expect(await writeCentralVendorOptIns(ORG, ['apollo', 'apollo'], 'u1')).toEqual(['apollo']);
  expect(upserts[0]).toMatchObject({ flagKey: 'central_vendor_access', enabled: true, metadata: { vendors: ['apollo'] }, createdBy: 'u1' });
  await writeCentralVendorOptIns(ORG, [], 'u1');
  expect(upserts[1]).toMatchObject({ enabled: false, metadata: { vendors: [] } });
});

it('reads the opt-ins back; a disabled flag or a missing row means NOT opted in', async () => {
  expect(await readCentralVendorOptIns(ORG)).toEqual([]);
  flagRow = { enabled: false, metadata: { vendors: ['apollo'] } };
  expect(await readCentralVendorOptIns(ORG)).toEqual([]);
  flagRow = { enabled: true, metadata: { vendors: ['apollo'] } };
  expect(await readCentralVendorOptIns(ORG)).toEqual(['apollo']);
  expect(CENTRAL_VENDORS).toEqual(['apollo']);
});
