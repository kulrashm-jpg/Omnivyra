/**
 * Phase 6G-1 — Canonical content↔platform assignment authority.
 *
 * The single place that answers "may this format run on this platform?" at
 * PLANNING time, so invalid pairs never have to be caught downstream. It is
 * DERIVED from the existing canonical registries — it maintains no duplicate
 * compatibility map of its own:
 *
 *   - platform support  ← normalizeContentCapability + PLATFORM_CAPABILITY_REGISTRY
 *                         (the exact pair the publisher's
 *                         validatePlatformContentCompatibility uses, so
 *                         planning-time and publish-time cannot drift)
 *   - format exclusivity← FORMAT_EXCLUSIVE_PLATFORMS (e.g. tweet → X only)
 *   - known formats     ← BOLT_TEXT_CONTENT_TYPES ∪ CREATOR_GOVERNANCE_REGISTRY
 *
 * Fail-closed: a format whose capability cannot be resolved (e.g. podcast/audio
 * — there is no `audio` capability in the registry) returns NO supported
 * platforms, matching the publisher (CAPABILITY_UNRESOLVED) and the DB
 * (no audio asset). This authority never invents destinations.
 */

import {
  PLATFORM_CAPABILITY_REGISTRY,
  getSupportedPlatformsForContentType,
} from '../social/platformCapabilities';
import { normalizeContentCapability } from '../social/contentCapability';
import { FORMAT_EXCLUSIVE_PLATFORMS } from './formatPlatformBinding';
import { CREATOR_GOVERNANCE_REGISTRY, normalizeCreatorFormat } from '../creatorGovernanceRegistry';
import { BOLT_TEXT_CONTENT_TYPES } from '../../../backend/utils/boltTextContentConfig';

/** Every platform known to the capability registry (the candidate universe). */
const ALL_PLATFORMS: string[] = Object.keys(PLATFORM_CAPABILITY_REGISTRY);

/** All recognized formats, derived from the text + creator registries (no hardcoded list). */
const KNOWN_FORMATS: string[] = [
  ...new Set<string>([
    ...BOLT_TEXT_CONTENT_TYPES,
    ...Object.keys(CREATOR_GOVERNANCE_REGISTRY),
  ]),
];

function normPlatform(p: unknown): string {
  return String(p ?? '').trim().toLowerCase().replace(/^twitter$/, 'x');
}

/**
 * Platforms capable of running `format`, restricted to `candidatePlatforms`
 * (defaults to all). Order of `candidatePlatforms` is preserved so callers can
 * pre-order (e.g. intelligence prioritization) and still filter here. Returns
 * [] when the format's capability cannot be resolved (fail-closed).
 */
export function getSupportedPlatformsForFormat(
  format: unknown,
  candidatePlatforms: string[] = ALL_PLATFORMS,
): string[] {
  const norm = String(format ?? '').trim().toLowerCase();
  if (!norm) return [];
  const capability = normalizeContentCapability({ contentType: norm });
  if (!capability) return []; // e.g. podcast/audio → no audio capability → fail-closed
  let supported = getSupportedPlatformsForContentType(capability, candidatePlatforms);
  const exclusive = FORMAT_EXCLUSIVE_PLATFORMS[norm];
  if (exclusive) {
    const allow = new Set(exclusive.map((p) => p.toLowerCase()));
    supported = supported.filter((p) => allow.has(normPlatform(p)));
  }
  return supported;
}

/** Formats (from the known set) that `platform` can run. */
export function getSupportedFormatsForPlatform(platform: unknown): string[] {
  const p = normPlatform(platform);
  if (!p) return [];
  return KNOWN_FORMATS.filter((f) => getSupportedPlatformsForFormat(f).some((sp) => normPlatform(sp) === p));
}

/** True iff `format` is allowed on `platform` per the canonical authority. */
export function isValidPlatformFormatPair(platform: unknown, format: unknown): boolean {
  const p = normPlatform(platform);
  if (!p) return false;
  return getSupportedPlatformsForFormat(format).some((sp) => normPlatform(sp) === p);
}

/**
 * Filter `platforms` to those that can run `format`, preserving input order.
 * Intelligence prioritization passes a pre-ordered list; this only removes
 * incompatible entries — it never adds or reorders.
 */
export function filterPlatformsForFormat(platforms: string[], format: unknown): string[] {
  const supported = new Set(getSupportedPlatformsForFormat(format).map(normPlatform));
  return (Array.isArray(platforms) ? platforms : []).filter((p) => supported.has(normPlatform(p)));
}
