import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  checkCreatorPersistenceAvailability,
  detectCreatorAssetStaleState,
  regenerateCreatorAssetSignedUrl,
  validatePersistedCreatorAsset,
} from '@/backend/services/creatorAssetPersistenceService';

function collectUrls(asset: Record<string, unknown> | null): string[] {
  if (!asset) return [];
  const metadata = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, unknown>
    : {};
  return [
    typeof asset.url === 'string' ? asset.url : '',
    ...(Array.isArray(asset.files) ? asset.files.map(String) : []),
    typeof metadata.document_url === 'string' ? metadata.document_url : '',
  ].filter(Boolean);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = String(req.query.company_id || req.body?.company_id || '').trim();
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const availability = await checkCreatorPersistenceAvailability(true);
  if (!availability.available) {
    return res.status(503).json({
      persistence_available: false,
      migration_readiness: availability,
      validation: null,
    });
  }

  const assetId = String(req.query.asset_id || req.body?.asset_id || '').trim();
  if (!assetId) {
    return res.status(400).json({ error: 'asset_id required' });
  }

  try {
    const validation = await validatePersistedCreatorAsset({
      companyId,
      userId: access.userId,
      assetId,
    });
    if (!validation.asset) {
      return res.status(404).json({ error: 'Creator asset not found' });
    }

    const stale = await detectCreatorAssetStaleState({
      companyId,
      userId: access.userId,
      assetId,
      limit: 1,
    });
    const signedUrlRecovery = await Promise.all(
      collectUrls(validation.asset).map((url) => regenerateCreatorAssetSignedUrl({ url, expiresInSeconds: 3600 })),
    );

    return res.status(200).json({
      persistence_available: true,
      migration_readiness: availability,
      validation,
      stale_detection: stale,
      signed_url_recovery: signedUrlRecovery,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to validate creator asset';
    return res.status(message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE') ? 503 : 500).json({
      error: message,
      persistence_available: !message.startsWith('CREATOR_PERSISTENCE_UNAVAILABLE'),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-assets/validate' });
