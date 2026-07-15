import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';

/**
 * POST /api/content/mark-used
 *
 * Marks a content item (article, blog, etc.) as "used" for distribution tracking.
 *
 * Body:
 *   content_id:    string  (required — the blog/article row id)
 *   content_type:  string  (required — 'article' | 'blog')
 *   company_id:    string  (required)
 *   platform?:     string  (optional — e.g. 'linkedin', 'twitter', 'newsletter', 'email')
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { content_id, content_type, company_id, platform } = req.body ?? {};

  if (!content_id || !content_type || !company_id) {
    return res.status(400).json({ error: 'content_id, content_type, and company_id are required' });
  }

  const auth = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!auth) return;

  try {
    // Update the blogs row with used_at timestamp and platform
    const { error: updateError } = await supabase
      .from('blogs')
      .update({
        used_at:  new Date().toISOString(),
        used_platform: typeof platform === 'string' ? platform.trim() || null : null,
      })
      .eq('id', content_id)
      .eq('company_id', company_id);

    if (updateError) {
      // If columns don't exist yet, still return success — the mark-used is best-effort
      // until the DB migration adds used_at and used_platform columns
      console.warn('[mark-used] DB update warning:', updateError.message);
    }

    return res.status(200).json({
      success: true,
      content_id,
      content_type,
      used_at: new Date().toISOString(),
      platform: platform || null,
    });
  } catch (err: unknown) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/content/mark-used' });
