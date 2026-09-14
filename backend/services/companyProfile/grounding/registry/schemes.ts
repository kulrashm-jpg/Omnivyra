/**
 * CPG-011 §4 — the IDENTIFIER-SCHEME contract.
 *
 * The core knows no scheme by name. A scheme (CIK, CIN, SIREN, LEI, …) is a
 * definition a PROVIDER module declares and the provider registry registers;
 * the core only ever asks the registered definition to normalise, recognise
 * or locate an identifier.
 *
 * A normalised identifier is always SCHEME-QUALIFIED — "CIK:0001477333",
 * "SIREN:395030844", "LEI:549300E9PC51EN656011" — so two identifiers of
 * different schemes can never be compared as if they were one scheme.
 *
 * Normalisation fixes FORM only (prefix, spacing, padding, case). It never
 * corrects a value: a typo that fails the scheme's structure or checksum is
 * INVALID (null), never "the nearest valid identifier".
 *
 * Pure: no I/O, no clock, no RNG.
 */

export interface FirstPartyStatementPattern {
  /** GLOBAL regex; capture group 1 is the raw identifier. Run over visible text. */
  pattern: RegExp;
  /** What the statement is ("French RCS registration", "Indian CIN footer"). */
  label: string;
}

export interface IdentifierScheme {
  /** Registry-wide unique code — the prefix of every normalised identifier. */
  code: string;
  name: string;
  /** Jurisdiction code of the issuing registry (registry/jurisdiction.ts). */
  jurisdiction: string;
  /** Who issues it (a label, not a provider id — a scheme may have no provider). */
  issuer: string;
  /** Canonical value, or null when the form (or checksum) is invalid. Never corrects. */
  normalize(raw: string): string | null;
  /**
   * An unprefixed form that identifies THIS scheme on its own (a 21-character
   * CIN, a 20-character LEI with a valid checksum). A bare 9-digit number is
   * NOT self-evident — several schemes use one.
   */
  selfEvident?: RegExp;
  /** How an established value appears inside a document (default: the exact token). */
  documentPattern?(value: string): RegExp;
  /** Labelled statements a company makes on its OWN pages (legal notice, imprint, footer). */
  firstPartyStatements?: readonly FirstPartyStatementPattern[];
  /** Registry-specific display form ("395 030 844"), for providers that query by it. */
  display?(value: string): string;
  /**
   * CPG-012 — the part of the identifier that names the LEGAL ENTITY, when the
   * identifier names something finer. A CNPJ identifies an ESTABLISHMENT; its
   * first 8 digits identify the company, so two branches of one company must
   * not be "different legal entities". Absent = the whole value.
   */
  entityKey?(value: string): string;
  /**
   * CPG-012 — identifiers in OTHER schemes that are the same entity BY
   * DEFINITION of this scheme (a published derivation rule, never an
   * inference): a Japanese company-registration number determines its
   * corporate number (check digit + the same 12 digits).
   */
  definedEquivalents?(value: string): { registryId: string; detail: string }[];
  /**
   * CPG-012 — how OTHER registries refer to this scheme. A national scheme
   * declares the codes under which a cross-referencing registry (e.g. GLEIF's
   * registration-authority codes, namespace "gleif_ra") files its numbers, and
   * how to translate them. The cross-referencing provider reads these
   * declarations; it holds no national table of its own.
   */
  externalReferences?: readonly ExternalReferenceMapping[];
}

/** CPG-012 — a scheme's identity in another registry's vocabulary. */
export interface ExternalReferenceMapping {
  /** The other registry's vocabulary ("gleif_ra"). */
  namespace: string;
  /** Codes in that vocabulary whose numbers belong to this scheme. */
  authorityCodes: readonly string[];
  /** (authority code, the other registry's raw value) → this scheme's canonical value, or null. Never corrects. */
  fromExternal(authorityCode: string, raw: string): string | null;
  /** This scheme's canonical value → the authority codes and raw forms the other registry files it under. */
  toExternal(value: string): { authorityCodes: readonly string[]; raw: readonly string[] };
}

/** Helper: a mapping whose numbers are the scheme's own normalised form under fixed codes. */
export function simpleExternalMapping(namespace: string, authorityCodes: readonly string[], normalize: (raw: string) => string | null, rawForms: (value: string) => readonly string[]): ExternalReferenceMapping {
  return {
    namespace, authorityCodes,
    fromExternal: (code, raw) => (authorityCodes.includes(code) ? normalize(raw) : null),
    toExternal: (value) => ({ authorityCodes, raw: [...new Set(rawForms(value))] }),
  };
}

/** A scheme code: uppercase letter first, then uppercase letters, digits or "_". */
export const SCHEME_CODE = /^[A-Z][A-Z0-9_]{1,15}$/;

// ── generic checksum algorithms (not country-specific) ──────────────────────

/** Luhn (mod 10) over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** ISO 7064 MOD 97-10 over an alphanumeric string (letters A=10 … Z=35). */
export function mod97Valid(s: string): boolean {
  if (!/^[0-9A-Z]+$/.test(s)) return false;
  let rem = 0;
  for (const ch of s) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Default in-document pattern: the exact token, not inside a longer alphanumeric run. */
export function exactTokenPattern(value: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])${esc(value)}(?![A-Za-z0-9])`, 'i');
}
