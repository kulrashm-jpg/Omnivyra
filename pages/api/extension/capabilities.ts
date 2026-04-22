/**
 * GET /api/extension/capabilities
 *
 * Returns the authoritative capability matrix + current version. The
 * extension fetches this on startup and again whenever /api/extension/commands
 * returns CAPABILITY_VERSION_MISMATCH. Single source of truth lives in
 * lib/engagementCapabilities.ts; the extension's offline map is a fallback
 * only.
 *
 * Response:
 *   {
 *     success: true,
 *     version: string,
 *     matrix: { [platform]: { [action]: EngagementCapability } },
 *     aliases: { [alias]: string },
 *     extension_action_by_pair: { reply: 'reply_comment', ... },
 *     fetched_at: string
 *   }
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import {
  CAPABILITY_MAP_VERSION,
  ENGAGEMENT_CAPABILITY_MATRIX,
} from '@/backend/services/engagementCapabilityMap';

// Mirror of /api/extension/commands' action bridge. Declared here so the
// extension can build command payloads without embedding the mapping.
const EXTENSION_ACTION_BY_PAIR = {
  reply: 'reply_comment',
  like: 'like_message',
  dm: 'continue_thread',
  post_create: 'create_post',
} as const;

// Platform aliases the backend accepts. Keep in sync with the capability
// map's ALIASES list. The extension uses these to canonicalize its own
// platform names before dispatching.
const ALIASES: Record<string, string> = {
  x: 'twitter',
  'twitter/x': 'twitter',
  li: 'linkedin',
  fb: 'facebook',
  ig: 'instagram',
  tw: 'twitter',
  meta: 'facebook',
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Authentication: extension-signed only. The capability map itself is
  // not secret, but rate-limiting unauthenticated fetches keeps this out
  // of the public anon-facing surface.
  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;

  return res.status(200).json({
    success: true,
    version: CAPABILITY_MAP_VERSION,
    matrix: ENGAGEMENT_CAPABILITY_MATRIX,
    aliases: ALIASES,
    extension_action_by_pair: EXTENSION_ACTION_BY_PAIR,
    fetched_at: new Date().toISOString(),
  });
}
