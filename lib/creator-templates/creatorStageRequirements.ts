/**
 * Creator Stage Requirements — the ONE canonical source of truth for which
 * optional Creator workflow stages (Blueprint, Content Ingestion) a given
 * template/asset REQUIRES.
 *
 * Routing/UI must never encode stage requirements; they ask a single helper
 * (`canSkipBlueprint` / `canSkipContentIngestion`). Resolution priority:
 *
 *   Template Contract  (template.stageRequirements)
 *        ↓
 *   Asset Type Contract (ASSET_TYPE_STAGE_DEFAULTS, keyed by asset family)
 *        ↓
 *   System Default     (everything optional → skippable)
 *
 * Reusable, unmodified, by Creator / Writer / Campaign Creator / Automation / API.
 * Deterministic + pure. Today no template or asset declares a requirement, so all
 * stages are skippable — byte-identical to the previous constant behavior.
 */

import type { CreatorTemplate, CreatorStageRequirementOverride, TemplateAssetFamily } from './types';

export type CreatorStage = 'blueprint' | 'contentIngestion';

export interface StageRequirements {
  requiresBlueprint: boolean;
  requiresContentIngestion: boolean;
}

/** System default — both optional. Preserves current behavior (all skippable). */
const SYSTEM_DEFAULT: StageRequirements = {
  requiresBlueprint: false,
  requiresContentIngestion: false,
};

/**
 * Asset-type contract — per asset-family stage defaults that override the system
 * default. Empty today (every family inherits the system default → no behavior
 * change). A new asset family that needs a stage adds ONE entry here; no routing
 * or UI change required.
 */
const ASSET_TYPE_STAGE_DEFAULTS: Partial<Record<TemplateAssetFamily, CreatorStageRequirementOverride>> = {
  // e.g. infographic: { requiresContentIngestion: true },  // <- metadata-only future change
};

/** Resolve the effective stage requirements (Template > Asset > Default). */
export function resolveStageRequirements(template?: CreatorTemplate | null): StageRequirements {
  const assetDefaults: CreatorStageRequirementOverride = template ? (ASSET_TYPE_STAGE_DEFAULTS[template.assetFamily] ?? {}) : {};
  const templateContract: CreatorStageRequirementOverride = template?.stageRequirements ?? {};
  return {
    requiresBlueprint: templateContract.requiresBlueprint ?? assetDefaults.requiresBlueprint ?? SYSTEM_DEFAULT.requiresBlueprint,
    requiresContentIngestion: templateContract.requiresContentIngestion ?? assetDefaults.requiresContentIngestion ?? SYSTEM_DEFAULT.requiresContentIngestion,
  };
}

/** True when the Blueprint stage may be skipped for this template (i.e. not required). */
export function canSkipBlueprint(template?: CreatorTemplate | null): boolean {
  return !resolveStageRequirements(template).requiresBlueprint;
}

/** True when the Content Ingestion stage may be skipped for this template (i.e. not required). */
export function canSkipContentIngestion(template?: CreatorTemplate | null): boolean {
  return !resolveStageRequirements(template).requiresContentIngestion;
}

/** Generic accessor — true when `stage` may be skipped for this template. */
export function canSkipStage(stage: CreatorStage, template?: CreatorTemplate | null): boolean {
  return stage === 'blueprint' ? canSkipBlueprint(template) : canSkipContentIngestion(template);
}
