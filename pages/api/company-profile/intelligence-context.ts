import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  calculateIntelligenceReadiness,
  type CompanyContextIntelligence,
  getCompanyContextIntelligence,
  saveCompanyContextIntelligence,
} from '../../../backend/services/companyContextIntelligenceService';
import { calculateContextQualityMetadata } from '../../../backend/services/companyContextEnrichmentService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId =
    (req.query.companyId as string | undefined) ||
    (body.companyId as string | undefined) ||
    (body.company_id as string | undefined);

  if (!companyId) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  if (req.method === 'GET') {
    try {
      const [profile, intelligence] = await Promise.all([
        getProfile(companyId, { autoRefine: false, languageRefine: false }),
        getCompanyContextIntelligence(companyId),
      ]);
      return res.status(200).json({
        intelligence_context: intelligence,
        intelligence_readiness: calculateIntelligenceReadiness({ intelligence, profile }),
        context_quality: calculateContextQualityMetadata(intelligence),
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message || 'Failed to load intelligence context' });
    }
  }

  if (req.method === 'POST') {
    try {
      const normalizedRole = String(access.role ?? '').toUpperCase();
      if (!['SUPER_ADMIN', 'CONTENT_ARCHITECT', 'CAMPAIGN_ARCHITECT', 'COMPANY_ADMIN', 'ADMIN'].includes(normalizedRole)) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }

      const input = (body.intelligence_context ?? body) as Partial<CompanyContextIntelligence>;
      const actorUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(access.userId)
        ? access.userId
        : null;
      const intelligence = await saveCompanyContextIntelligence(companyId, input, {
        actorUserId,
        updateSource: 'manual',
        createSnapshot: true,
        snapshotPurpose: 'profile_intelligence_context_update',
      });
      const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
      return res.status(200).json({
        intelligence_context: intelligence,
        intelligence_readiness: calculateIntelligenceReadiness({ intelligence, profile }),
        context_quality: calculateContextQualityMetadata(intelligence),
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message || 'Failed to save intelligence context' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
