import { createApiRoute as __createApiRoute } from '@/lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { listAssets, associateAsset } from '@/backend/services/content/contentService';
import { resolveCompanyId, firstQueryValue, respondServiceError } from '@/lib/content/contentApiHelpers';

/**
 * Canonical content asset associations endpoint (Wave 1, item 10).
 *
 *   GET  /api/content/:id/assets  → listAssets(contentId, companyId)      → 200 { assets }
 *   POST /api/content/:id/assets  body { assetId, variantId?, role?, version? }
 *     → associateAsset(contentId, companyId, {...})                       → 200 { asset }
 *
 * Company-scoped via enforceCompanyAccess. Links an existing asset to the
 * canonical content object (optionally to a specific variant) — it records an
 * association, it does not copy asset bytes. NEW route.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = firstQueryValue(req.query.id);
  if (!id) return res.status(400).json({ error: 'id required' });

  const companyId = resolveCompanyId(req);
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const scopedCompanyId = companyId as string;

  if (req.method === 'GET') {
    try {
      const assets = await listAssets(id, scopedCompanyId);
      return res.status(200).json({ assets });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to list content assets');
    }
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
    const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
    if (!assetId) return res.status(400).json({ error: 'assetId required' });
    const variantId = typeof body.variantId === 'string' ? body.variantId : undefined;
    const role = typeof body.role === 'string' ? body.role : undefined;
    const version = (typeof body.version === 'number' || typeof body.version === 'string')
      ? body.version
      : undefined;
    try {
      const asset = await associateAsset(id, scopedCompanyId, {
        assetId,
        variantId,
        role,
        version,
      } as never);
      return res.status(200).json({ asset });
    } catch (error) {
      return respondServiceError(res, error, 'Failed to associate asset');
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}

export default __createApiRoute(handler, { route: '/api/content/:id/assets' });
