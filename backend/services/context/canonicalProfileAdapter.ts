/**
 * canonicalProfileAdapter.ts — CONTENT-INTELLIGENCE-003.
 *
 * Drop-in replacement for getProfile() that returns the SAME CompanyProfile
 * shape, but backfills EMPTY fields from the Canonical Context Engine. Consumers
 * migrate by aliasing their import (`getCanonicalProfile as getProfile`) — no
 * call-site, prompt, schema, or business-rule changes.
 *
 * Guarantees:
 *   - Present profile values are NEVER overwritten (business rules preserved).
 *   - When the profile already contains a field, output is identical to legacy
 *     (compatibility: canonical == legacy when context matches).
 *   - Canonical failure → returns the untouched legacy profile (graceful fallback).
 *   - Deterministic given the same profile + canonical inputs.
 */
import { getProfile } from '../companyProfileServiceRest1Rest2Pulse';
import { getCanonicalContext } from './contextAssimilationEngine';
import { recordCanonicalRead } from './canonicalAdoptionMetrics';
import { overlayCanonicalOntoProfile } from './canonicalProfileOverlay';

export { overlayCanonicalOntoProfile };

type ProfileT = Awaited<ReturnType<typeof getProfile>>;
type GetProfileOptions = { autoRefine?: boolean; languageRefine?: boolean; includeStoredCompetitors?: boolean };

/**
 * Canonical-backed getProfile. Same signature + return shape. Alias its import
 * as `getProfile` in a consumer to migrate that consumer's grounding source.
 */
export async function getCanonicalProfile(
  companyId?: string,
  options?: GetProfileOptions,
): Promise<ProfileT> {
  const profile = await getProfile(companyId, options);
  if (!companyId) return profile;

  // Reuse the already-loaded profile inside assimilation to avoid a 2nd read.
  const ctx = profile
    ? await getCanonicalContext(companyId, { loadProfile: async () => profile as unknown as Record<string, unknown> }).catch(() => null)
    : await getCanonicalContext(companyId).catch(() => null);

  recordCanonicalRead(companyId, !!ctx);

  // Fallback: no profile OR canonical unavailable → untouched legacy behavior.
  if (!profile || !ctx) return profile;
  return overlayCanonicalOntoProfile(profile as unknown as Record<string, unknown>, ctx) as ProfileT;
}
