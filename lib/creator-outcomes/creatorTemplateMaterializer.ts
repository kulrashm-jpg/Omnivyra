/**
 * CreatorTemplateMaterializer (CREATOR-124) — the ONE canonical builder that turns
 * a curated design into a FULLY MATERIALIZED CreatorTemplate.
 *
 * Responsibility (and nothing else): collect every runtime lookup a curated
 * design currently resolves through the blueprint runtime (generation DNA, layout,
 * composition, semantic structure, visual style, locked/editable regions,
 * adaptation, preview), resolve them ONCE, and emit a single self-contained
 * CreatorTemplate. After materialization the object depends on NO registry.
 *
 * This is DATA ONLY (RULE 9): it builds objects. It does not render, plan,
 * generate, switch runtime, or delete anything. It reuses the EXACT existing
 * derivation (`marketingSample.toSample` + `styleVariants`) so a materialized
 * SYSTEM template reproduces the curated sample byte-for-byte — the same
 * functions the renderer calls today (`infographicLayoutForBlueprint`,
 * `infographicCompositionForBlueprint`, `semanticStructureForBlueprint`,
 * `infographicStyleForBlueprint`).
 */

import {
  type CreatorTemplate,
  type TemplateAssetFamily,
  type TemplateGenerationDNA,
  type TemplateFormDefinition,
  type TemplateRenderingContract,
  CREATOR_TEMPLATE_CONTRACT_VERSION,
  defaultAiAssist,
} from '../creator-templates/types';
import {
  infographicLayoutForBlueprint,
  infographicCompositionForBlueprint,
  semanticStructureForBlueprint,
  infographicStyleForBlueprint,
  styleFieldsForTemplate,
} from '../creator-templates/styleVariants';
import { VISUAL_BLUEPRINTS, getBlueprint } from './creatorVisualBlueprintRegistry';
import { getSample, type MarketingSample } from './marketingSample';

/** Stable id for a materialized curated SYSTEM template (unique per family). */
export function materializedTemplateId(blueprintId: string, family: TemplateAssetFamily): string {
  return `sys-curated-${blueprintId}-${family}`;
}

/** Map the derived GenerationDNA onto the template-carried shape (1:1, no loss). */
function dnaFromSample(s: MarketingSample): TemplateGenerationDNA {
  const d = s.generationDNA;
  return {
    composition: d.composition,
    hierarchy: d.hierarchy,
    typography: d.typography,
    colorLanguage: { primary: d.colorLanguage.primary, surface: d.colorLanguage.surface, contrast: d.colorLanguage.contrast },
    photography: d.photography,
    illustration: d.illustration,
    spacing: d.spacing,
    lighting: d.lighting,
    camera: d.camera,
    contrast: d.contrast,
    renderingStyle: d.renderingStyle,
    shapeLanguage: d.shapeLanguage,
    promptModifiers: d.promptModifiers,
    negativePromptModifiers: d.negativePromptModifiers,
  };
}

/** Minimal, family-appropriate default form so a materialized template is
 *  editor-complete (the renderer does not consume the form). */
function defaultForm(family: TemplateAssetFamily, sectionLabel: string): TemplateFormDefinition {
  const ai = defaultAiAssist();
  if (family === 'carousel') {
    return {
      fields: [{ key: 'cta', label: 'Call To Action', control: 'text', required: false, maxLength: 28, aiAssist: ai }],
      slides: {
        countOptions: [3, 4, 5, 6], defaultCount: 4,
        fields: [
          { key: 'title', label: 'Slide Title', control: 'text', required: true, maxLength: 60, aiAssist: ai },
          { key: 'body', label: 'Slide Body', control: 'textarea', required: false, maxLength: 160, aiAssist: ai },
        ],
      },
    };
  }
  if (family === 'infographic') {
    return {
      fields: [{ key: 'headline', label: 'Headline', control: 'textarea', required: true, maxLength: 80, aiAssist: ai }],
      sections: {
        kind: 'repeatable', min: 2, max: 6, sectionLabel,
        fields: [
          { key: 'title', label: sectionLabel, control: 'text', required: true, maxLength: 40, aiAssist: ai },
          { key: 'description', label: 'Detail', control: 'textarea', required: false, maxLength: 120, aiAssist: ai },
        ],
      },
    };
  }
  return {
    fields: [
      { key: 'headline', label: 'Headline / Image Text', control: 'textarea', required: true, maxLength: 80, aiAssist: ai },
      { key: 'subheadline', label: 'Subheadline', control: 'textarea', required: false, maxLength: 120, aiAssist: ai },
      { key: 'cta', label: 'Call To Action', control: 'text', required: false, maxLength: 28, aiAssist: ai },
    ],
  };
}

/** Human label for the infographic section, by layout (mirrors the renderer's roles). */
const SECTION_LABEL_BY_LAYOUT: Record<string, string> = {
  stats: 'Statistic', process: 'Step', comparison: 'Option', framework: 'Pillar', hierarchy: 'Level', timeline: 'Milestone',
};

function renderingContract(family: TemplateAssetFamily, layout: string): TemplateRenderingContract {
  const V = CREATOR_TEMPLATE_CONTRACT_VERSION;
  if (family === 'infographic') return { renderingContractVersion: V, family, infographicLayout: layout, writerAssetType: 'infographic' };
  if (family === 'carousel') return { renderingContractVersion: V, family, writerAssetType: 'carousel', frameCount: 4 };
  return { renderingContractVersion: V, family, purposeKey: 'promotional-image', subtype: 'promotional-image', attachmentMode: 'embedded_copy', writerAssetType: 'banner' };
}

/**
 * Materialize ONE curated design (blueprint id + family) into a fully self-contained
 * CreatorTemplate. Returns null only when the blueprint id is unknown or the family
 * is unsupported by that blueprint.
 */
export function materializeCuratedTemplate(blueprintId: string, family: TemplateAssetFamily): CreatorTemplate | null {
  const bp = getBlueprint(blueprintId);
  const sample = getSample(blueprintId);
  if (!bp || !sample) return null;
  if (!bp.supportedFamilies.includes(family)) return null;

  const layout = infographicLayoutForBlueprint(blueprintId);
  const dna = dnaFromSample(sample);
  const isInfographic = family === 'infographic';

  // Visual style — the EXACT source the renderer uses: infographic via
  // infographicStyleForBlueprint (matches resolveInfographicRenderStyle); image/
  // carousel via the family variant resolver.
  const infographicStyle = isInfographic ? infographicStyleForBlueprint(blueprintId) : undefined;
  const { imageStyle } = family === 'image' ? styleFieldsForTemplate(blueprintId, 'image') : { imageStyle: undefined };
  const { carouselStyle } = family === 'carousel' ? styleFieldsForTemplate(blueprintId, 'carousel') : { carouselStyle: undefined };

  const previewImage = family === 'carousel' ? `/creator-showcases/${blueprintId}/carousel.png`
    : family === 'infographic' ? `/creator-showcases/${blueprintId}/infographic.png`
      : `/creator-showcases/${blueprintId}/image.png`;

  return {
    id: materializedTemplateId(blueprintId, family),
    assetFamily: family,
    name: sample.title,
    category: sample.designSystem,
    description: sample.description,
    preview: { thumbnailUrl: previewImage, sampleAssetUrl: null, sample: {} },
    visualLanguage: {
      accent: dna.colorLanguage.primary,
      surface: dna.colorLanguage.surface,
      densityBias: 'balanced',
      brandingIntensity: 'balanced',
      typographyWeight: 'lead',
    },
    formDefinition: defaultForm(family, SECTION_LABEL_BY_LAYOUT[layout] ?? 'Section'),
    renderingContract: renderingContract(family, layout),
    infographicStyle,
    imageStyle,
    carouselStyle,
    version: 1,
    status: 'published',
    ownership: 'system',
    tags: [...(sample.industryTags ?? []), ...(sample.audienceTags ?? [])],
    // Provenance + adaptation metadata kept on metadata so it serializes flat.
    metadata: {
      sourceBlueprintId: blueprintId,
      source: 'SYSTEM',
      supportedFamilies: [...bp.supportedFamilies],
      businessPurpose: sample.businessPurpose,
      businessGoal: sample.businessGoal,
      industryTags: sample.industryTags,
      audienceTags: sample.audienceTags,
      previewRecipe: sample.previewRecipe,
      generationRecipe: sample.generationRecipe,
    },
    // ── Canonical design intelligence (CREATOR-123 fields, CREATOR-124 populated) ──
    designFamily: sample.designSystem,
    generationDNA: dna,
    semanticStructure: isInfographic ? semanticStructureForBlueprint(blueprintId) : undefined,
    composition: isInfographic ? infographicCompositionForBlueprint(blueprintId) : undefined,
    lockedRegions: [...sample.lockedRegions],
    editableRegions: [...sample.editableRegions],
    adaptation: { immutable: [...sample.generationDNA.adaptation.immutable], adaptable: [...sample.generationDNA.adaptation.adaptable] },
  };
}

/** Materialize EVERY curated design across all supported families. Data only. */
export function materializeAllCuratedTemplates(family?: TemplateAssetFamily): CreatorTemplate[] {
  const out: CreatorTemplate[] = [];
  const families: TemplateAssetFamily[] = family ? [family] : ['image', 'carousel', 'infographic'];
  for (const bp of VISUAL_BLUEPRINTS) {
    for (const fam of families) {
      if (!bp.supportedFamilies.includes(fam)) continue;
      const t = materializeCuratedTemplate(bp.id, fam);
      if (t) out.push(t);
    }
  }
  return out;
}
