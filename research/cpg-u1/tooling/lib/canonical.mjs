// Deterministic serialisation + hashing. Stable key order, stable record
// order, no clock, no RNG — the same input always yields the same bytes.
import { createHash } from 'node:crypto';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Records sorted by a key, then serialised canonically. */
export function canonicalRecords(records, sortKey) {
  const sorted = [...records].sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0));
  return canonicalJson(sorted);
}

export const hashRecords = (records, sortKey) => sha256(canonicalRecords(records, sortKey));
