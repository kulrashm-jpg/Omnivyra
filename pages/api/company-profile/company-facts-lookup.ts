import { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';
import { lookupCompanyFirmographicsFromWikidata } from '../../../backend/services/intelligence/adapters/wikidataAdapter';

/**
 * Best-effort public-domain lookup of firmographic facts (founded year / team
 * size / revenue) from Wikidata. Returns nulls when the company isn't on
 * Wikidata — the UI then leaves those fields for the user to fill in manually.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    const brandName = String(profile?.name || '').trim();
    if (!brandName) {
      return res.status(200).json({
        facts: { founded_year: null, team_size: null, revenue_range: null },
        matched_label: null,
        source: 'wikidata',
      });
    }

    const result = await lookupCompanyFirmographicsFromWikidata(brandName);
    return res.status(200).json({
      facts: {
        founded_year: result.founded_year,
        team_size: result.team_size,
        revenue_range: result.revenue_range,
      },
      matched_label: result.matched_label,
      source: 'wikidata',
    });
  } catch (err: unknown) {
    return res.status(500).json({
      error: 'Failed to look up company facts',
      details: err instanceof Error ? err.message : null,
    });
  }
}
