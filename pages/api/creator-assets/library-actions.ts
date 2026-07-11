/**
 * POST /api/creator-assets/library-actions — Strategic Mix P2 server-owned
 * asset actions that have no client-library equivalent:
 *
 *   { company_id, id, action: 'archive' | 'unarchive' | 'soft-delete' | 'record-usage' }
 *
 * (duplicate / restore / version-append run CLIENT-side through the library
 * logic over the /library backend — no server action needed.)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  archiveLibraryAsset,
  softDeleteLibraryAsset,
  recordLibraryAssetUsage,
} from '@/backend/services/creatorAssetPersistenceService';

const ACTIONS = new Set(['archive', 'unarchive', 'soft-delete', 'record-usage']);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.body?.company_id || '').trim();
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const id = String(req.body?.id || '').trim();
  const action = String(req.body?.action || '').trim();
  if (!id || !ACTIONS.has(action)) {
    return res.status(400).json({ error: 'id and a valid action are required' });
  }

  try {
    if (action === 'archive' || action === 'unarchive') {
      const ok = await archiveLibraryAsset({ companyId, assetId: id, archived: action === 'archive' });
      return res.status(ok ? 200 : 404).json(ok ? { success: true } : { error: 'Asset not found' });
    }
    if (action === 'soft-delete') {
      const ok = await softDeleteLibraryAsset({ companyId, assetId: id });
      return res.status(ok ? 200 : 404).json(ok ? { success: true } : { error: 'Asset not found' });
    }
    await recordLibraryAssetUsage({ companyId, assetId: id });
    return res.status(200).json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset action failed';
    return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({ error: message });
  }
}
