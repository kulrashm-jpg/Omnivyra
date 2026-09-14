/**
 * CPG-016 — typed reads of parsed, untrusted JSON (registry and filing responses).
 *
 * Registry providers parse third-party JSON. They held it as `any`, which let a
 * value of the wrong shape flow into a typed record unchecked. These helpers
 * keep every value `unknown` until the caller narrows it (`String(…)`,
 * `Array.isArray`, `typeof`). Each reproduces the untyped expression it
 * replaces exactly — the same value for every input, and a TypeError for
 * exactly the inputs that expression threw on — so provider behaviour,
 * including which malformed responses fail, is unchanged:
 *
 *   field(v, k)   ≡ v?.[k]          null / undefined → undefined
 *   member(v, k)  ≡ v[k]            null / undefined → TypeError
 *   iterate(v)    ≡ for (… of v)    arrays and strings iterate; anything else → TypeError
 *
 * Pure; no I/O.
 */

type Key = string | number;

/** A non-nullish JSON value's properties, read as `unknown` (primitives box, as `v[k]` does). */
const properties = (v: unknown): Readonly<Record<Key, unknown>> => Object(v) as Readonly<Record<Key, unknown>>;

/** `v?.[key]`. */
export function field(v: unknown, key: Key): unknown {
  return v === null || v === undefined ? undefined : properties(v)[key];
}

/** `v[key]`: reading from null / undefined throws, as plain member access does. */
export function member(v: unknown, key: Key): unknown {
  if (v === null || v === undefined) throw new TypeError(`Cannot read properties of ${v} (reading '${String(key)}')`);
  return properties(v)[key];
}

/** What `for (… of v)` visits: an array's elements or a string's characters; any other value is not iterable. */
export function iterate(v: unknown): readonly unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return [...v];
  throw new TypeError(`${v === null ? 'null' : typeof v} is not iterable`);
}
