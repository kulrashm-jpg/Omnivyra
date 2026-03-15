/**
 * GET /api/social-platforms/registry
 *
 * Returns platform registry (supported platforms with capabilities).
 * Used by social-platforms UI for dropdown and auto-fill.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupportedPlatforms } from '../../../backend/services/platformRegistryService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const platforms = await getSupportedPlatforms();
    return res.status(200).json({ platforms });
  } catch (err: any) {
    console.error('[social-platforms/registry]', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Failed to load registry' });
  }
}
