/**
 * GET /api/intelligence/theme-preview?theme_id=...
 * Preview strategic theme + related campaign opportunities + trend intelligence
 * for Strategy Theme Card with action buttons.
 * Does not modify intelligence pipeline or campaign creation APIs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getThemePreview } from '../../../backend/services/themePreviewService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const theme_id = req.query.theme_id;
  if (!theme_id || typeof theme_id !== 'string' || !theme_id.trim()) {
    return res.status(400).json({ error: 'theme_id query parameter is required' });
  }

  try {
    const result = await getThemePreview(theme_id.trim());
    if (!result) {
      return res.status(404).json({ error: 'Theme not found' });
    }
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[theme-preview]', err);
    return res.status(500).json({
      error: err?.message ?? 'Failed to load theme preview',
    });
  }
}

export default handler;
