/**
 * GET /api/bolt/available-platforms
 *   ?companyId=<uuid>
 *   ?mode=<bolt-text|bolt-creator|intelligent-mix|strategy-mix>
 *
 * Returns capability-filtered, capability-aware platform sets for each BOLT
 * mode. Routes through the canonical capability architecture:
 *   - normalizeContentCapability   (mode → ContentCapability)
 *   - filterConnectedPlatformsForContent  (capability × connected)
 *   - PLATFORM_CAPABILITY_REGISTRY (mix-mode registry membership)
 *
 * Response shape:
 *   {
 *     mode, capability,                  // capability resolved from mode
 *     supported, hidden, unregistered,   // standard FilteredPlatforms split
 *     // back-compat aliases for legacy callers
 *     platforms,                         // === supported
 *   }
 *
 * Mode mapping (Round-5):
 *   bolt-text         → ContentCapability 'text'        (filter)
 *   bolt-creator      → ContentCapability 'creator'     (filter)
 *   intelligent-mix   → union: all registry-known       (no capability filter)
 *   strategy-mix      → union: all registry-known       (no capability filter)
 *
 * Default (omitted/unknown mode): 'bolt-text' for back-compat with the
 * existing BOLT (Text) UI that pre-dates the mode-aware API.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { getConnectedPlatformsForCompany } from '../../../backend/utils/platformEligibility';
import { filterConnectedPlatformsForContent } from '../../../lib/shared/social/platformContentFilter';
import {
  getPlatformCapability,
  normalizePlatformKey,
  type ContentCapability,
} from '../../../lib/shared/social/platformCapabilities';

type BoltMode = 'bolt-text' | 'bolt-creator' | 'intelligent-mix' | 'strategy-mix';

/** Mode → primary content capability (for single-capability modes). Mix modes
 *  return null and trigger the registry-membership-only path. */
const BOLT_MODE_CAPABILITY: Record<BoltMode, ContentCapability | null> = {
  'bolt-text': 'text',
  'bolt-creator': 'creator',
  'intelligent-mix': null,
  'strategy-mix': null,
};

function parseMode(raw: unknown): BoltMode {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'bolt-text' || s === 'text') return 'bolt-text';
  if (s === 'bolt-creator' || s === 'creator') return 'bolt-creator';
  if (s === 'intelligent-mix' || s === 'intel-mix') return 'intelligent-mix';
  if (s === 'strategy-mix' || s === 'bolt-combined' || s === 'combined') return 'strategy-mix';
  return 'bolt-text';
}

/** Mix-mode resolution: all connected platforms that exist in the registry.
 *  Unknown platforms become `unregistered` (fail-closed render contract). */
function resolveMixModePlatforms(connected: string[]) {
  const supported: string[] = [];
  const unregistered: Array<{ platform: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const raw of connected) {
    const platform = normalizePlatformKey(raw);
    if (!platform || seen.has(platform)) continue;
    seen.add(platform);
    if (getPlatformCapability(platform)) {
      supported.push(platform);
    } else {
      unregistered.push({
        platform,
        reason: `${platform} is not registered for content publishing.`,
      });
    }
  }
  return { supported, unregistered };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = typeof req.query.companyId === 'string' ? req.query.companyId.trim() : null;
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const mode = parseMode(req.query.mode);
  const capability = BOLT_MODE_CAPABILITY[mode];

  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false }).catch(() => null);
    const connected = await getConnectedPlatformsForCompany(companyId, profile);

    if (capability === null) {
      // Mix mode — union; only filter unregistered (fail-closed for unknown).
      const { supported, unregistered } = resolveMixModePlatforms(connected);
      return res.status(200).json({
        mode,
        capability: null,
        supported,
        hidden: [],
        unregistered,
        platforms: supported, // back-compat alias
      });
    }

    // Single-capability mode — route through the canonical filter helper.
    const filtered = filterConnectedPlatformsForContent(connected, { workflowType: capability });
    return res.status(200).json({
      mode,
      capability: filtered.capability,
      supported: filtered.supported,
      hidden: filtered.hidden,
      unregistered: filtered.unregistered,
      platforms: filtered.supported, // back-compat alias
    });
  } catch (err) {
    console.error('[bolt/available-platforms]', err);
    return res.status(500).json({ error: 'Failed to load available platforms' });
  }
}
