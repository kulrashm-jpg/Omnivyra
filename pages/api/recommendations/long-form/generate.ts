import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import {
  generateLongFormRecommendations,
  InsufficientFoundationError,
} from '../../../../backend/services/longForm/longFormRecommendationEngine';
import {
  CONTENT_ALIGNMENT_MODES,
  type ContentAlignmentMode,
  type GenerateLongFormRecommendationsRequest,
  MAX_RECOMMENDATION_LIMIT,
} from '../../../../backend/services/longForm/longFormRecommendationTypes';
import {
  LONG_FORM_CONTENT_TYPES,
  type LongFormContentType,
} from '../../../../lib/content/longFormContentTypeConfig';

function asContentAlignmentMode(value: unknown): ContentAlignmentMode | null {
  return typeof value === 'string' && (CONTENT_ALIGNMENT_MODES as readonly string[]).includes(value)
    ? (value as ContentAlignmentMode)
    : null;
}

function asContentTypes(value: unknown): LongFormContentType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const allowed = new Set<string>(LONG_FORM_CONTENT_TYPES);
  const cleaned = value
    .map((v) => (typeof v === 'string' ? v : ''))
    .filter((v) => allowed.has(v)) as LongFormContentType[];
  return cleaned.length > 0 ? cleaned : undefined;
}

function asSeedTopics(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)
    .slice(0, 10);
  return cleaned.length > 0 ? cleaned : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    companyId,
    requestedMode,
    contentTypes,
    limit,
    seedTopics,
    cacheVersion,
  } = (req.body ?? {}) as Partial<GenerateLongFormRecommendationsRequest> & { cacheVersion?: string };

  if (typeof companyId !== 'string' || companyId.trim().length === 0) {
    return res.status(400).json({ error: 'companyId is required' });
  }

  const mode = asContentAlignmentMode(requestedMode) ?? 'hybrid_editorial';

  const resolvedLimit =
    typeof limit === 'number' && limit > 0
      ? Math.min(Math.floor(limit), MAX_RECOMMENDATION_LIMIT)
      : undefined;

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId,
    requireCampaignId: false,
  });
  if (!access) return;

  try {
    const result = await generateLongFormRecommendations({
      companyId,
      requestedMode: mode,
      contentTypes: asContentTypes(contentTypes),
      limit: resolvedLimit,
      seedTopics: asSeedTopics(seedTopics),
      cacheVersion,
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof InsufficientFoundationError) {
      return res.status(422).json({
        error: 'INSUFFICIENT_COMPANY_CONTEXT',
        detail: err.message,
        foundationSignature: err.foundation.signature,
        foundationCompletion: err.foundation.completion,
        populatedSections: err.foundation.populatedSections,
      });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('LONG_FORM_RECOMMENDATIONS_FAILED', { companyId, error: message });
    return res.status(500).json({ error: 'LONG_FORM_RECOMMENDATIONS_FAILED', detail: message });
  }
}
