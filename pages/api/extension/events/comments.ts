import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/extension/events/comments
 *
 * Extension-scraped comment sync. The extension's LinkedIn content
 * script visits the user's activity / posts pages, walks the DOM
 * for each post, extracts the comment list, and POSTs here.
 *
 *   engagement_threads  — one row per *post* the user owns
 *                         (platform_thread_id = post URN, e.g.
 *                          urn:li:activity:1234567890).
 *   engagement_messages — one row per comment on that post
 *                         (message_type='comment',
 *                          platform_message_id = comment URN).
 *
 * Tenant-scoped via the extension session (orgId from hmac-signed token).
 * No user-supplied organization_id is trusted.
 *
 * Body contract:
 *   {
 *     platform: 'linkedin',
 *     posts: Array<{
 *       post_urn: string,            // e.g. 'urn:li:activity:7234...'
 *       post_url?: string,
 *       post_text_preview?: string,
 *       reaction_count?: number,
 *       comment_count?: number
 *     }>,
 *     comments: Array<{
 *       post_urn: string,            // FK → posts above
 *       comment_urn: string,         // unique per comment
 *       author_name?: string,
 *       author_handle?: string,
 *       author_self?: boolean,       // true when written by the logged-in user
 *       content: string,
 *       created_at?: string,         // ISO
 *       like_count?: number,
 *       parent_comment_urn?: string  // for threaded replies
 *     }>
 *   }
 *
 * Idempotent: upserts on (platform, platform_thread_id, organization_id)
 * for threads, and (thread_id, platform_message_id) for messages.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';
import {
  isExtensionCommentPlatform,
  normalizeExtensionPlatform,
} from '@/lib/engagement/extensionIngestion';
import { persistExtensionComments, type Body as ExtensionCommentsBody } from '@/backend/services/extensionCommentIngestion';
import { EXTENSION_BROWSER_INGESTION_SUSPENDED, refuseSuspendedIngestion } from '@/backend/services/extensionIngestionSuspension';

type Body = ExtensionCommentsBody;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // R-3: browser ingestion is suspended. Refused before auth, parsing or any
  // read/write, so nothing collected in a browser is stored.
  if (EXTENSION_BROWSER_INGESTION_SUSPENDED) return refuseSuspendedIngestion(res);

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;
  const organizationId = session.orgId;

  const body = (req.body || {}) as Body;
  const platform = normalizeExtensionPlatform(body.platform);
  if (!platform || !isExtensionCommentPlatform(platform)) {
    return res.status(400).json({ success: false, error: 'unsupported platform' });
  }
  const result = await persistExtensionComments(organizationId, platform, body);
  return res.status(result.status).json(result.payload);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/extension/events/comments' });
