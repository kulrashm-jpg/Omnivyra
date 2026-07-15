import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * External APIs — route shell.
 *
 * Agent-B split (behavior-preserving): access helpers → indexShared, GET →
 * indexRead, POST → indexMutations, all under backend/apiHandlers/externalApis
 * (kept out of pages/api so Next.js registers no extra routes). Each handler
 * keeps its own method guard and recomputes the pure companyId/scope preamble,
 * so dispatch order, the 400 guard, and the final 405 are identical.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { handleExternalApisGet } from '../../../backend/apiHandlers/externalApis/indexRead';
import { handleExternalApisPost } from '../../../backend/apiHandlers/externalApis/indexMutations';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    (req.query?.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined);
  const platformScopeRequested = req.query?.scope === 'platform';
  if (!companyId && !platformScopeRequested) {
    return res.status(400).json({ error: 'companyId required' });
  }

  if (await handleExternalApisGet(req, res)) return;
  if (await handleExternalApisPost(req, res)) return;

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/external-apis' });
