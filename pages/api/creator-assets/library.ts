import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/creator-assets/library — Strategic Mix P2: the server Asset Library
 * storage endpoint (the CreatorAssetBackend interface over HTTP).
 *
 *   GET  ?company_id&id=            → one envelope (read)
 *   GET  ?company_id[&q&type&tags&include_archived&limit] → list (readAll/search)
 *   PUT  {company_id, asset}        → write an envelope (upsert; flat sync)
 *   DELETE ?company_id&id=          → HARD remove (identity convergence ONLY;
 *                                     user-facing delete is the soft-delete
 *                                     action in library-actions)
 *
 * Static path (dynamic [id] routes are unreliable in this dev environment —
 * same convention as index.ts). Versioning/duplicate/restore need NO server
 * endpoints: the client library logic runs those over this backend.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  libraryReadAsset,
  libraryListAssets,
  libraryWriteAsset,
  libraryRemoveAsset,
} from '@/backend/services/creatorAssetPersistenceService';

function errStatus(message: string): number {
  return message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!['GET', 'PUT', 'DELETE'].includes(req.method || '')) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.body?.company_id || req.query.company_id || '').trim();
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    if (req.method === 'GET') {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      if (id) {
        const record = await libraryReadAsset({ companyId, assetId: id });
        return res.status(200).json({ asset: record?.envelope ?? null, server_meta: record?.serverMeta ?? null });
      }
      const types = typeof req.query.type === 'string' && req.query.type.trim()
        ? req.query.type.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        : undefined;
      const tags = typeof req.query.tags === 'string' && req.query.tags.trim()
        ? req.query.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined;
      const records = await libraryListAssets({
        companyId,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
        creatorTypes: types,
        tags,
        includeArchived: req.query.include_archived === 'true',
        limit: Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : undefined,
      });
      return res.status(200).json({
        assets: records.map((r) => ({ asset: r.envelope, server_meta: r.serverMeta })),
      });
    }

    if (req.method === 'PUT') {
      const envelope = req.body?.asset;
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !envelope.id) {
        return res.status(400).json({ error: 'asset envelope with id is required' });
      }
      const record = await libraryWriteAsset({ companyId, userId: access.userId, envelope });
      return res.status(200).json({ asset: record.envelope, server_meta: record.serverMeta });
    }

    // DELETE — hard remove (identity convergence path).
    const id = String(req.query.id || req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    const removed = await libraryRemoveAsset({ companyId, assetId: id });
    return res.status(200).json({ success: true, removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset library request failed';
    return res.status(errStatus(message)).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-assets/library' });
