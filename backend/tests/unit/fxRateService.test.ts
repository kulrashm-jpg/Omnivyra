jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

import { supabase } from '../../db/supabaseClient';
import { getFxRate, recordFxRate, invalidateFxCache } from '../../services/billing/money/fxRateService';
import { Money } from '../../services/billing/money/Money';

type AnyMock = jest.Mock;

describe('fxRateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateFxCache();
  });

  it('returns identity rate for same currency', async () => {
    const r = await getFxRate('USD', 'USD');
    expect(r?.provider).toBe('identity');
    expect(r?.rate).toEqual({ num: 1n, denom: 1n });
  });

  it('reads from lookup_fx_rate RPC for cross-currency', async () => {
    (supabase.rpc as AnyMock).mockResolvedValueOnce({
      data: { rate: '83.25', provider: 'openexchangerates', snapshot_id: 's1', effective_at: '2024-01-01T00:00:00Z' },
      error: null,
    });
    const r = await getFxRate('USD', 'INR');
    expect(r?.provider).toBe('openexchangerates');
    expect(r?.rateDisplay).toBe('83.25');
    // Verify the rational scales work as expected with Money.convert
    const usd = Money.fromDecimal('1.00', 'USD');
    const inr = usd.convert('INR', r!.rate);
    expect(inr.toDecimalString()).toBe('83.25');
  });

  it('returns null when no rate is found', async () => {
    (supabase.rpc as AnyMock).mockResolvedValueOnce({ data: null, error: null });
    const r = await getFxRate('USD', 'INR');
    expect(r).toBeNull();
  });

  it('caches at most CACHE_TTL_MS without an explicit asOf', async () => {
    (supabase.rpc as AnyMock).mockResolvedValueOnce({
      data: { rate: '83.25', provider: 'openexchangerates', effective_at: '2024-01-01T00:00:00Z' },
      error: null,
    });
    const a = await getFxRate('USD', 'INR');
    const b = await getFxRate('USD', 'INR');
    expect(a?.rateDisplay).toBe(b?.rateDisplay);
    // Should have hit the RPC once due to cache.
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it('recordFxRate rejects malformed decimals', async () => {
    const r = await recordFxRate({
      source: 'USD', target: 'INR', rateDecimal: 'not a number', provider: 'manual',
    });
    expect(r.ok).toBe(false);
  });

  it('recordFxRate persists a valid row', async () => {
    (supabase.from as AnyMock).mockReturnValue({
      insert: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: 'rate-1' }, error: null }),
        }),
      }),
    });
    const r = await recordFxRate({
      source: 'USD', target: 'INR', rateDecimal: '83.25', provider: 'openexchangerates',
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('rate-1');
  });
});
