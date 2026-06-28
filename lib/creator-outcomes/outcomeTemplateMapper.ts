/**
 * Outcome → Template mapper (CREATOR-044, STEP 2).
 *
 *   Outcome → RecommendationContext → existing recommendTemplatesForContext()
 *           → top-ranked template → fallback to defaultTemplateId
 *
 * Reuses the EXISTING recommendation engine unchanged. The candidate set is
 * scoped to the outcome's own templates for the chosen family, so the result is
 * always within the outcome and fully deterministic. No new recommendation
 * logic, no runtime duplication.
 */

import type { CreatorTemplate, TemplateAssetFamily } from '../creator-templates/types';
import { getTemplateById } from '../creator-templates';
import { recommendTemplatesForContext, type RecommendationContext } from '../creator-templates/templateRecommendation';
import { getOutcome, type CreatorOutcome } from './outcomeRegistry';

export interface OutcomeResolveExtras {
  industry?: string | null;
  audience?: string | null;
  platform?: string | null;
  contentLength?: RecommendationContext['contentLength'];
}

export interface OutcomeResolution {
  outcomeId: string;
  family: TemplateAssetFamily;
  templateId: string;
  source: 'recommended' | 'default';
  /** Editor URL the existing seam expects — unchanged downstream. */
  editorUrl: string;
}

/** Build the recommendation context for an (outcome, family) — maps outcome metadata to recommender inputs. */
export function buildRecommendationContext(outcome: CreatorOutcome, family: TemplateAssetFamily, extras: OutcomeResolveExtras = {}): RecommendationContext {
  return {
    assetFamily: family,
    objective: outcome.objective,
    funnelStage: outcome.funnelStage,
    contentType: outcome.tags[0] ?? outcome.label,
    strategy: outcome.category,
    industry: extras.industry ?? null,
    audience: extras.audience ?? null,
    platform: extras.platform ?? null,
    contentLength: extras.contentLength ?? null,
  };
}

/** Candidate templates for an (outcome, family), resolved from the canonical membership. */
export function outcomeCandidates(outcome: CreatorOutcome, family: TemplateAssetFamily): CreatorTemplate[] {
  const ids = outcome.templateIds[family] ?? [];
  return ids.map((id) => getTemplateById(id, family)).filter((t): t is CreatorTemplate => !!t);
}

/**
 * Resolve an (outcome, family) to a concrete template via the existing recommender,
 * falling back deterministically to the outcome's default template for that family.
 * Returns null only if the family is not supported by the outcome.
 */
export function resolveOutcomeTemplate(outcomeId: string, family: TemplateAssetFamily, extras: OutcomeResolveExtras = {}): OutcomeResolution | null {
  const outcome = getOutcome(outcomeId);
  if (!outcome) return null;
  if (!outcome.supportedFamilies.includes(family)) return null;

  const candidates = outcomeCandidates(outcome, family);
  let templateId: string | undefined;
  let source: 'recommended' | 'default' = 'default';

  if (candidates.length > 0) {
    const ctx = buildRecommendationContext(outcome, family, extras);
    const result = recommendTemplatesForContext(candidates, ctx, 1);
    const top = result.recommended?.template?.id ?? result.top?.[0]?.template?.id;
    if (top) { templateId = top; source = 'recommended'; }
  }
  if (!templateId) { templateId = outcome.defaultTemplateIds[family]; source = 'default'; }
  if (!templateId) return null;

  return { outcomeId, family, templateId, source, editorUrl: `/command-center/creator-content/${family}?template_id=${encodeURIComponent(templateId)}` };
}
