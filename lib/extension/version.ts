/**
 * Extension version gate (EXTENSION-1.5.0-CONTRACT.md §1).
 *
 * Every 1.5 route reads `extension_version` from the SIGNED request body, so the
 * request signature covers it. A missing, malformed or older version is refused
 * with 426 EXTENSION_UPGRADE_REQUIRED: 1.4.x stays refused on these routes even
 * after the R-3 suspension is lifted for 1.5.
 */

export const EXTENSION_MIN_VERSION = '1.5.0';

const SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/;

/** Parsed [major, minor, patch], or null when the string is not a plain x.y.z version. */
export function parseExtensionVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = SEMVER.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative, zero or positive, like a sort comparator. Both inputs must parse. */
export function compareExtensionVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export type VersionGate =
  | { ok: true; version: string }
  | { ok: false; status: 426; code: 'EXTENSION_UPGRADE_REQUIRED'; minimum: string };

/** Fail closed: anything that is not a parseable version at or above the minimum is refused. */
export function checkExtensionVersion(v: unknown, minimum: string = EXTENSION_MIN_VERSION): VersionGate {
  const have = parseExtensionVersion(v);
  const min = parseExtensionVersion(minimum);
  if (!have || !min || compareExtensionVersions(have, min) < 0) {
    return { ok: false, status: 426, code: 'EXTENSION_UPGRADE_REQUIRED', minimum };
  }
  return { ok: true, version: (v as string).trim() };
}
