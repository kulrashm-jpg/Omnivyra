/**
 * A4Y — the canonical form of a requested attribute set.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * A4N made the database the concurrency arbiter for enrichment work, keyed on
 * (tenant, entity, provider). `requested_attributes` was not part of that key,
 * so asking Clearbit for `employee_count` and asking Clearbit for
 * `founded_year` about the SAME account were treated as one work item: the
 * second was rejected, and — worse — an abandoned first attempt could be
 * RECLAIMED by a worker executing a different attribute set, leaving a row
 * whose `requested_attributes` disagreed with what was actually requested.
 *
 * Putting the set into the identity only works if the set has ONE
 * representation. PostgreSQL array equality is order-, duplicate- and
 * whitespace-sensitive (measured, not assumed):
 *
 *     ['a','b'] = ['b','a']   → false
 *     ['a','a'] = ['a']       → false
 *     [' a ']   = ['a']       → false
 *
 * so `[employee_count, founded_year]` and `[founded_year, employee_count]`
 * would otherwise be two work items for one question.
 *
 * ─── REPAIR ORDER AND DUPLICATES; REJECT MALFORMED TOKENS ──────────────────
 * Order and duplication carry no information — the vocabulary is a SET — so
 * normalising them is lossless and safe. Whitespace is different. The rest of
 * the system matches attributes by EXACT string against the frozen vocabulary
 * (`execute.ts` filters on `adapter.supports.includes(a)`, `registry.ts` uses a
 * `Set`), so `' employee_count '` is already `attributes_unsupported` there.
 * Silently trimming it HERE would accept upstream what selection rejects
 * downstream, and the attempt row would then claim a request that could never
 * have been served. So a padded or empty token is REFUSED, never repaired —
 * the same "refuse rather than guess" rule `requireScope` applies to tenancy.
 *
 * ─── NO VOCABULARY LIVES HERE ──────────────────────────────────────────────
 * This module knows nothing about `employee_count` or any other attribute. It
 * enforces SHAPE only. Membership stays where it already is: the provider
 * capability layer (`sources.ts`, `registry.ts`, the adapters). That is also
 * why the SQL half (`pi_canonical_attribute_set`) can mirror this exactly
 * without duplicating the 23-key vocabulary into the database.
 *
 * ─── SORTING IS BYTE ORDER, TO MATCH `COLLATE "C"` ─────────────────────────
 * The database sorts with `COLLATE "C"`, which is UTF-8 byte order (verified
 * against the real server: `a < b COLLATE "C"` agreed with
 * `convert_to(a,'UTF8') < convert_to(b,'UTF8')` in every probed pair). JavaScript's
 * default string sort is UTF-16 CODE UNIT order, which coincides with byte
 * order across ASCII — the whole current vocabulary — but diverges for astral
 * characters, where UTF-16 surrogates sort below U+E000..U+FFFF and UTF-8 bytes
 * do not. Sorting by encoded bytes makes the two halves agree for ALL input
 * rather than merely for today's input.
 *
 * A divergence would in any case be caught, not silently stored: the CHECK
 * constraint compares the stored value against the SQL canonicaliser, so a
 * disagreement fails the insert loudly instead of creating a second identity
 * for one work item.
 */

const encoder = new TextEncoder();

/**
 * Compare two strings by their UTF-8 bytes — exactly what `COLLATE "C"` does.
 *
 * Not `localeCompare` (locale-dependent, and would make the SQL side
 * non-immutable), and not the default sort (UTF-16 code units).
 */
export function compareUtf8Bytes(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/** Thrown when an attribute set cannot be put into canonical form. */
export class NonCanonicalAttributeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonCanonicalAttributeError';
  }
}

/**
 * Put an attribute set into its one canonical representation.
 *
 * Repairs order and duplicates. Refuses anything else. An empty set stays an
 * empty set — a valid array, never null: the executor refuses an empty request
 * on capability grounds long before this, and turning `{}` into NULL here would
 * make empty-set attempts mutually non-colliding in the unique index.
 *
 * @throws NonCanonicalAttributeError on a non-array, a non-string element, an
 *         empty element, or one with leading/trailing whitespace.
 */
export function canonicalAttributeSet(attributes: unknown): readonly string[] {
  if (!Array.isArray(attributes)) {
    throw new NonCanonicalAttributeError(
      'requestedAttributes must be an array of canonical attribute keys',
    );
  }

  const seen = new Set<string>();
  for (const value of attributes) {
    if (typeof value !== 'string') {
      throw new NonCanonicalAttributeError(
        `requestedAttributes must contain only strings — received ${value === null ? 'null' : typeof value}`,
      );
    }
    if (value === '') {
      throw new NonCanonicalAttributeError('requestedAttributes must not contain an empty attribute');
    }
    // Refused, NOT trimmed. See the header: repairing here would accept what
    // the provider capability layer rejects.
    if (value.trim() !== value) {
      throw new NonCanonicalAttributeError(
        `attribute '${value}' has leading or trailing whitespace — attributes are matched exactly, not trimmed`,
      );
    }
    seen.add(value);
  }

  return [...seen].sort(compareUtf8Bytes);
}

/** True when the set is already canonical. Never throws — a probe, not a gate. */
export function isCanonicalAttributeSet(attributes: unknown): boolean {
  try {
    const canonical = canonicalAttributeSet(attributes);
    const given = attributes as readonly string[];
    return canonical.length === given.length && canonical.every((a, i) => a === given[i]);
  } catch {
    return false;
  }
}

/**
 * Render a canonical set as a PostgreSQL array literal, for a PostgREST `eq`.
 *
 * Every element is double-quoted and escaped rather than joined bare: a bare
 * join would mis-parse an element containing a comma, brace, quote or
 * backslash. Nothing in the frozen vocabulary contains those, but the reclaim
 * predicate is a SAFETY boundary — an element that serialises wrongly would
 * silently widen or narrow which work item is taken over.
 *
 * Verified against the live PostgREST endpoint: `eq.{"a","b"}` parses on a
 * `text[]` column, and a non-array value is refused with 22P02.
 */
export function toPgTextArrayLiteral(values: readonly string[]): string {
  if (!values.length) return '{}';
  const parts = values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `{${parts.join(',')}}`;
}
