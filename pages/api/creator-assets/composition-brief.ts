import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/creator-assets/composition-brief — the writer content a Creator draft
 * is built from, persisted so a reload / new tab refills the template from the
 * SAME content instead of generic copy.
 *
 *   GET  ?company_id&composition_id          → { brief: CreatorBrief | null }
 *   PUT  { company_id, composition_id, brief } → { brief } (upsert)
 *
 * Tenancy is proven server-side before anything else (enforceCompanyAccess);
 * every read/write is filtered by that company, so a draft id from another
 * tenant resolves to nothing. The brief is sanitised (length-capped, shape-
 * checked) by the same function the client uses.
 *
 * Static path — the same convention as the neighbouring creator-assets routes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '@/backend/services/userContextService';
import {
  getCreatorCompositionBrief,
  isValidCompositionId,
  saveCreatorCompositionBrief,
} from '@/backend/services/creator/creatorCompositionBriefService';

const METHODS = ['GET', 'PUT'];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method || '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = str(req.body?.company_id) || str(req.query.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  // The browser's company id is a request, not an authorization.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const compositionId = str(req.body?.composition_id) || str(req.query.composition_id);
  if (!isValidCompositionId(compositionId)) return res.status(400).json({ error: 'valid composition_id required' });

  if (req.method === 'GET') {
    return res.status(200).json({ brief: await getCreatorCompositionBrief(companyId, compositionId) });
  }

  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const saved = await saveCreatorCompositionBrief({
    companyId,
    userId: user.userId,
    compositionId,
    brief: req.body?.brief,
  });
  if ('reason' in saved) {
    return saved.reason === 'invalid'
      ? res.status(400).json({ error: 'brief must carry a main message or body' })
      : res.status(503).json({ error: 'brief store unavailable' });
  }
  return res.status(200).json({ brief: saved.brief });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-assets/composition-brief' });
