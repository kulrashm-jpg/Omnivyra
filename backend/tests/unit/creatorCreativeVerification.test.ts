import * as fs from 'fs';
import * as path from 'path';
import { packageAssetAssembly } from '../../../lib/creator-templates/assetAssembly';
import { buildPromptFromAssembly } from '../../../lib/creator-templates/assetAssemblyPrompt';
import { populateTemplateFromAssembly } from '../../../lib/creator-templates/templatePopulation';
import { generateCreative, type GeneratedCreative, type StageGenerator } from '../../../lib/creator-templates/creativeGeneration';
import { createPackage, addIntakeSource } from '../../../lib/creator-templates/contentPackage';
import { fromExistingContent } from '../../../lib/creator-templates/contentIntake';
import {
  verifyCreative, verifyAndRegenerate, canRender, summarizeCreativeVerification, failedStagesFor,
  type VerifyInput,
} from '../../../lib/creator-templates/creativeVerification';
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

async function buildInput(family: TemplateAssetFamily = 'carousel'): Promise<VerifyInput> {
  let p = createPackage('pkg-v');
  p = addIntakeSource(p, fromExistingContent(CONTENT), { id: 's1', createdAt: AT });
  const assembly = packageAssetAssembly(p, family);
  const population = populateTemplateFromAssembly(assembly, makeTemplate(family));
  const prompt = buildPromptFromAssembly(assembly);
  const creative = await generateCreative({ assembly, population, prompt });
  return { assembly, population, prompt, creative };
}
const clone = (c: GeneratedCreative): GeneratedCreative => JSON.parse(JSON.stringify(c));

describe('Creative Verification — deterministic gate', () => {
  it('a well-formed creative PASSES, identical inputs → identical reports', async () => {
    const input = await buildInput('carousel');
    const a = verifyCreative(input);
    const b = verifyCreative(input);
    expect(a.status).toBe('PASS');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('message verification fails when the main message is lost', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.fields = Object.fromEntries(Object.keys(creative.fields).map((k) => [k, 'xxx']));
    creative.slides = creative.slides.map((r) => Object.fromEntries(Object.keys(r).map((k) => [k, 'xxx'])));
    creative.cta = 'xxx';
    const report = verifyCreative({ ...input, creative });
    expect(report.modules.find((m) => m.module === 'message')!.pass).toBe(false);
    expect(report.status).toBe('FAIL');
  });

  it('communication verification fails on goal/blueprint drift', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.metadata.conversionGoal = 'WrongGoal';
    const report = verifyCreative({ ...input, creative });
    expect(report.modules.find((m) => m.module === 'communication')!.pass).toBe(false);
  });

  it('story verification fails when narrative units are dropped', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.slides = creative.slides.slice(0, 1);
    const report = verifyCreative({ ...input, creative });
    expect(report.modules.find((m) => m.module === 'story')!.pass).toBe(false);
    expect(report.status).toBe('FAIL');
  });

  it('conversion + population verification fail when CTA is blank', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.cta = '';
    creative.fields.cta = '';
    creative.slides = creative.slides.map((r) => (/sign up|get started/i.test(r.title || '') ? { ...r, title: 'Other' } : r));
    const report = verifyCreative({ ...input, creative });
    expect(report.modules.find((m) => m.module === 'conversion')!.pass).toBe(false);
    expect(report.failedModules).toContain('conversion');
  });

  it('template/population verification fails on duplicate slide values', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    if (creative.slides.length >= 2) { creative.slides[1].title = creative.slides[0].title; }
    const report = verifyCreative({ ...input, creative });
    expect(report.modules.find((m) => m.module === 'population')!.pass).toBe(false);
  });
});

describe('Creative Verification — regeneration, history, gating, summary', () => {
  it('selective regeneration reruns ONLY the failed stage and re-verifies', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.cta = '';
    creative.fields.cta = '';
    const fix: StageGenerator = ({ stage, fields }) => {
      if (stage === 'cta') { const o: Record<string, string> = {}; for (const k of Object.keys(fields)) o[k] = fields[k] || 'Get started'; return o; }
      return fields;
    };
    const { report, creative: out } = await verifyAndRegenerate({ ...input, creative }, { generate: fix });
    expect(report.regeneratedStages).toContain('cta');
    expect(out.cta).toBeTruthy();
    expect(report.status).toBe('PASS');
  });

  it('verification history records each pass with decision + retry count', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.cta = ''; creative.fields.cta = '';
    const fix: StageGenerator = ({ stage, fields }) => { if (stage === 'cta') { const o: Record<string, string> = {}; for (const k of Object.keys(fields)) o[k] = fields[k] || 'Get started'; return o; } return fields; };
    const { report } = await verifyAndRegenerate({ ...input, creative }, { generate: fix });
    expect(report.history.length).toBe(2);
    expect(report.history[0].retryCount).toBe(0);
    expect(report.history[1].failedStages.length).toBeGreaterThan(0);
  });

  it('renderer gating: PASS renders, FAIL never renders, WARN only when allowed', async () => {
    const input = await buildInput('carousel');
    const pass = verifyCreative(input);
    expect(canRender(pass)).toBe(true);
    expect(canRender({ ...pass, status: 'FAIL' })).toBe(false);
    expect(canRender({ ...pass, status: 'WARN' })).toBe(false);
    expect(canRender({ ...pass, status: 'WARN' }, { allowWarn: true })).toBe(true);
  });

  it('summary reports status / score / failed modules / regenerated stages', async () => {
    const input = await buildInput('carousel');
    const s = summarizeCreativeVerification(verifyCreative(input));
    expect(s.status).toBe('PASS');
    expect(s.failedModules).toEqual([]);
    expect(s.regeneratedStages).toEqual([]);
    expect(typeof s.score).toBe('number');
  });

  it('failedStagesFor maps failed modules to generation stages', async () => {
    const input = await buildInput('carousel');
    const creative = clone(input.creative);
    creative.cta = ''; creative.fields.cta = '';
    const report = verifyCreative({ ...input, creative });
    expect(failedStagesFor(report)).toContain('cta');
  });

  it('imports only Asset Assembly / Prompt Spec / Template Population / Generation — no deep planners', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/creator-templates/creativeVerification.ts'), 'utf8');
    for (const planner of ['communicationStrategy', 'audienceJourney', 'visualMessagingPlan', 'conversionStrategy', 'contentIntelligence', 'storyBlueprint', 'messageFoundation', 'contentPackage']) {
      expect(src.includes(`from './${planner}'`)).toBe(false);
    }
    expect(src.includes("from './creativeGeneration'")).toBe(true);
  });
});
