/**
 * Population Projection Bridge (CREATOR-034). The single deterministic
 * reconciliation layer between the resolved template variant and the existing
 * Template Population output. Template Population (frozen) emits one slot per
 * assembly asset; this bridge PROJECTS that population onto the resolved
 * template's count by TRUNCATION ONLY — keeping the first N slides/sections,
 * preserving headline/body/statistics/quotes/CTA/hierarchy/ownership/field-ids/
 * provenance/ordering. It creates no content, regenerates nothing, repopulates
 * nothing, and changes no ownership. The output IS a CreatorTemplatePopulation,
 * so Structured Creative Generation and Creative Verification consume it
 * unchanged.
 */

import type { CreatorTemplate } from './types';
import type { CreatorTemplatePopulation } from './templatePopulation';

export interface ProjectedTemplatePopulation extends CreatorTemplatePopulation {
  projection: {
    family: string;
    resolvedTemplateId: string;
    targetCount: number | null;
    sourceCount: number;
    truncated: number;          // slots dropped (source - target)
  };
}

function resolvedCount(template: CreatorTemplate): number | null {
  if (template.assetFamily === 'carousel' && template.formDefinition.slides) return template.formDefinition.slides.defaultCount;
  if (template.assetFamily === 'infographic' && template.formDefinition.sections) return template.formDefinition.sections.min; // resolver pins min === max === N
  return null;
}

/* ── Projection (STEP 2/3) — truncation only, no transformation ────────── */

export function projectPopulation(population: CreatorTemplatePopulation, resolved: CreatorTemplate): ProjectedTemplatePopulation {
  const family = resolved.assetFamily;
  const target = resolvedCount(resolved);

  let slides = population.slides;
  let sections = population.sections;
  let sourceCount = 0;

  if (family === 'carousel' && target != null) {
    sourceCount = population.slides.length;
    slides = population.slides.slice(0, target);          // keep the FIRST N, verbatim
  } else if (family === 'infographic' && target != null) {
    sourceCount = population.sections.length;
    sections = population.sections.slice(0, target);
  } else {
    sourceCount = population.slides.length + population.sections.length;
  }

  return {
    ...population,                                          // ownership, coverage, metadata preserved
    templateId: resolved.id,
    slides,
    sections,
    projection: {
      family,
      resolvedTemplateId: resolved.id,
      targetCount: target,
      sourceCount,
      truncated: target != null ? Math.max(0, sourceCount - target) : 0,
    },
  };
}

/* ── Validation diagnostics (STEP 5) ───────────────────────────────────── */

export interface ProjectionValidation {
  ok: boolean;
  countMatches: boolean;
  duplicateSlots: boolean;
  missingRequired: string[];
  orphaned: boolean;
  findings: string[];
}

export function validateProjection(projected: ProjectedTemplatePopulation, resolved: CreatorTemplate): ProjectionValidation {
  const findings: string[] = [];
  const target = projected.projection.targetCount;
  const family = resolved.assetFamily;

  const actual = family === 'carousel' ? projected.slides.length : family === 'infographic' ? projected.sections.length : 0;
  const countMatches = target == null || actual === target;
  if (!countMatches) findings.push(`Projected count ${actual} ≠ resolved template count ${target}.`);

  // No duplicated slots (after truncation).
  const rows = family === 'carousel' ? projected.slides : projected.sections;
  const stamps = rows.map((r) => JSON.stringify(r));
  const duplicateSlots = new Set(stamps).size !== stamps.length;
  if (duplicateSlots) findings.push('Duplicated slot content in the projected population.');

  // Required slot fields filled (slide title / section label).
  const missingRequired: string[] = [];
  const slotFields = family === 'carousel' ? resolved.formDefinition.slides?.fields ?? [] : resolved.formDefinition.sections?.fields ?? [];
  rows.forEach((row, i) => {
    for (const f of slotFields) if (f.required && !(row[f.key] && row[f.key].trim())) missingRequired.push(`${family === 'carousel' ? 'slide' : 'section'}:${i}:${f.key}`);
  });

  // No orphaned population (every kept row has the resolved template's fields).
  const orphaned = rows.some((row) => slotFields.length > 0 && !slotFields.every((f) => Object.prototype.hasOwnProperty.call(row, f.key)));
  if (orphaned) findings.push('Orphaned population — a projected row is missing template field ids.');

  return { ok: countMatches && !duplicateSlots && missingRequired.length === 0 && !orphaned, countMatches, duplicateSlots, missingRequired, orphaned, findings };
}
