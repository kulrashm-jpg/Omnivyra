import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import {
  buildLandingDiagnostics,
  listLandingPages,
  registerLandingPage,
  type LandingProvider,
} from '../../../backend/services/intelligence/landingPageIntegrationService';

const PROVIDERS: LandingProvider[] = ['clickfunnels', 'leadpages', 'unbounce', 'instapage', 'hubspot', 'generic'];

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const companyId =
    typeof req.query.company_id === 'string' ? req.query.company_id :
    typeof req.body?.company_id === 'string' ? req.body.company_id : null;
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  const roleGate = await enforceRole({ req, res, companyId, allowedRoles: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN] });
  if (!roleGate) return;

  try {
    if (req.method === 'GET') {
      if (req.query.view === 'diagnostics') {
        return res.status(200).json(await buildLandingDiagnostics(companyId));
      }
      return res.status(200).json({ pages: await listLandingPages(companyId) });
    }
    if (req.method === 'POST') {
      const provider = req.body?.provider as LandingProvider | undefined;
      const pageUrl = typeof req.body?.page_url === 'string' ? req.body.page_url : null;
      if (!provider || !PROVIDERS.includes(provider)) return res.status(400).json({ error: `provider must be one of: ${PROVIDERS.join(', ')}` });
      if (!pageUrl) return res.status(400).json({ error: 'page_url is required' });
      return res.status(200).json(await registerLandingPage({
        companyId, provider, pageUrl,
        attributionParam: typeof req.body?.attribution_param === 'string' ? req.body.attribution_param : undefined,
        registeredBy: roleGate.userId,
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      }));
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'landing-page registry failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/website-intelligence/landing-pages' });
