/**
 * Curated Creator Template Showcase repository (CREATOR-053).
 *
 * A showcase is NOT generated, NOT rendered, NOT AI. It is a curated finished
 * marketing creative (an ordinary image). The browser reads ONLY this repository
 * and displays the images directly — like Canva / Adobe Express / Envato.
 *
 * Source: content/creator-showcases/showcases.json (index) + image files under
 * public/creator-showcases/<templateId>/. Curated by humans / dropped-in assets —
 * no build step, no generator, no render metadata, no prompts.
 */

import showcasesJson from '../../content/creator-showcases/showcases.json';
import type { TemplateAssetFamily } from '../creator-templates/types';
import { getOutcome } from './outcomeRegistry';

/** The canonical showcase model — curated fields only, nothing runtime. */
export interface CreatorTemplateShowcase {
  id: string;
  templateId: string;
  title: string;
  description: string;
  industry: string;
  audience: string;
  businessOutcome: string;       // outcome id
  visualStyle: string;           // visual style id
  family: TemplateAssetFamily;
  thumbnailUrl: string;          // curated image (gallery card)
  previewUrl: string;            // curated image (detail)
  slides?: string[];             // optional carousel slide images
  tags: string[];
  featured: boolean;
  order: number;
}

const ALL: CreatorTemplateShowcase[] = (((showcasesJson as { showcases?: unknown[] }).showcases ?? []) as CreatorTemplateShowcase[])
  .filter((s) => s && typeof s.thumbnailUrl === 'string' && s.thumbnailUrl.length > 0);

const byTemplate = new Map<string, CreatorTemplateShowcase[]>();
for (const s of ALL) { const list = byTemplate.get(s.templateId) ?? []; list.push(s); byTemplate.set(s.templateId, list); }

const sortShowcases = (a: CreatorTemplateShowcase, b: CreatorTemplateShowcase): number =>
  (Number(b.featured) - Number(a.featured)) || (a.order - b.order) || a.id.localeCompare(b.id);

/** Curated showcases for one template (8–15 when fully populated). */
export function getShowcasesForTemplate(templateId: string): CreatorTemplateShowcase[] {
  return [...(byTemplate.get(templateId) ?? [])].sort(sortShowcases);
}

export interface ShowcaseFilter { visualStyle?: string | null; industry?: string | null }

/** Curated showcases for an outcome + family, optionally filtered by style/industry. */
export function getShowcasesForOutcome(outcomeId: string, family: TemplateAssetFamily, filter: ShowcaseFilter = {}): CreatorTemplateShowcase[] {
  const outcome = getOutcome(outcomeId);
  if (!outcome) return [];
  const templateIds = new Set(outcome.templateIds[family] ?? []);
  return ALL
    .filter((s) => s.family === family && templateIds.has(s.templateId))
    .filter((s) => !filter.visualStyle || s.visualStyle === filter.visualStyle)
    .filter((s) => !filter.industry || s.industry.toLowerCase() === filter.industry.toLowerCase())
    .sort(sortShowcases);
}

export function outcomeHasShowcases(outcomeId: string, family: TemplateAssetFamily): boolean {
  return getShowcasesForOutcome(outcomeId, family).length > 0;
}

/** Curated showcases for a visual style/blueprint (used by blueprint previews). */
export function getShowcasesByVisualStyle(visualStyle: string, family?: TemplateAssetFamily): CreatorTemplateShowcase[] {
  return ALL.filter((s) => s.visualStyle === visualStyle && (!family || s.family === family)).sort(sortShowcases);
}

/** Distinct visual styles present in the curated showcases for an outcome+family. */
export function listShowcaseStyles(outcomeId: string, family: TemplateAssetFamily): string[] {
  return Array.from(new Set(getShowcasesForOutcome(outcomeId, family).map((s) => s.visualStyle)));
}

export function repositoryStats(): { total: number; templates: number; outcomes: number } {
  return { total: ALL.length, templates: byTemplate.size, outcomes: new Set(ALL.map((s) => s.businessOutcome)).size };
}
