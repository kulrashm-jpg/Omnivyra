/**
 * Money — unit tests
 *
 * Validates floating-point-free arithmetic, currency precision handling,
 * rounding modes, and currency conversion.
 */

import {
  Money,
  CURRENCY_PRECISION,
  UnsupportedCurrencyError,
  MoneyMismatchError,
} from '../../services/billing/money/Money';

describe('Money — construction', () => {
  it('fromMinor accepts integer / bigint / string', () => {
    expect(Money.fromMinor(100, 'USD').toDecimalString()).toBe('1.00');
    expect(Money.fromMinor(100n, 'USD').toDecimalString()).toBe('1.00');
    expect(Money.fromMinor('100', 'USD').toDecimalString()).toBe('1.00');
  });

  it('fromDecimal handles 2-digit currencies', () => {
    expect(Money.fromDecimal('12.34', 'USD').toDecimalString()).toBe('12.34');
    expect(Money.fromDecimal('-0.05', 'USD').toDecimalString()).toBe('-0.05');
  });

  it('fromDecimal handles JPY zero-decimal currency', () => {
    expect(Money.fromDecimal('100', 'JPY').toDecimalString()).toBe('100');
    expect(Money.fromDecimal('100.999', 'JPY').toDecimalString()).toBe('100'); // truncated
  });

  it('fromDecimal truncates beyond currency precision (never silently rounds)', () => {
    expect(Money.fromDecimal('1.999', 'USD').toDecimalString()).toBe('1.99');
  });

  it('rejects unsupported currencies', () => {
    expect(() => Money.fromMinor(100, 'XYZ')).toThrow(UnsupportedCurrencyError);
  });

  it('rejects non-numeric input', () => {
    expect(() => Money.fromDecimal('abc', 'USD')).toThrow();
  });
});

describe('Money — arithmetic', () => {
  it('add same-currency', () => {
    const a = Money.fromDecimal('10.50', 'USD');
    const b = Money.fromDecimal('5.25',  'USD');
    expect(a.add(b).toDecimalString()).toBe('15.75');
  });

  it('subtract crosses zero', () => {
    const a = Money.fromDecimal('1.00', 'USD');
    const b = Money.fromDecimal('2.50', 'USD');
    expect(a.subtract(b).toDecimalString()).toBe('-1.50');
  });

  it('rejects cross-currency arithmetic', () => {
    const usd = Money.fromMinor(100, 'USD');
    const eur = Money.fromMinor(100, 'EUR');
    expect(() => usd.add(eur)).toThrow(MoneyMismatchError);
  });

  it('multiply by string scalar (banker rounding default)', () => {
    const m = Money.fromDecimal('100.00', 'USD');
    expect(m.multiply('0.075').toDecimalString()).toBe('7.50');
  });

  it('multiply by rational scalar', () => {
    const m = Money.fromDecimal('1.00', 'USD');
    const r = m.multiply({ num: 1n, denom: 3n });
    // banker's rounding for 0.0033333... → 0.00 (half-even falls below midpoint)
    expect(r.toDecimalString()).toBe('0.33');
  });

  it('multiply by zero', () => {
    const m = Money.fromDecimal('100.00', 'USD');
    expect(m.multiply('0').toDecimalString()).toBe('0.00');
  });

  it('handles negative results from multiplication', () => {
    const m = Money.fromDecimal('100.00', 'USD');
    expect(m.multiply('-1.5').toDecimalString()).toBe('-150.00');
  });
});

describe('Money — rounding modes', () => {
  it('HALF_UP rounds 0.5 up', () => {
    const m = Money.fromMinor(100, 'USD'); // $1.00
    // 1.00 * 1.005 should be 1.005 → 1.01 with HALF_UP, 1.00 with HALF_EVEN
    expect(m.multiply('1.005', 'HALF_UP').toDecimalString()).toBe('1.01');
    expect(m.multiply('1.005', 'HALF_EVEN').toDecimalString()).toBe('1.00');
  });

  it('DOWN truncates', () => {
    const m = Money.fromMinor(100, 'USD');
    expect(m.multiply('1.009', 'DOWN').toDecimalString()).toBe('1.00');
  });

  it('UP always rounds away from zero', () => {
    const m = Money.fromMinor(100, 'USD');
    expect(m.multiply('1.001', 'UP').toDecimalString()).toBe('1.01');
  });
});

describe('Money — currency conversion', () => {
  it('USD→INR with rate 83', () => {
    const usd = Money.fromDecimal('1.00', 'USD');
    const inr = usd.convert('INR', { num: 83n, denom: 1n });
    expect(inr.currency).toBe('INR');
    expect(inr.toDecimalString()).toBe('83.00');
  });

  it('USD→JPY drops the cents (JPY is 0-decimal)', () => {
    const usd = Money.fromDecimal('1.00', 'USD');
    const jpy = usd.convert('JPY', { num: 110n, denom: 1n });
    expect(jpy.currency).toBe('JPY');
    expect(jpy.toDecimalString()).toBe('110');
  });

  it('JPY→USD adds two decimals', () => {
    const jpy = Money.fromDecimal('110', 'JPY');
    const usd = jpy.convert('USD', { num: 1n, denom: 110n });
    expect(usd.currency).toBe('USD');
    expect(usd.toDecimalString()).toBe('1.00');
  });

  it('identity conversion is exact', () => {
    const m = Money.fromDecimal('99.99', 'USD');
    const m2 = m.convert('USD', { num: 1n, denom: 1n });
    expect(m2.equals(m)).toBe(true);
  });
});

describe('Money — invariants', () => {
  it('precision table is frozen', () => {
    expect(Object.isFrozen(CURRENCY_PRECISION)).toBe(true);
  });

  it('does not lose precision over many additions (1M iterations)', () => {
    // A classic float-corruption test: adding 0.1 a million times.
    // With floats, this drifts; with Money, it's exact.
    let acc = Money.fromMinor(0, 'USD');
    const step = Money.fromDecimal('0.10', 'USD');
    for (let i = 0; i < 1_000_000; i++) {
      acc = acc.add(step);
    }
    expect(acc.toDecimalString()).toBe('100000.00');
  });

  it('isPositive/isNegative/isZero respect sign', () => {
    expect(Money.fromMinor(0, 'USD').isZero()).toBe(true);
    expect(Money.fromMinor(1, 'USD').isPositive()).toBe(true);
    expect(Money.fromMinor(-1, 'USD').isNegative()).toBe(true);
  });

  it('abs and neg are exact', () => {
    const m = Money.fromMinor(-100, 'USD');
    expect(m.abs().toDecimalString()).toBe('1.00');
    expect(m.abs().neg().toDecimalString()).toBe('-1.00');
  });
});
