/**
 * Idea Spine Service
 * Normalizes incoming context from recommendations, opportunities, or direct idea
 * for the Campaign Planner.
 */

export type IdeaSpineOrigin = 'direct' | 'recommendation' | 'opportunity';

export interface NormalizedIdeaSpine {
  title: string;
  description: string;
  origin: IdeaSpineOrigin;
  source_id: string | null;
  /** Additional metadata preserved from source */
  metadata?: Record<string, unknown>;
}

export interface RecommendationContextInput {
  trend_topic?: string | null;
  polished_title?: string | null;
  topic?: string | null;
  title?: string | null;
  summary?: string | null;
  id?: string | null;
  [key: string]: unknown;
}

export interface OpportunityContextInput {
  title?: string | null;
  summary?: string | null;
  id?: string | null;
  [key: string]: unknown;
}

export interface DirectIdeaInput {
  free_text?: string | null;
  title?: string | null;
  description?: string | null;
}

/**
 * Normalize incoming context to a consistent idea spine format.
 */
export function normalizeIdeaSpineInput(input: {
  recommendation?: RecommendationContextInput | null;
  opportunity?: OpportunityContextInput | null;
  direct_idea?: DirectIdeaInput | null;
}): NormalizedIdeaSpine {
  if (input.recommendation && typeof input.recommendation === 'object') {
    return normalizeFromRecommendation(input.recommendation);
  }
  if (input.opportunity && typeof input.opportunity === 'object') {
    return normalizeFromOpportunity(input.opportunity);
  }
  if (input.direct_idea && typeof input.direct_idea === 'object') {
    return normalizeFromDirectIdea(input.direct_idea);
  }
  return {
    title: '',
    description: '',
    origin: 'direct',
    source_id: null,
  };
}

function normalizeFromRecommendation(rec: RecommendationContextInput): NormalizedIdeaSpine {
  const title =
    (typeof rec.polished_title === 'string' && rec.polished_title.trim()) ||
    (typeof rec.trend_topic === 'string' && rec.trend_topic.trim()) ||
    (typeof rec.topic === 'string' && rec.topic.trim()) ||
    (typeof rec.title === 'string' && rec.title.trim()) ||
    '';
  const description =
    (typeof rec.summary === 'string' && rec.summary.trim()) || '';
  const source_id =
    typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : null;
  return {
    title: title || 'Untitled campaign from recommendation',
    description,
    origin: 'recommendation',
    source_id,
    metadata: rec,
  };
}

function normalizeFromOpportunity(opp: OpportunityContextInput): NormalizedIdeaSpine {
  const title =
    (typeof opp.title === 'string' && opp.title.trim()) || '';
  const description =
    (typeof opp.summary === 'string' && opp.summary.trim()) || '';
  const source_id =
    typeof opp.id === 'string' && opp.id.trim() ? opp.id.trim() : null;
  return {
    title: title || 'Untitled campaign from opportunity',
    description,
    origin: 'opportunity',
    source_id,
    metadata: opp,
  };
}

function normalizeFromDirectIdea(direct: DirectIdeaInput): NormalizedIdeaSpine {
  const title =
    (typeof direct.title === 'string' && direct.title.trim()) || '';
  const desc =
    (typeof direct.description === 'string' && direct.description.trim()) || '';
  const freeText =
    (typeof direct.free_text === 'string' && direct.free_text.trim()) || '';
  const description = desc || freeText;
  const extractedTitle = title || (freeText ? freeText.slice(0, 100) : '');
  return {
    title: extractedTitle || 'New campaign idea',
    description: title ? freeText : description,
    origin: 'direct',
    source_id: null,
  };
}
