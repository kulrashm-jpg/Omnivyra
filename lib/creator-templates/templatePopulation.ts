/**
 * Template Population — the ONLY layer that fills a CreatorTemplate. Templates
 * become pure presentation: they never read Message / Communication / Journey /
 * Blueprint / Conversion / Visual Messaging. All content, hierarchy, conversion
 * and sequencing originate exclusively from the `AssetAssembly` (the single
 * canonical contract). Pure deterministic projection — same assembly + same
 * template → byte-identical population. No AI, no rendering, no template
 * redesign. Contains NO pixels / fonts / colors / coordinates.
 */

import type { AssetAssembly, AssetAssemblyUnit } from './assetAssembly';
import type { CreatorTemplate, TemplateField } from './types';

export type PopulationOwner =
  | 'AssetAssembly:Message' | 'AssetAssembly:VisualMessaging' | 'AssetAssembly:Conversion' | 'AssetAssembly:StoryBlueprint' | 'AssetAssembly';

export interface PopulationCoverage {
  headline: boolean; body: boolean; bullets: boolean; evidence: boolean; cta: boolean;
  hierarchy: boolean; visualIntent: boolean; conversion: boolean;
}

export interface CreatorTemplatePopulation {
  templateId: string;
  assetFamily: string;
  fields: Record<string, string>;
  slides: Array<Record<string, string>>;
  sections: Array<Record<string, string>>;
  ownership: Record<string, PopulationOwner>;
  coverage: PopulationCoverage;
  metadata: Record<string, unknown>;
}

/* ── Field-key → assembly value (single authoritative owner per key) ───── */

function ctaValue(asm: AssetAssembly): string {
  const ctaUnit = asm.assets.find((u) => u.hierarchy === 'CTA');
  if (ctaUnit && ctaUnit.cta) return ctaUnit.cta;
  const withCta = asm.assets.find((u) => u.cta);
  return withCta ? withCta.cta : '';
}

function valueForKey(key: string, unit: AssetAssemblyUnit | undefined, asm: AssetAssembly): { value: string; owner: PopulationOwner } {
  const k = key.toLowerCase();
  if (/headline|title|heading/.test(k)) return { value: unit ? unit.headline : asm.message.mainMessage, owner: 'AssetAssembly:VisualMessaging' };
  if (/subheadline|subtitle|body|description|summary|caption|text/.test(k)) return { value: unit ? unit.body : asm.message.summary, owner: 'AssetAssembly:VisualMessaging' };
  if (/cta|button|action/.test(k)) return { value: ctaValue(asm), owner: 'AssetAssembly:Conversion' };
  if (/quote|testimonial/.test(k)) return { value: unit ? unit.quote : '', owner: 'AssetAssembly:VisualMessaging' };
  if (/author|attribution/.test(k)) return { value: '', owner: 'AssetAssembly:VisualMessaging' };
  if (/stat|metric|value|number|percent|figure/.test(k)) return { value: unit ? unit.statistic : '', owner: 'AssetAssembly:VisualMessaging' };
  if (/bullet|list|point|item/.test(k)) return { value: unit ? unit.bullets.join(' • ') : '', owner: 'AssetAssembly:VisualMessaging' };
  if (/label|step|year|milestone|stage/.test(k)) return { value: unit ? unit.headline : '', owner: 'AssetAssembly:StoryBlueprint' };
  return { value: '', owner: 'AssetAssembly' };
}

/** A single virtual unit aggregating the assembly for flat (image-like) families. */
function aggregateUnit(asm: AssetAssembly): AssetAssemblyUnit | undefined {
  const hero = asm.assets.find((u) => u.hierarchy === 'Hero') ?? asm.assets[0];
  if (!hero) return undefined;
  const firstQuote = asm.assets.find((u) => u.quote);
  const firstStat = asm.assets.find((u) => u.statistic);
  return {
    ...hero,
    quote: firstQuote ? firstQuote.quote : hero.quote,
    statistic: firstStat ? firstStat.statistic : hero.statistic,
  };
}

/* ── Family projectors (one interface; future families register here) ──── */

export type PopulationFamily = 'image' | 'carousel' | 'infographic' | 'post' | 'thread' | 'blogImage' | 'newsletterImage' | 'guideImage' | 'whitepaperImage';
type ProjectorMode = 'flat' | 'slides' | 'sections';

/** The registry: every family maps to exactly one deterministic projector mode. */
export const FAMILY_PROJECTORS: Record<PopulationFamily, ProjectorMode> = {
  image: 'flat', post: 'flat', thread: 'flat', blogImage: 'flat', newsletterImage: 'flat', guideImage: 'flat', whitepaperImage: 'flat',
  carousel: 'slides', infographic: 'sections',
};

function fillFields(fields: TemplateField[], unit: AssetAssemblyUnit | undefined, asm: AssetAssembly, into: Record<string, string>, owners: Record<string, PopulationOwner>): void {
  for (const f of fields) {
    const { value, owner } = valueForKey(f.key, unit, asm);
    into[f.key] = value;
    owners[f.key] = owner;
  }
}

/** THE single population function — every family routes through here. */
export function populateTemplateFromAssembly(asm: AssetAssembly, template: CreatorTemplate, family: PopulationFamily = template.assetFamily): CreatorTemplatePopulation {
  const mode = FAMILY_PROJECTORS[family];
  const fields: Record<string, string> = {};
  const ownership: Record<string, PopulationOwner> = {};
  const slides: Array<Record<string, string>> = [];
  const sections: Array<Record<string, string>> = [];
  const agg = aggregateUnit(asm);

  // Flat / shared fields always fill from the aggregate (e.g. shared CTA).
  fillFields(template.formDefinition.fields, agg, asm, fields, ownership);

  if (mode === 'slides' && template.formDefinition.slides) {
    const slideFields = template.formDefinition.slides.fields;
    asm.assets.forEach((u) => {
      const row: Record<string, string> = {};
      const owners: Record<string, PopulationOwner> = {};
      fillFields(slideFields, u, asm, row, owners);
      slides.push(row);
    });
  }
  if (mode === 'sections' && template.formDefinition.sections) {
    const sectionFields = template.formDefinition.sections.fields;
    asm.assets.forEach((u) => {
      const row: Record<string, string> = {};
      const owners: Record<string, PopulationOwner> = {};
      fillFields(sectionFields, u, asm, row, owners);
      sections.push(row);
    });
  }

  const coverage: PopulationCoverage = {
    headline: asm.assets.some((u) => !!u.headline),
    body: asm.assets.some((u) => !!u.body),
    bullets: asm.assets.some((u) => u.bullets.length > 0),
    evidence: asm.assets.some((u) => !!u.statistic || !!u.quote || u.hierarchy === 'Evidence'),
    cta: !!ctaValue(asm),
    hierarchy: asm.assets.every((u) => !!u.hierarchy),
    visualIntent: asm.assets.every((u) => !!u.visualIntent),
    conversion: !!asm.conversion.goal,
  };

  return {
    templateId: template.id, assetFamily: family, fields, slides, sections, ownership, coverage,
    metadata: { mode, unitCount: asm.assets.length, blueprint: asm.storyBlueprint.id, conversionGoal: asm.conversion.goal },
  };
}

/* ── Validation ────────────────────────────────────────────────────────── */

export function validateTemplatePopulation(pop: CreatorTemplatePopulation, template: CreatorTemplate): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  // Required flat slots filled.
  for (const f of template.formDefinition.fields) {
    if (f.required && !pop.fields[f.key]) errors.push(`Required field "${f.key}" not filled.`);
  }
  // Family constraints: slide/section counts within the template's declared bounds.
  if (pop.slides.length) {
    const g = template.formDefinition.slides;
    if (g && !g.countOptions.includes(pop.slides.length) && (pop.slides.length < Math.min(...g.countOptions) || pop.slides.length > Math.max(...g.countOptions))) {
      errors.push(`Slide count ${pop.slides.length} outside template options.`);
    }
    template.formDefinition.slides?.fields.forEach((f) => {
      pop.slides.forEach((row, i) => { if (f.required && !row[f.key]) errors.push(`Slide ${i} missing required "${f.key}".`); });
    });
  }
  if (pop.sections.length) {
    const g = template.formDefinition.sections;
    if (g && (pop.sections.length < g.min || pop.sections.length > g.max)) errors.push(`Section count ${pop.sections.length} outside [${g?.min},${g?.max}].`);
  }
  // No accidental duplication: identical adjacent slide rows signal a population bug.
  for (let i = 1; i < pop.slides.length; i++) {
    if (JSON.stringify(pop.slides[i]) === JSON.stringify(pop.slides[i - 1])) errors.push(`Duplicate slide content at ${i}.`);
  }
  return { ok: errors.length === 0, errors };
}

/* ── Diagnostics + summary ─────────────────────────────────────────────── */

export interface PopulationSummary {
  family: string; filledFields: number; missingSlots: string[]; coverage: PopulationCoverage; coverageComplete: boolean; valid: boolean;
}
export function summarizeTemplatePopulation(pop: CreatorTemplatePopulation, template: CreatorTemplate): PopulationSummary {
  const filledFields = Object.values(pop.fields).filter(Boolean).length + pop.slides.reduce((a, r) => a + Object.values(r).filter(Boolean).length, 0) + pop.sections.reduce((a, r) => a + Object.values(r).filter(Boolean).length, 0);
  const missingSlots = template.formDefinition.fields.filter((f) => f.required && !pop.fields[f.key]).map((f) => f.key);
  return {
    family: pop.assetFamily, filledFields, missingSlots, coverage: pop.coverage,
    coverageComplete: Object.values(pop.coverage).every(Boolean), valid: validateTemplatePopulation(pop, template).ok,
  };
}
