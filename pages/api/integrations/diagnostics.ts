import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { buildAllProviderDiagnostics, buildProviderDiagnosticsCard } from '../../../backend/services/providerDiagnosticsService';
import { isCmsProvider } from '../../../backend/services/cms/registry';
import type { CmsProvider } from '../../../backend/services/cms/types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const companyId = typeof req.query.company_id === 'string' ? req.query.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
  try {
    if (provider) {
      if (!isCmsProvider(provider)) return res.status(400).json({ error: `Unknown CMS provider: ${provider}` });
      const card = await buildProviderDiagnosticsCard(companyId, provider as CmsProvider);
      return res.status(200).json({ provider: card });
    }
    const cards = await buildAllProviderDiagnostics(companyId);
    return res.status(200).json({ providers: cards });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/integrations/diagnostics' });
