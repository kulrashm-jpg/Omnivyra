/**
 * Campaign Plan Validation — template-aware planning gate (CAMPAIGN-003).
 *
 * Resolves each planned asset's selected template (system OR user, registering
 * user templates via the canonical runtime flow) and validates the plan against
 * the template's rendering contract + form definition using the pure
 * `plannerContract` validators. No renderer/generation/template change.
 */

import {
  getTemplateById, familyForCreatorType,
  validatePlannedAsset, validateCampaignPlan,
  type CreatorTemplate, type PlannedAsset, type PlannedAssetValidation, type CampaignPlanValidation,
} from '../../../lib/creator-templates';
import { loadAndRegisterUserTemplate } from './userTemplateService';

type Rec = Record<string, unknown>;
function str(v: unknown): string { return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); }
function num(v: unknown): number | undefined { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }

/** Resolve a plan template by id — system first, then load+register a user template. */
export async function resolvePlanTemplate(templateId: string): Promise<CreatorTemplate | null> {
  const id = str(templateId);
  if (!id) return null;
  const sys = getTemplateById(id);
  if (sys) return sys;
  await loadAndRegisterUserTemplate(id);
  return getTemplateById(id) ?? null;
}

/** Project a creator_card onto a PlannedAsset (template_id + planned params). */
export function plannedAssetFromCard(card: Rec, contentType: string): PlannedAsset | null {
  const templateId = str(card.template_id);
  if (!templateId) return null;
  const family = familyForCreatorType(contentType) ?? undefined;
  const sections = Array.isArray(card.infographic_sections) ? card.infographic_sections.length : undefined;
  return {
    templateId,
    label: contentType,
    assetFamily: family,
    slideCount: num(card.slide_count),
    sectionCount: sections,
    layout: str(card.infographic_layout) || undefined,
    banner: str(card.writer_asset_type) === 'banner' || undefined,
  };
}

/**
 * Validate a single planned creator_card against its selected template. Returns
 * null when the card carries no template. When the template can't be resolved,
 * returns ok (graceful — the renderer falls back to the default style, so legacy
 * / stale-template campaigns are never broken); resolved-but-incompatible plans
 * return explicit errors.
 */
export async function validatePlannedCard(card: Rec, contentType: string): Promise<PlannedAssetValidation | null> {
  const planned = plannedAssetFromCard(card, contentType);
  if (!planned) return null;
  const template = await resolvePlanTemplate(planned.templateId);
  if (!template) return { ok: true, errors: [], descriptor: null }; // graceful: unresolved → default
  return validatePlannedAsset(template, planned);
}

/**
 * Project planner activities onto PlannedAsset[] — including ONLY activities that
 * ALREADY carry a template selection (template_id on the activity or its
 * creator_card). Planner intent is read verbatim where present (slide/section
 * count, layout, CTA, banner); nothing is inferred. Activities without a template
 * carry no template intent and are not validated.
 */
export function plannedAssetsFromActivities(activities: unknown): PlannedAsset[] {
  const out: PlannedAsset[] = [];
  for (const raw of Array.isArray(activities) ? activities : []) {
    const a = (raw && typeof raw === 'object' ? raw : {}) as Rec;
    const card = (a.creator_card && typeof a.creator_card === 'object' ? a.creator_card : {}) as Rec;
    const templateId = str(a.template_id ?? card.template_id);
    if (!templateId) continue; // no template intent → not validated (no inference)
    const ct = str(a.content_type) || 'post';
    out.push({
      templateId,
      label: `${str(a.platform) || 'linkedin'} ${ct}${a.week_number ? ` · wk${a.week_number}` : ''}`,
      assetFamily: familyForCreatorType(ct) ?? undefined,
      slideCount: num(a.slide_count ?? a.desired_slide_count ?? card.slide_count),
      sectionCount: num(a.section_count ?? a.desired_section_count),
      layout: str(a.infographic_layout ?? a.layout) || undefined,
      requiresCTA: a.requires_cta === true || undefined,
      banner: (str(a.writer_asset_type ?? card.writer_asset_type) === 'banner') || undefined,
    });
  }
  return out;
}

/** Validate a whole campaign plan (multi-asset, mixed families) before approval. */
export async function validateCampaignPlanAssets(planned: PlannedAsset[]): Promise<CampaignPlanValidation> {
  const items = await Promise.all(planned.map(async (p) => ({ planned: p, template: await resolvePlanTemplate(p.templateId) })));
  return validateCampaignPlan(items);
}
