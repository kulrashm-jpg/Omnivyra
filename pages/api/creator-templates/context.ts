import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { resolveCreatorCopyContext } from '../../../backend/services/creator/creatorCopyContextResolver';

/**
 * GET /api/creator-templates/context?company_id=…
 *
 * Read-only PROJECTION of the canonical Context Assembly
 * (resolveCreatorCopyContext — company profile + brand voice) into the
 * discovery-relevant fields the template gallery's recommendation engine
 * consumes. No duplicate context model; no sensitive raw data — only the
 * summary fields used for deterministic scoring. Company maturity is derived
 * deterministically from the available canonical signals.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String((req.query.company_id ?? user?.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(200).json({ context: emptyContext() });
  // Authorize on the requested company before projecting its context.
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const { company, brandVoice } = await resolveCreatorCopyContext(companyId);
    const products = Array.isArray(company.products) ? company.products : [];
    const pillars = Array.isArray(company.messagingPillars) ? company.messagingPillars : [];
    const objectives = Array.isArray(company.businessObjectives) ? company.businessObjectives : [];
    const audience = Array.isArray(company.audience) ? company.audience : [];
    const industries = Array.isArray(company.industries) ? company.industries : [];

    const maturity = deriveMaturity({ products: products.length, pillars: pillars.length, objectives: objectives.length, hasDiff: Boolean(company.differentiators) });

    return res.status(200).json({
      context: {
        industry: industries[0] ?? null,
        industries,
        products,
        audience: audience[0] ?? null,
        objective: objectives[0] ?? null,
        businessObjectives: objectives,
        messagingPillars: pillars,
        positioning: company.positioning ?? null,
        maturity,
        brandTone: brandVoice.tone ?? null,
      },
    });
  } catch {
    return res.status(200).json({ context: emptyContext() });
  }
}

function emptyContext() {
  return { industry: null, industries: [], products: [], audience: null, objective: null, businessObjectives: [], messagingPillars: [], positioning: null, maturity: null, brandTone: null };
}

/** Deterministic maturity from canonical signal richness. */
function deriveMaturity(s: { products: number; pillars: number; objectives: number; hasDiff: boolean }): 'early' | 'growth' | 'mature' {
  const signals = s.products + s.pillars + s.objectives + (s.hasDiff ? 1 : 0);
  return signals >= 6 ? 'mature' : signals >= 2 ? 'growth' : 'early';
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/context' });
