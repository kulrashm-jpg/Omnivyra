/**
 * PI-LDB step E: which sources are PLATFORM VENDOR sources.
 *
 * A vendor's mapping (e.g. Apollo's export or response shape) is approved ONCE
 * by a Super Admin and applies to every company (owner direction, relayed by
 * virality-e9, 2026-11-11). Tenants never create or approve a profile for a
 * vendor source; their own profiles cover the files THEY upload (csv).
 *
 * The vendor list is not a second registry. It is DERIVED from the PI adapter
 * profiles: every adapter with a non-null `platform` is a vendor. Registering a
 * new vendor adapter therefore makes its source platform-only here as well.
 * THE RULE, exactly: squash to lower-case alphanumerics, drop ONE leading
 * 'enrichment', then the result must START WITH a vendor key. So 'Apollo',
 * 'apollo.io', 'APOLLO_export' and 'enrichment_apollo' resolve to 'apollo';
 * 'myapollo' does not.
 *
 * FAIL-SAFE DIRECTION: this matcher deliberately OVER-matches. Its only
 * consequence is REFUSING a tenant approval (403 PLATFORM_VENDOR_SOURCE, naming
 * the key that matched), never applying anyone's mapping. The OTHER vendor
 * matcher - mappingProfileStore's fingerprint fallback - must UNDER-match,
 * because its consequence is applying a vendor's mapping to a tenant's data.
 * Do not make that one fuzzy to resemble this one (virality-05, 2026-11-11).
 */
import { PI_ADAPTER_PROFILES } from '../prospectProvenance/ingestion/sourceProfiles';

const squash = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

/** The vendor keys, e.g. ['apollo']. */
export const PLATFORM_VENDOR_KEYS: readonly string[] = Object.freeze(
  Object.entries(PI_ADAPTER_PROFILES)
    .filter(([, profile]) => profile.platform !== null)
    .map(([key]) => key),
);

/** The vendor key a source belongs to, or null for a tenant (non-vendor) source. */
export function platformVendorKey(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  let s = squash(source);
  if (s.startsWith('enrichment')) s = s.slice('enrichment'.length);
  if (!s) return null;
  for (const key of PLATFORM_VENDOR_KEYS) {
    const k = squash(key);
    if (s === k || s.startsWith(k)) return key;
  }
  return null;
}

export const isPlatformVendorSource = (source: unknown): boolean => platformVendorKey(source) !== null;
