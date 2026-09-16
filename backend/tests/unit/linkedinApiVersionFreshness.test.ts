/**
 * LinkedIn versioned API — the pinned version must still be inside LinkedIn's
 * support window, and the three callers must agree.
 *
 * 2026-09-16 incident: publishing failed with "Requested version 20250701 is
 * not active". The pin was 202507, whose support window had ended (LinkedIn
 * supports a version for a minimum of one year; the 202508 sunset was
 * 2026-08-17). Nothing failed until a real post was attempted, because the
 * version is a plain string compiled into three separate modules.
 *
 * This test is the early warning: it fails while there is still runway, rather
 * than at publish time. It is deliberately time-based and self-contained (no
 * network): LinkedIn publishes monthly and supports each version >= 12 months.
 */
export {};

const FILES: Record<string, string> = {
  post: 'backend/adapters/linkedinAdapter.ts',
  media: 'backend/adapters/linkedin/linkedinMediaUpload.ts',
  reconciliation: 'backend/services/providerReconciliation/providers/linkedinReconciliation.ts',
};

/** Months between two YYYYMM strings (b - a). */
function monthsBetween(a: string, b: string): number {
  const y = (s: string) => Number(s.slice(0, 4));
  const m = (s: string) => Number(s.slice(4, 6));
  return (y(b) - y(a)) * 12 + (m(b) - m(a));
}

function pinnedVersion(rel: string): string {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');
  const m = src.match(/LINKEDIN_API_VERSION\s*=\s*'(\d{6})'/);
  if (!m) throw new Error(`no LINKEDIN_API_VERSION literal in ${rel}`);
  return m[1];
}

const now = new Date();
const CURRENT = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

describe('LinkedIn API version pin', () => {
  it('every caller sends the SAME version (a half-bump breaks media posting only)', () => {
    const versions = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, pinnedVersion(rel)]));
    expect(new Set(Object.values(versions)).size).toBe(1);
  });

  it.each(Object.entries(FILES))('%s: the pin is a valid YYYYMM month, not in the future', (_name, rel) => {
    const v = pinnedVersion(rel);
    expect(v).toMatch(/^\d{4}(0[1-9]|1[0-2])$/);
    // A future version cannot have been published yet, so it would be rejected.
    expect(monthsBetween(CURRENT, v)).toBeLessThanOrEqual(0);
  });

  it.each(Object.entries(FILES))('%s: the pin is inside LinkedIn\'s support window, with runway left', (_name, rel) => {
    const age = monthsBetween(pinnedVersion(rel), CURRENT);
    /*
     * LinkedIn supports each version for a MINIMUM of one year, so 12+ months
     * old is out of support (that is exactly what broke publishing). Fail at 10
     * so the bump happens with ~2 months of runway instead of during an outage.
     * Fix: set all three to the latest version at
     * https://learn.microsoft.com/en-us/linkedin/marketing/versioning
     */
    expect(age).toBeLessThan(10);
  });
});
