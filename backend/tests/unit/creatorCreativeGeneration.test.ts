import * as fs from 'fs';
import * as path from 'path';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { buildPromptFromAssembly } from '../../../lib/creator-templates/assetAssemblyPrompt';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import {
  generateCreative, rerunStage, runStage, validateGeneratedCreative, summarizeGeneration,
  STAGE_ORDER, type GenerateInput, type StageGenerator,
} from '../../../lib/creator-templates/creativeGeneration';
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

function inputFor(family: TemplateAssetFamily = 'carousel'): GenerateInput {
  let p = createPackage('pkg-g');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
  const prompt = buildPromptFromAssembly(assembly);
  return { assembly, population, prompt };
}

describe('Creative Generation — deterministic staged orchestration', () => {
  it('runs stages in the fixed order', async () => {
    const creative = await generateCreative(inputFor('carousel'));
    expect(creative.stages.map((s) => s.stage)).toEqual(STAGE_ORDER);
    expect(creative.executionReport.stages).toEqual(STAGE_ORDER);
  });

  it('identical inputs → byte-identical orchestration', async () => {
    const a = await generateCreative(inputFor('carousel'));
    const b = await generateCreative(inputFor('carousel'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('stage isolation — each stage only sees its own slot kind', async () => {
    const seen: Record<string, string[]> = {};
    const spy: StageGenerator = ({ stage, fields }) => { seen[stage] = Object.keys(fields); return fields; };
    await generateCreative(inputFor('carousel'), { generate: spy });
    // headline stage must not receive cta/body refs; cta stage only cta refs.
    expect(seen.cta.every((r) => /cta/i.test(r))).toBe(true);
    expect(seen.headline.some((r) => /cta/i.test(r))).toBe(false);
  });

  it('partial retry — a failing stage reruns only itself, never the whole asset', async () => {
    let calls = 0;
    const flaky: StageGenerator = ({ stage, fields }) => {
      if (stage === 'evidence') { calls++; if (calls === 1) throw new Error('boom'); }
      return fields;
    };
    const creative = await generateCreative(inputFor('carousel'), { generate: flaky, maxRetries: 2 });
    const evidence = creative.stages.find((s) => s.stage === 'evidence')!;
    expect(evidence.retries).toBe(1);
    expect(evidence.validation.ok).toBe(true);
    expect(creative.validation.ok).toBe(true);
  });

  it('rerunStage recomputes one stage and leaves the rest', async () => {
    const input = inputFor('carousel');
    const base = await generateCreative(input);
    const { creative, stageResult } = await rerunStage(input, base, 'cta');
    expect(stageResult.stage).toBe('cta');
    expect(creative.stages.filter((s) => s.stage === 'body')[0]).toEqual(base.stages.filter((s) => s.stage === 'body')[0]);
  });

  it('contains NO rendering data (no colors/fonts/coords/pixels)', async () => {
    const blob = JSON.stringify(await generateCreative(inputFor('carousel'))).toLowerCase();
    for (const f of ['rgb', 'hex', 'px', 'font', 'pixel', 'coordinate', 'color']) expect(blob.includes(f)).toBe(false);
  });

  it('reads ONLY assembly/population/prompt — no upstream planner imports', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/creator-templates/creativeGeneration.ts'), 'utf8');
    for (const planner of ['communicationStrategy', 'audienceJourney', 'visualMessagingPlan', 'conversionStrategy', 'contentIntelligence', 'storyBlueprint', 'messageFoundation', 'contentPackage']) {
      expect(src.includes(`from './${planner}'`)).toBe(false);
    }
  });
});

describe('Creative Generation — validation, report, summary', () => {
  it('validation: all populated, no duplicate headlines, CTA exists', async () => {
    const creative = await generateCreative(inputFor('carousel'));
    const v = validateGeneratedCreative(creative);
    expect(v.ok).toBe(true);
    expect(creative.cta).toBeTruthy();
  });

  it('execution report exposes timing / coverage / tokens / retries', async () => {
    const creative = await generateCreative(inputFor('carousel'), { now: () => 0 });
    expect(creative.executionReport.stages.length).toBe(5);
    expect(creative.executionReport.totalTokenUsage).toBeGreaterThan(0);
    expect(creative.executionReport.totalRetries).toBe(0);
    expect(creative.executionReport.coverage).toBeGreaterThan(0);
  });

  it('summary reports completed stages + coverage + validity', async () => {
    const s = summarizeGeneration(await generateCreative(inputFor('carousel')));
    expect(s.completedStages).toEqual(STAGE_ORDER);
    expect(s.valid).toBe(true);
    expect(typeof s.tokenUsage).toBe('number');
  });

  it('runStage is isolated + deterministic', async () => {
    const input = inputFor('image');
    const slots = Object.entries(input.population.fields).map(([key, value]) => ({ ref: `field:${key}`, key, kind: /cta/.test(key) ? 'cta' as const : 'headline' as const, value }));
    const ctx = { approved: {}, assemblyGoal: 'x', tone: null, ctaIntensity: 'Medium' };
    const a = await runStage('headline', slots, ctx);
    const b = await runStage('headline', slots, ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
