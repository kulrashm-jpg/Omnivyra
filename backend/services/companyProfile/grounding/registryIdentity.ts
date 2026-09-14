/**
 * CPG-010 — registry identifiers and legal names (§6, §7).
 *
 * A registry identifier names ONE legal entity. Two documents carrying the same
 * normalised identifier describe the same legal entity; two carrying different
 * identifiers IN THE SAME SCHEME describe different ones — a parent and its
 * subsidiary have different CIKs / CINs, however alike their names are.
 *
 * Identifiers in DIFFERENT schemes are not comparable: a CIK and a CIN do not
 * contradict each other (a company can have both), so they neither match nor
 * conflict.
 *
 * Nothing here looks an identifier up, and nothing derives one from a name.
 * Normalisation only fixes FORM (prefix, padding, case, separators); an
 * identifier that does not have a valid form is not invented into one.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { foldForComparison } from './textFold';
import type { RegistryScheme } from './types';
import { exactTokenPattern, SCHEME_CODE } from './registry/schemes';
import type { ProviderRegistry } from './registry/providerRegistry';
import { defaultProviderRegistry } from './registry/builtins';

// ── legal-name normalisation (§7) ────────────────────────────────────────────

/**
 * Legal FORMS only — the designators that say what kind of entity it is, not
 * which one. Stripped ONLY as a trailing run: "Acme Private Equity" keeps
 * "private", "Acme Co-operative Society" keeps "co".
 *
 * NEVER stripped: holdings, group, technologies, motors, consulting, services,
 * foundation, solutions, systems, industries, international … — each can be
 * the entire difference between two legal entities (Acme Holdings, the parent;
 * Acme Technologies, the operating company; Acme Foundation, the charity).
 */
const LEGAL_FORMS: ReadonlySet<string> = new Set([
  'pvt', 'private', 'ltd', 'limited', 'inc', 'incorporated', 'llp', 'llc', 'lp',
  'co', 'company', 'corp', 'corporation', 'plc', 'gmbh', 'ag', 'nv', 'bv', 'sa',
  'pte', 'pty', 'opc',
  // CPG-011 — legal forms are not a US/IN vocabulary: "TotalEnergies SE" is
  // TotalEnergies (Societas Europaea), "Doctolib SAS" is Doctolib.
  'se', 'sas', 'sasu', 'sarl', 'sca', 'spa', 'srl', 'kgaa', 'kg', 'oy', 'oyj', 'ab', 'asa', 'aps',
  'sl', 'sau', 'bhd', 'sdn', 'kk', 'jsc', 'pjsc',
]);

export function normalizeLegalName(s: string): string {
  // CPG-012: script-neutral (was [^a-z0-9], which erased every non-Latin name).
  const tokens = foldForComparison(s.replace(/&/g, ' and '))
    .split(' ')
    .filter(Boolean);
  // Strip the trailing legal-form run, but never the whole name ("Limited" alone stays).
  while (tokens.length > 1 && LEGAL_FORMS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

/** Same legal name, legal form aside. Name equality is WEAK identity — never decisive. */
export function legalNamesEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeLegalName(a), y = normalizeLegalName(b);
  return x.length > 0 && x === y;
}

// ── identifiers (CPG-011: scheme-neutral) ────────────────────────────────────

/** Normalised identifier: scheme plus canonical form — "SIREN:395030844". */
export interface NormalizedRegistryId {
  /** A registered scheme code, an explicitly-prefixed unregistered code, or RAW. */
  scheme: RegistryScheme | 'RAW';
  /** "CIK:0001477333" — or "RAW:<text>" for an unqualified, unrecognised form. */
  registryId: string;
  /** The bare canonical value ("0001477333"). */
  value: string;
  /** True when a registered scheme definition validated the form. */
  validated: boolean;
}

/**
 * Normalise an identifier through the REGISTERED SCHEME DEFINITIONS — the core
 * knows no scheme by name.
 *   · "CODE:value" / "CODE value" with a registered code → that scheme's
 *     normaliser (null when the form or checksum is invalid — never corrected);
 *   · "CODE:value" with an unregistered but well-formed code → kept, scheme-
 *     qualified and unvalidated (a future provider's id stays in its own scheme);
 *   · `hint` → that scheme;
 *   · otherwise the ONE scheme whose self-evident form matches; none, or more
 *     than one → RAW.
 * ⚠️ CPG-011 FIX — RAW no longer means "one shared scheme": two RAW values may be
 * two different schemes, so RAW can match exactly but can never CONFLICT
 * (CPG-010 turned a UK company number vs a French SIREN into MISMATCH).
 */
export function normalizeRegistryId(raw: string | null | undefined, hint?: RegistryScheme, registry: ProviderRegistry = defaultProviderRegistry()): NormalizedRegistryId | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const asScheme = (code: string, value: string): NormalizedRegistryId | null => {
    const def = registry.scheme(code);
    if (!def) return null;
    const v = def.normalize(value);
    return v === null ? null : { scheme: code, registryId: `${code}:${v}`, value: v, validated: true };
  };

  const prefixed = /^([A-Za-z][A-Za-z0-9_]{1,15})\s*(:|#|\s)\s*(.+)$/.exec(s);
  if (prefixed) {
    const code = prefixed[1].toUpperCase();
    if (registry.scheme(code)) return asScheme(code, prefixed[3]);
    if (prefixed[2] === ':' && SCHEME_CODE.test(code)) {
      const v = prefixed[3].trim();
      return v ? { scheme: code, registryId: `${code}:${v}`, value: v, validated: false } : null;
    }
  }
  if (hint) return asScheme(hint.toUpperCase(), s);

  const compact = s.toUpperCase().replace(/\s+/g, '');
  const evident = registry.schemes().filter((d) => d.selfEvident?.test(compact) && d.normalize(compact) !== null);
  if (evident.length === 1) return asScheme(evident[0].code, compact);
  return { scheme: 'RAW', registryId: `RAW:${s.toLowerCase()}`, value: s.toLowerCase(), validated: false };
}

export interface RegistryComparison {
  /** Identifiers present on both sides (normalised). */
  matches: string[];
  /** Same (qualified) scheme, no shared value — a different legal entity. */
  conflicts: { scheme: string; known: string[]; candidate: string[] }[];
}

/**
 * Compare two sets of identifiers scheme by scheme. Deterministic (sorted).
 * A scheme present on only one side is not compared; different schemes never
 * conflict (a CIK and a SIREN of one company are both true); RAW values only
 * ever match exactly.
 */
export function compareRegistryIds(known: readonly (string | null | undefined)[], candidate: readonly (string | null | undefined)[], registry: ProviderRegistry = defaultProviderRegistry()): RegistryComparison {
  // CPG-012: compared by the scheme's ENTITY key (a CNPJ's 8-digit root), so two
  // establishments of one legal entity are not "different legal entities".
  const bucket = (ids: readonly (string | null | undefined)[]) => {
    const m = new Map<string, Map<string, string[]>>();
    for (const raw of ids) {
      const n = normalizeRegistryId(raw ?? null, undefined, registry);
      if (!n) continue;
      const key = entityKeyOf(n, registry);
      const byKey = m.get(n.scheme) ?? new Map<string, string[]>();
      byKey.set(key, [...new Set([...(byKey.get(key) ?? []), n.registryId])]);
      m.set(n.scheme, byKey);
    }
    return m;
  };
  const k = bucket(known), c = bucket(candidate);
  const matches: string[] = [];
  const conflicts: RegistryComparison['conflicts'] = [];
  for (const scheme of [...k.keys()].sort()) {
    const ks = k.get(scheme)!, cs = c.get(scheme);
    if (!cs) continue;
    const shared = [...cs.keys()].filter((x) => ks.has(x)).sort();
    if (shared.length > 0) matches.push(...shared.flatMap((x) => cs.get(x)!).sort());
    else if (scheme !== 'RAW') conflicts.push({ scheme, known: [...ks.values()].flat().sort(), candidate: [...cs.values()].flat().sort() });
  }
  return { matches, conflicts };
}

function entityKeyOf(n: NormalizedRegistryId, registry: ProviderRegistry): string {
  const def = n.scheme === 'RAW' ? null : registry.scheme(n.scheme);
  return def?.entityKey ? def.entityKey(n.value) : n.value;
}

/**
 * CPG-012 — the LEGAL-ENTITY identity of an identifier: "CNPJ:33000167" for any
 * establishment of that company; the full normalised id for schemes without an
 * entity key. Used wherever two identifiers are asked "same legal entity?".
 */
export function entityIdentityKey(raw: string | null | undefined, registry: ProviderRegistry = defaultProviderRegistry()): string | null {
  const n = normalizeRegistryId(raw ?? null, undefined, registry);
  return n ? `${n.scheme}:${entityKeyOf(n, registry)}` : null;
}

/** How a normalised identifier is recognised INSIDE a document — the scheme decides (a CIK only in a CIK context). */
export function registryIdPattern(registryId: string, registry: ProviderRegistry = defaultProviderRegistry()): RegExp | null {
  const n = normalizeRegistryId(registryId, undefined, registry);
  if (!n) return null;
  const def = n.scheme === 'RAW' ? null : registry.scheme(n.scheme);
  return def?.documentPattern ? def.documentPattern(n.value) : exactTokenPattern(n.value);
}
