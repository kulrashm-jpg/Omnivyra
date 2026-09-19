// Format + checksum validation for decisive identifiers (candidate §5.1 A3).
// Validation proves an identifier is WELL-FORMED, never that it names the
// intended entity — that tie is A4, established by a human against a registry.

/** ISO 17442 LEI: 18 alphanumerics + 2 check digits; ISO 7064 MOD 97-10 over the whole string == 1. */
export function isValidLei(v) {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(v)) return false;
  return mod97(toDigits(v)) === 1;
}

/** SEC Central Index Key: 1-10 digits, no checksum. Leading zeros are not significant. */
export function isValidCik(v) {
  return /^[0-9]{1,10}$/.test(v) && Number(v) > 0;
}

/**
 * French SIREN: 9 digits, Luhn. La Poste's SIREN (356000000) is the documented
 * exception to the Luhn rule and is allowlisted explicitly.
 */
export function isValidSiren(v) {
  if (!/^[0-9]{9}$/.test(v)) return false;
  return v === '356000000' || luhn(v);
}

/**
 * Brazilian CNPJ, 14 characters. Since July 2026 the first 12 positions may be
 * alphanumeric; each character's value is (ASCII code - 48), so digits keep
 * their face value. The two check digits stay numeric (mod-11 scheme).
 */
export function isValidCnpj(v) {
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(v)) return false;
  if (/^(\d)\1{13}$/.test(v)) return false;
  const val = (ch) => ch.charCodeAt(0) - 48;
  const dv = (chars, weights) => {
    const sum = chars.reduce((acc, ch, i) => acc + val(ch) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const base = v.slice(0, 12).split('');
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv([...base, String(d1)], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return v.slice(12) === `${d1}${d2}`;
}

/** Wikidata item id. */
export function isValidQid(v) {
  return /^Q[1-9][0-9]*$/.test(v);
}

export const SCHEMES = Object.freeze({
  LEI: isValidLei,
  CIK: isValidCik,
  SIREN: isValidSiren,
  CNPJ: isValidCnpj,
  QID: isValidQid,
});

export function validateIdentifier(scheme, value) {
  const fn = SCHEMES[scheme];
  if (!fn) return `unknown identifier scheme "${scheme}" (allowed: ${Object.keys(SCHEMES).join(', ')})`;
  if (typeof value !== 'string' || value !== value.trim() || value === '') return `${scheme} is empty or has surrounding whitespace`;
  return fn(value) ? null : `${scheme} "${value}" fails format/checksum validation`;
}

// ── helpers (exported for the self-test's synthetic generators) ──────────────
export function toDigits(s) {
  return s.split('').map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch)).join('');
}
export function mod97(digits) {
  let r = 0;
  for (const d of digits) r = (r * 10 + Number(d)) % 97;
  return r;
}
export function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}
