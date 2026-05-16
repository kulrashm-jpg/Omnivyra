import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  getCompanyContextEnrichmentSuggestions,
  reviewCompanyContextEnrichmentSuggestion,
  runCompanyContextEnrichment,
} from '../../../backend/services/companyContextEnrichmentService';
import { calculateIntelligenceReadiness } from '../../../backend/services/companyContextIntelligenceService';
import { getProfile } from '../../../backend/services/companyProfileService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId =
    (req.query.companyId as string | undefined) ||
    (body.companyId as string | undefined) ||
    (body.company_id as string | undefined);

  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const actorUserId = UUID_RE.test(access.userId) ? access.userId : null;

  if (req.method === 'GET') {
    try {
      const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
      const run = String(req.query.run ?? '') === '1';
      if (run) {
        const enrichment = await runCompanyContextEnrichment({
          companyId,
          profile,
          actorUserId,
          persist: true,
        });
        return res.status(200).json({
          suggestions: enrichment.suggestions,
          context_quality: enrichment.quality,
          intelligence_readiness: enrichment.readiness,
          enrichment_run: enrichment.run,
        });
      }
      return res.status(200).json({
        suggestions: await getCompanyContextEnrichmentSuggestions(companyId),
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message || 'Failed to load enrichment suggestions' });
    }
  }

  if (req.method === 'POST') {
    try {
      const normalizedRole = String(access.role ?? '').toUpperCase();
      if (!['SUPER_ADMIN', 'CONTENT_ARCHITECT', 'CAMPAIGN_ARCHITECT', 'COMPANY_ADMIN', 'ADMIN'].includes(normalizedRole)) {
        return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      }

      const action = String(body.action || '');
      if (action === 'run') {
        const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
        const enrichment = await runCompanyContextEnrichment({
          companyId,
          profile,
          actorUserId,
          persist: true,
        });
        return res.status(200).json({
          suggestions: enrichment.suggestions,
          context_quality: enrichment.quality,
          intelligence_readiness: enrichment.readiness,
          enrichment_run: enrichment.run,
        });
      }

      if (!['accepted', 'rejected', 'modified', 'snoozed'].includes(action)) {
        return res.status(400).json({ error: 'Unsupported enrichment action' });
      }
      const suggestionId = String(body.suggestionId || body.suggestion_id || '');
      if (!suggestionId) return res.status(400).json({ error: 'suggestionId is required' });
      const result = await reviewCompanyContextEnrichmentSuggestion({
        companyId,
        suggestionId,
        action: action as 'accepted' | 'rejected' | 'modified' | 'snoozed',
        actorUserId,
        modifiedPayload: typeof body.modifiedPayload === 'object' && body.modifiedPayload !== null
          ? body.modifiedPayload as Record<string, unknown>
          : null,
        reviewNote: typeof body.reviewNote === 'string' ? body.reviewNote : null,
      });
      const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
      return res.status(200).json({
        suggestions: result.suggestions,
        intelligence_context: result.intelligence_context,
        context_quality: result.quality,
        intelligence_readiness: calculateIntelligenceReadiness({ intelligence: result.intelligence_context, profile }),
      });
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message || 'Failed to review enrichment suggestion' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
