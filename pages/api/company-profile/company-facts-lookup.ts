import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { lookupGroundedCompanyFacts } from '../../../backend/services/companyProfile/grounding/companyFactsLookup';
import { createSafeEvidenceFetcher } from '../../../backend/services/companyProfile/grounding/acquisition/safeEvidenceFetcher';

/**
 * Company Profile "Fill from Wikidata": founded year / team size / revenue range,
 * grounded (CPG-012). The company is identified from its own website, legal
 * notice and registries before any fact is used, and a fact is returned only
 * when the grounding resolver marks it PUBLICLY_VERIFIED. Everything else comes
 * back null, with the reason and the CPG evidence in `grounding`. The previous
 * lookup took the first Wikidata hit for the brand name.
 */

// Grounding reads several pages and registries while the user waits on a button.
export const config = { maxDuration: 60 };
/** Shared by every outbound request of one lookup; below maxDuration so the route always answers. */
const GROUNDING_BUDGET_MS = 45_000;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);

  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  let profile: Awaited<ReturnType<typeof getProfile>>;
  try {
    profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
  } catch (err: unknown) {
    return res.status(500).json({
      error: 'Failed to look up company facts',
      details: err instanceof Error ? err.message : null,
    });
  }

  // Grounding isolates every source and registry; it degrades, it does not fail.
  // Anything unexpected still leaves the form usable: no facts, and it says so.
  try {
    const result = await lookupGroundedCompanyFacts({
      companyId,
      companyName: profile?.name,
      websiteUrl: profile?.website_url,
      linkedinUrl: profile?.linkedin_url ?? null,
      asOf: new Date().toISOString(),
      fetcher: createSafeEvidenceFetcher({ budgetMs: GROUNDING_BUDGET_MS }),
    });
    return res.status(200).json(result);
  } catch {
    return res.status(200).json({
      facts: { founded_year: null, team_size: null, revenue_range: null },
      matched_label: null,
      source: 'cpg_grounding',
      grounding: null,
      error: 'grounding_unavailable',
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/company-facts-lookup' });
