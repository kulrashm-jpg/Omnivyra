/**
 * Money — Phase 3 E
 *
 * Money arithmetic that NEVER uses floating point. All amounts are stored
 * as `bigint` in the currency's minor unit (e.g. cents for USD/EUR/GBP,
 * paise for INR, yen units for JPY). Conversion to display happens at the
 * edge; the ledger and arithmetic surfaces use this type exclusively.
 *
 * Why bigint over numeric strings:
 *   - Postgres `numeric` is the canonical storage; we convert to bigint at
 *     read time using a known precision derived from the currency's
 *     minor_unit_digits. This avoids the floating-point corruption risk
 *     that the audit prompt explicitly calls out.
 *
 * Currencies supported:
 *   USD 2, INR 2, EUR 2, GBP 2, AUD 2, CAD 2, JPY 0
 *   Extend by adding to CURRENCY_PRECISION.
 */

export const CURRENCY_PRECISION: Readonly<Record<string, number>> = Object.freeze({
  USD: 2, INR: 2, EUR: 2, GBP: 2, AUD: 2, CAD: 2,
  JPY: 0,
});

export class UnsupportedCurrencyError extends Error {
  constructor(currency: string) {
    super(`Unsupported currency: ${currency}. Add it to CURRENCY_PRECISION.`);
  }
}

export class MoneyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Money currency mismatch: ${a} vs ${b}`);
  }
}

export interface MoneyShape {
  minor:    bigint;
  currency: string;
}

export class Money {
  readonly minor:    bigint;
  readonly currency: string;

  private constructor(minor: bigint, currency: string) {
    const c = currency.toUpperCase();
    if (!(c in CURRENCY_PRECISION)) throw new UnsupportedCurrencyError(c);
    this.minor    = minor;
    this.currency = c;
  }

  static fromMinor(amountMinor: number | bigint | string, currency: string): Money {
    const m = typeof amountMinor === 'bigint'
      ? amountMinor
      : typeof amountMinor === 'string'
        ? BigInt(amountMinor)
        : BigInt(Math.trunc(amountMinor));
    return new Money(m, currency);
  }

  /**
   * Construct from a decimal string (preferred when ingesting from APIs).
   * Trailing decimals beyond the currency's precision are TRUNCATED — never
   * silently rounded — and the truncated digits are returned to the caller
   * via a separate path if needed.
   */
  static fromDecimal(value: string, currency: string): Money {
    const c = currency.toUpperCase();
    const digits = CURRENCY_PRECISION[c];
    if (digits === undefined) throw new UnsupportedCurrencyError(c);

    const trimmed = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Money.fromDecimal: not a numeric string "${value}"`);
    }
    const negative = trimmed.startsWith('-');
    const abs      = negative ? trimmed.slice(1) : trimmed;
    const [whole, frac = ''] = abs.split('.');
    const fracPadded = (frac + '0'.repeat(digits)).slice(0, digits);
    const minorStr   = `${whole}${fracPadded}`;
    let minor = BigInt(minorStr);
    if (negative) minor = -minor;
    return new Money(minor, c);
  }

  static zero(currency: string): Money {
    return new Money(0n, currency);
  }

  add(other: Money): Money {
    if (other.currency !== this.currency) throw new MoneyMismatchError(this.currency, other.currency);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    if (other.currency !== this.currency) throw new MoneyMismatchError(this.currency, other.currency);
    return new Money(this.minor - other.minor, this.currency);
  }

  /**
   * Multiply by a non-money scalar. Pass scalar as a *rational* numerator/
   * denominator pair OR as a string decimal — never as a float. Result is
   * rounded using the given mode; default is HALF_EVEN (banker's rounding).
   */
  multiply(scalar: { num: bigint; denom: bigint } | string, mode: RoundingMode = 'HALF_EVEN'): Money {
    let num: bigint, denom: bigint;
    if (typeof scalar === 'string') {
      const parsed = scalarFromDecimal(scalar);
      num = parsed.num; denom = parsed.denom;
    } else {
      num = scalar.num; denom = scalar.denom;
    }
    if (denom === 0n) throw new Error('Money.multiply: zero denominator');
    const product = this.minor * num;
    const quotient = roundedDivide(product, denom, mode);
    return new Money(quotient, this.currency);
  }

  divide(scalar: { num: bigint; denom: bigint } | string, mode: RoundingMode = 'HALF_EVEN'): Money {
    let num: bigint, denom: bigint;
    if (typeof scalar === 'string') {
      const parsed = scalarFromDecimal(scalar);
      num = parsed.num; denom = parsed.denom;
    } else {
      num = scalar.num; denom = scalar.denom;
    }
    if (num === 0n) throw new Error('Money.divide: zero scalar');
    const quotient = roundedDivide(this.minor * denom, num, mode);
    return new Money(quotient, this.currency);
  }

  /**
   * Convert to a different currency using a given rate. The rate is provided
   * as a rational pair to keep the arithmetic exact. Caller is responsible
   * for supplying the right rate for the right effective_at.
   */
  convert(target: string, rate: { num: bigint; denom: bigint }, mode: RoundingMode = 'HALF_EVEN'): Money {
    const tgt = target.toUpperCase();
    const tgtDigits = CURRENCY_PRECISION[tgt];
    if (tgtDigits === undefined) throw new UnsupportedCurrencyError(tgt);
    const srcDigits = CURRENCY_PRECISION[this.currency];

    // To go from this.currency minor units → target minor units:
    //   minor_target = minor_source * rate * 10^(target_digits - source_digits)
    const scaleExp = BigInt(tgtDigits - srcDigits);
    const scaleFactor = scaleExp >= 0n
      ? pow10(scaleExp)
      : 1n;
    const scaleDivisor = scaleExp < 0n
      ? pow10(-scaleExp)
      : 1n;
    const numerator   = this.minor * rate.num * scaleFactor;
    const denominator = rate.denom * scaleDivisor;
    const result = roundedDivide(numerator, denominator, mode);
    return new Money(result, tgt);
  }

  isPositive(): boolean { return this.minor > 0n; }
  isNegative(): boolean { return this.minor < 0n; }
  isZero():     boolean { return this.minor === 0n; }

  abs(): Money { return new Money(this.minor < 0n ? -this.minor : this.minor, this.currency); }
  neg(): Money { return new Money(-this.minor, this.currency); }

  /** Return the decimal string representation, e.g. `"123.45"`. */
  toDecimalString(): string {
    const digits = CURRENCY_PRECISION[this.currency];
    if (digits === 0) return this.minor.toString();
    const abs = this.minor < 0n ? -this.minor : this.minor;
    const s   = abs.toString().padStart(digits + 1, '0');
    const whole = s.slice(0, s.length - digits);
    const frac  = s.slice(s.length - digits);
    return `${this.minor < 0n ? '-' : ''}${whole}.${frac}`;
  }

  toJSON(): MoneyShape { return { minor: this.minor, currency: this.currency }; }

  toString(): string { return `${this.toDecimalString()} ${this.currency}`; }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }
}

export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'DOWN' | 'UP';

function roundedDivide(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const neg = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  if (remainder === 0n) return neg ? -quotient : quotient;

  let rounded = quotient;
  switch (mode) {
    case 'DOWN':
      // truncate
      break;
    case 'UP':
      rounded = quotient + 1n;
      break;
    case 'HALF_UP': {
      const doubled = remainder * 2n;
      if (doubled >= absDen) rounded = quotient + 1n;
      break;
    }
    case 'HALF_EVEN': {
      const doubled = remainder * 2n;
      if (doubled > absDen) rounded = quotient + 1n;
      else if (doubled === absDen) {
        rounded = (quotient % 2n === 0n) ? quotient : quotient + 1n;
      }
      break;
    }
  }
  return neg ? -rounded : rounded;
}

function pow10(exp: bigint): bigint {
  let r = 1n;
  for (let i = 0n; i < exp; i++) r *= 10n;
  return r;
}

function scalarFromDecimal(value: string): { num: bigint; denom: bigint } {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Money scalar: not a numeric string "${value}"`);
  }
  const negative = trimmed.startsWith('-');
  const abs      = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = abs.split('.');
  const num = BigInt(`${whole}${frac}`);
  const denom = pow10(BigInt(frac.length));
  return {
    num:   negative ? -num : num,
    denom,
  };
}
