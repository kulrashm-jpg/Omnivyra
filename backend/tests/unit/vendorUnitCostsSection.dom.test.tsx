/**
 * @jest-environment jsdom
 *
 * Super Admin provider unit costs (05 review, image credits):
 *  - a price round-trips EXACTLY (no binary-float drift into the numeric column);
 *  - the table refreshes on a TYPED success, never on message wording, and a
 *    failed save leaves it as it was (the owner reads this screen to know which
 *    image SKUs are priced).
 * Also pins the rollback's SKU list to REQUIRED_IMAGE_SKUS (no drift).
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const posted: Array<Record<string, unknown>> = [];
let writeOk = true;
const mutate = jest.fn(async () => undefined);

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({
    data: {
      vendorUnitCosts: [],
      pricingRule: null,
      pricingRules: { image_generation: { cost_multiplier: 1.5, minimum_charge_usd: 0, ceiling_usd: null } },
      requiredImageSkus: [{ provider: 'openai', model: 'gpt-image-1.5', size: '1024x1024', quality: 'low', usedBy: 'creator', unit: 'gpt-image-1.5:1024x1024:low', priced: false }],
    },
    error: undefined,
    mutate,
  }),
}));
jest.mock('@/lib/apiFetch', () => ({
  apiFetch: jest.fn(async (_u: string, init: { body: string }) => { posted.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }),
}), { virtual: true });
jest.mock('@/lib/security/superAdminWrite', () => ({
  performSuperAdminWrite: jest.fn(async (fire: () => Promise<unknown>) => {
    await fire();
    // Wording deliberately unlike the old "Saved" prefix check.
    return writeOk ? { ok: true, status: 200, body: {}, message: null, code: null }
      : { ok: false, status: 401, body: null, message: 'Passkey confirmation was cancelled.', code: 'STEP_UP_REQUIRED' };
  }),
  freshIdempotencyHeaders: () => ({ 'Content-Type': 'application/json', 'Idempotency-Key': 'k' }),
}), { virtual: true });

import VendorUnitCostsSection, { toPerThousand } from '../../../components/super-admin/VendorUnitCostsSection';
import { REQUIRED_IMAGE_SKUS, imageUnitFor } from '../../services/billing/imageCredits';

beforeEach(() => { posted.length = 0; mutate.mockClear(); writeOk = true; });

describe('exact price round-trip', () => {
  it('prices are sent EXACTLY per 1,000 (float math drifts on 447 of 1,999 four-decimal prices)', () => {
    // the drift being removed: real values, measured
    expect(0.0041 * 1000).toBe(4.1000000000000005);
    expect(0.0049 * 1000).toBe(4.8999999999999995);
    expect(toPerThousand('0.0041')).toBe(4.1);
    expect(toPerThousand('0.0049')).toBe(4.9);
    expect(JSON.stringify({ v: toPerThousand('0.0041') })).toBe('{"v":4.1}');
    expect(toPerThousand('0.0407')).toBe(40.7);
    expect(JSON.stringify({ v: toPerThousand('0.0407') })).toBe('{"v":40.7}');
    expect(toPerThousand('0.04')).toBe(40);
    expect(toPerThousand('12')).toBe(12000);
    expect(toPerThousand('0.123456')).toBe(123.456);
  });
  it.each(['', '0', '0.000', '-1', 'abc', '1e3', '.5'])('rejects %p', (v) => {
    expect(toPerThousand(v)).toBeNull();
  });
});

describe('save refreshes the table only on a typed success', () => {
  const save = () => {
    render(<VendorUnitCostsSection />);
    fireEvent.change(screen.getByLabelText('USD per image gpt-image-1.5:1024x1024:low'), { target: { value: '0.0407' } });
    fireEvent.click(screen.getAllByText('Save')[0]);
  };

  it('success: posts the exact decimal, refreshes, clears the field', async () => {
    save();
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(posted[0]).toMatchObject({ provider: 'openai', model_name: 'gpt-image-1.5:1024x1024:low', kind: 'unit', input_per_1k_usd: 40.7 });
    expect((screen.getByLabelText('USD per image gpt-image-1.5:1024x1024:low') as HTMLInputElement).value).toBe('');
  });

  it('failure (e.g. step-up cancelled): NO refresh, the field keeps the value, the reason is shown', async () => {
    writeOk = false;
    save();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not saved: Passkey confirmation was cancelled.'));
    expect(mutate).not.toHaveBeenCalled();
    expect((screen.getByLabelText('USD per image gpt-image-1.5:1024x1024:low') as HTMLInputElement).value).toBe('0.0407');
  });
});

describe('the rollback deletes exactly the feature SKUs', () => {
  it('its model_name list equals REQUIRED_IMAGE_SKUS', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/rollbacks/image_generation_pricing_rollback.sql'), 'utf8');
    const lists = [...sql.matchAll(/model_name IN \(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort());
    const expected = REQUIRED_IMAGE_SKUS.map((k) => imageUnitFor(k.model, k.size, k.quality)).sort();
    expect(lists.length).toBe(2);                   // the DELETE and its postcondition
    for (const l of lists) expect(l).toEqual(expected);
    expect(sql).not.toMatch(/DELETE FROM public\.llm_model_pricing WHERE kind = 'unit' AND provider = 'openai';/);
  });
});
