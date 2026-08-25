import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/creator-assets/asset — deleting a canonical media asset.
 *
 *   DELETE ?company_id&asset_id   → remove the asset row and its storage object
 *
 * Separate from `/composition` on purpose. That route's DELETE detaches a
 * REFERENCE and the asset deliberately survives, because an asset is reusable
 * and may already serve another composition. Deleting the asset itself is a
 * different act with a different consequence, so it gets a different endpoint
 * rather than a mode flag on the existing one.
 *
 * The client names a company and an asset id — never a bucket, never a storage
 * path. Both are read from the asset row inside the service, so an arbitrary
 * storage location is not expressible through this endpoint. Nothing here
 * touches a table, and no URL of any kind is constructed.
 *
 * Static path (dynamic [id] routes are unreliable in this dev environment) —
 * the same convention as the neighbouring creator-assets routes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import {
  deleteCanonicalMediaAsset,
  ASSET_STILL_REFERENCED,
} from '@/backend/services/canonicalMediaAssetService';

const METHODS = ['DELETE'];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * A still-referenced asset is 409 because the caller can fix it by detaching.
 * Everything else that is not a validation problem is 500 — and a missing or
 * foreign asset never reaches here at all, because the service reports both as
 * "nothing deleted" rather than distinguishing them.
 */
function fail(res: NextApiResponse, err: unknown) {
  const message = err instanceof Error ? err.message : 'Request failed';
  const status = message.startsWith(ASSET_STILL_REFERENCED) ? 409
    : /required/i.test(message) ? 400
      : 500;
  return res.status(status).json({ error: message });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method || '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = str(req.query.company_id) || str(req.body?.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  // Tenancy is proven server-side. The browser's company id is a request, not
  // an authorization: this rejects it when the caller is not an active member.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const assetId = str(req.query.asset_id) || str(req.body?.asset_id);
  if (!assetId) return res.status(400).json({ error: 'asset_id required' });

  try {
    const deleted = await deleteCanonicalMediaAsset(companyId, assetId);
    // `deleted: false` covers "no such asset" and "another company's asset"
    // identically, so the response cannot be used to probe for foreign ids.
    return res.status(deleted ? 200 : 404).json(
      deleted ? { success: true } : { error: 'Canonical media asset not found' },
    );
  } catch (err) {
    return fail(res, err);
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-assets/asset' });
