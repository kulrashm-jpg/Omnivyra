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
 * Matching is on a squashed form (lower-case alphanumerics), so 'Apollo',
 * 'apollo.io', 'APOLLO_export' and 'enrichment_apollo' all resolve to 'apollo'.
 * Over-matching (a tenant source that merely STARTS with a vendor key) is the
 * safe direction: such a source is refused for tenant approval, never silently
 * written as a tenant profile for a vendor.
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
