/**
 * Planner Contract — template-aware campaign planning intelligence.
 *
 * Pure + deterministic. Given a planned asset's selected template, derives the
 * planning facts the planner needs (asset structure, slide/section counts,
 * layout, density, CTA availability, attachment mode) from the template's
 * canonical `renderingContract` + `formDefinition`, and validates a planned
 * asset (and a whole campaign plan) against it BEFORE generation. No
 * template-specific prompt engineering, no renderer/generation/architecture
 * change. Reuses the canonical model + `variantKeyForTemplate`; template-switch
 * migration uses the existing `migrateTemplateValues` (see ./values).
 */

import type { CreatorTemplate, TemplateAssetFamily } from './types';
import { variantKeyForTemplate } from './styleVariants';

/** Planning facts derived from a template's contract — what the planner plans against + displays. */
export interface TemplatePlanDescriptor {
  templateId: string;
  family: TemplateAssetFamily;
  name: string;
  category: string;
  variantKey: string;
  /** Infographic layout (stats/process/timeline/comparison/hierarchy/framework) or null. */
  layout: string | null;
  attachmentMode: string | null;
  purposeKey: string | null;
  /** visualLanguage.densityBias — planning density hint. */
  density: string | null;
  /** Carousel allowed slide counts + default (frameCount). */
  slideCountOptions: number[] | null;
  defaultSlideCount: number | null;
  /** Infographic section bounds. */
  sectionMin: number | null;
  sectionMax: number | null;
  /** The template exposes a CTA field. */
  hasCTA: boolean;
  /** Renderer lane; 'banner' means the image-family banner lane. */
  writerAssetType: string | null;
  isBanner: boolean;
  requiredFields: string[];
}

export function describeTemplatePlan(template: CreatorTemplate): TemplatePlanDescriptor {
  const fd = template.formDefinition;
  const c = template.renderingContract;
  const requiredFields: string[] = [
    ...fd.fields.filter((f) => f.required).map((f) => f.key),
    ...((fd.slides?.fields ?? []).filter((f) => f.required).map((f) => `slide.${f.key}`)),
    ...((fd.sections?.fields ?? []).filter((f) => f.required).map((f) => `section.${f.key}`)),
  ];
  const allFields = [...fd.fields, ...(fd.slides?.fields ?? []), ...(fd.sections?.fields ?? [])];
  return {
    templateId: template.id,
    family: template.assetFamily,
    name: template.name,
    category: template.category,
    variantKey: variantKeyForTemplate(template.id, template.assetFamily),
    layout: c.infographicLayout ?? null,
    attachmentMode: c.attachmentMode ?? null,
    purposeKey: c.purposeKey ?? null,
    density: template.visualLanguage?.densityBias ?? null,
    slideCountOptions: fd.slides?.countOptions ? [...fd.slides.countOptions] : null,
    defaultSlideCount: fd.slides?.defaultCount ?? (typeof c.frameCount === 'number' ? c.frameCount : null),
    sectionMin: fd.sections?.min ?? null,
    sectionMax: fd.sections?.max ?? null,
    hasCTA: allFields.some((f) => f.key === 'cta'),
    writerAssetType: c.writerAssetType ?? null,
    isBanner: c.writerAssetType === 'banner' || template.category.toLowerCase() === 'banner',
    requiredFields,
  };
}

/** A planned asset's intent — the planner's chosen template + planned parameters. */
export interface PlannedAsset {
  /** The selected template id (system or registered user template). */
  templateId: string;
  /** Label for human-readable plan errors (e.g. "Day 2 · Carousel"). */
  label?: string;
  /** Intended asset family/type for this plan slot (mixed-family campaigns). */
  assetFamily?: TemplateAssetFamily | null;
  /** Planned slide count (carousel). */
  slideCount?: number | null;
  /** Planned section count (infographic). */
  sectionCount?: number | null;
  /** Planned infographic layout (e.g. 'timeline'). */
  layout?: string | null;
  /** The plan needs a call-to-action on this asset. */
  requiresCTA?: boolean;
  /** The plan slot is a banner. */
  banner?: boolean;
}

export interface PlannedAssetValidation {
  ok: boolean;
  errors: string[];
  descriptor: TemplatePlanDescriptor | null;
}

/**
 * Validate one planned asset against its selected (resolved) template. `template`
 * is the result of resolving `planned.templateId` (null when it didn't resolve).
 * Deterministic; explicit errors. Empty/unset planned params are not constrained.
 */
export function validatePlannedAsset(template: CreatorTemplate | null, planned: PlannedAsset): PlannedAssetValidation {
  const label = planned.label ? `${planned.label}: ` : '';
  if (!planned.templateId || !planned.templateId.trim()) {
    return { ok: false, errors: [`${label}No template selected.`], descriptor: null };
  }
  if (!template) {
    return { ok: false, errors: [`${label}Selected template "${planned.templateId}" could not be resolved.`], descriptor: null };
  }
  const d = describeTemplatePlan(template);
  const errors: string[] = [];

  if (planned.assetFamily && planned.assetFamily !== d.family) {
    errors.push(`${label}Planned ${planned.assetFamily} but the selected template is ${d.family}.`);
  }
  if (planned.banner && !d.isBanner) {
    errors.push(`${label}Banner planned but the selected template is not banner-capable.`);
  }
  if (typeof planned.slideCount === 'number' && d.slideCountOptions) {
    const allowed = d.slideCountOptions.includes(planned.slideCount) || planned.slideCount === d.defaultSlideCount;
    if (!allowed) errors.push(`${label}Planned ${planned.slideCount} slide(s) but the template allows ${d.slideCountOptions.join('/')}.`);
  }
  if (typeof planned.sectionCount === 'number' && (d.sectionMin != null || d.sectionMax != null)) {
    if (d.sectionMin != null && planned.sectionCount < d.sectionMin) errors.push(`${label}Planned ${planned.sectionCount} section(s) but the template requires at least ${d.sectionMin}.`);
    if (d.sectionMax != null && planned.sectionCount > d.sectionMax) errors.push(`${label}Planned ${planned.sectionCount} section(s) but the template allows at most ${d.sectionMax}.`);
  }
  if (planned.layout && d.layout && planned.layout !== d.layout) {
    errors.push(`${label}Planned a ${planned.layout} layout but the selected template renders ${d.layout}.`);
  }
  if (planned.requiresCTA && !d.hasCTA) {
    errors.push(`${label}Plan requires a call-to-action but the selected template has no CTA field.`);
  }

  return { ok: errors.length === 0, errors, descriptor: d };
}

export interface CampaignPlanValidation {
  ok: boolean;
  errors: string[];
  perAsset: Array<{ label: string; ok: boolean; errors: string[]; descriptor: TemplatePlanDescriptor | null }>;
}

/**
 * Validate a whole campaign plan (multi-asset, mixed families). The campaign is
 * approvable only when EVERY planned asset passes. Each item supplies its planned
 * intent + the resolved template (caller resolves via resolveTemplate / the
 * runtime registry so user templates validate identically to system ones).
 */
export function validateCampaignPlan(
  items: Array<{ planned: PlannedAsset; template: CreatorTemplate | null }>,
): CampaignPlanValidation {
  const perAsset = items.map((it, i) => {
    const r = validatePlannedAsset(it.template, it.planned);
    return { label: it.planned.label ?? `Asset ${i + 1}`, ok: r.ok, errors: r.errors, descriptor: r.descriptor };
  });
  const errors = perAsset.flatMap((a) => a.errors);
  return { ok: errors.length === 0, errors, perAsset };
}
