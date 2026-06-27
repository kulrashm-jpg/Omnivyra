import * as fs from 'fs';
import * as path from 'path';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import {
  populateTemplateFromAssembly, validateTemplatePopulation, summarizeTemplatePopulation,
  FAMILY_PROJECTORS, type PopulationFamily,
} from '../../../lib/creator-templates/templatePopulation';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'Boost activation by 92%',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship faster. 3x retention.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. Sign up now.',
].join('\n');

const field = (key: string, required = false): TemplateField =>
  ({ key, label: key, control: 'text', required, aiAssist: { manual: true, paste: true, generate: true, rewrite: true, expand: true, shorten: true, improve: true } } as unknown as TemplateField);

function makeTemplate(family: TemplateAssetFamily): CreatorTemplate {
  const formDefinition: CreatorTemplate['formDefinition'] = {
    fields: [field('headline', true), field('subheadline'), field('cta', true)],
    slides: family === 'carousel' ? { countOptions: [3, 4, 5, 6, 7, 8], defaultCount: 5, fields: [field('title', true), field('body')] } : undefined,
    sections: family === 'infographic' ? { kind: 'repeatable', min: 1, max: 12, sectionLabel: 'Statistic', fields: [field('label', true), field('value')] } : undefined,
  };
  return { id: `tpl-${family}`, assetFamily: family, name: family, formDefinition } as unknown as CreatorTemplate;
}

function asmFor(family: TemplateAssetFamily = 'carousel') {
  let p = createPackage('pkg-t');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  return packageAssetAssembly(p, family);
}

describe('Template Population — deterministic projection + ownership', () => {
  it('identical AssetAssembly → byte-identical population', () => {
    const a = populateTemplateFromAssembly(asmFor('carousel'), makeTemplate('carousel'));
    const b = populateTemplateFromAssembly(asmFor('carousel'), makeTemplate('carousel'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every real family is deterministic + projects the right shape', () => {
    const carousel = populateTemplateFromAssembly(asmFor('carousel'), makeTemplate('carousel'));
    expect(carousel.slides.length).toBeGreaterThan(0);
    expect(carousel.sections.length).toBe(0);
    const ig = populateTemplateFromAssembly(asmFor('infographic'), makeTemplate('infographic'));
    expect(ig.sections.length).toBeGreaterThan(0);
    expect(ig.slides.length).toBe(0);
    const image = populateTemplateFromAssembly(asmFor('image'), makeTemplate('image'));
    expect(image.fields.headline).toBeTruthy();
    expect(image.slides.length + image.sections.length).toBe(0);
  });

  it('extended families register through one interface (all flat-projected)', () => {
    const extended: PopulationFamily[] = ['post', 'thread', 'blogImage', 'newsletterImage', 'guideImage', 'whitepaperImage'];
    const tpl = makeTemplate('image');
    const asm = asmFor('image');
    for (const fam of extended) {
      expect(FAMILY_PROJECTORS[fam]).toBe('flat');
      const pop = populateTemplateFromAssembly(asm, tpl, fam);
      expect(pop.assetFamily).toBe(fam);
      expect(JSON.stringify(pop)).toBe(JSON.stringify(populateTemplateFromAssembly(asm, tpl, fam)));
    }
  });

  it('ownership: headline/body → Visual Messaging, CTA → Conversion', () => {
    const pop = populateTemplateFromAssembly(asmFor('image'), makeTemplate('image'));
    expect(pop.ownership.headline).toBe('AssetAssembly:VisualMessaging');
    expect(pop.ownership.cta).toBe('AssetAssembly:Conversion');
  });

  it('contains NO rendering data (no colors/fonts/coords/pixels/template ids)', () => {
    const blob = JSON.stringify(populateTemplateFromAssembly(asmFor('carousel'), makeTemplate('carousel'))).toLowerCase();
    for (const f of ['rgb', 'hex', '#', 'px', 'font', 'pixel', 'coordinate', 'color']) {
      expect(blob.includes(f)).toBe(false);
    }
  });

  it('reads ONLY the AssetAssembly — no upstream planner imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/creator-templates/templatePopulation.ts'), 'utf8');
    for (const planner of ['communicationStrategy', 'audienceJourney', 'visualMessagingPlan', 'conversionStrategy', 'contentIntelligence', 'storyBlueprint', 'messageFoundation', 'contentPackage', 'assetAssemblyPrompt']) {
      expect(src.includes(`from './${planner}'`)).toBe(false);
    }
    expect(src.includes("from './assetAssembly'")).toBe(true);
  });
});

describe('Template Population — validation, diagnostics, summary', () => {
  it('validation passes for a well-formed population', () => {
    const tpl = makeTemplate('carousel');
    const v = validateTemplatePopulation(populateTemplateFromAssembly(asmFor('carousel'), tpl), tpl);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it('diagnostics expose population coverage', () => {
    const pop = populateTemplateFromAssembly(asmFor('carousel'), makeTemplate('carousel'));
    expect(pop.coverage.headline).toBe(true);
    expect(pop.coverage.cta).toBe(true);
    expect(pop.coverage.hierarchy).toBe(true);
    expect(pop.coverage.conversion).toBe(true);
  });

  it('summary reports filled fields + coverage + validity', () => {
    const tpl = makeTemplate('carousel');
    const s = summarizeTemplatePopulation(populateTemplateFromAssembly(asmFor('carousel'), tpl), tpl);
    expect(s.filledFields).toBeGreaterThan(0);
    expect(s.missingSlots).toEqual([]);
    expect(s.valid).toBe(true);
    expect(s.coverageComplete === true || s.coverageComplete === false).toBe(true);
  });
});
