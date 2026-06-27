import { generateVerifiedCreative, validateRuntimeExecution, summarizeRuntimeExecution, CREATOR_ENTRY_POINTS, PIPELINE_STAGES, type RuntimeInput } from '../../../lib/creator-templates/runtimeOrchestrator';
import type { StageGenerator } from '../../../lib/creator-templates/creativeGeneration';
import type { CreatorTemplate, TemplateField, TemplateAssetFamily } from '../../../lib/creator-templates/types';

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
  return { id: `tpl-${family}`, assetFamily: family, name: family, version: 3, formDefinition } as unknown as CreatorTemplate;
}

const inputFor = (family: TemplateAssetFamily = 'carousel'): RuntimeInput => ({ assetFamily: family, template: makeTemplate(family), sourceText: CONTENT, entryPoint: family });

describe('Runtime Orchestrator — single deterministic pipeline', () => {
  it('every Creator entry point routes to generateVerifiedCreative', () => {
    const entries = ['image', 'carousel', 'infographic', 'campaign', 'aiCreator', 'writerToCreator', 'batch', 'regeneration', 'preview'];
    for (const e of entries) expect(CREATOR_ENTRY_POINTS[e as keyof typeof CREATOR_ENTRY_POINTS]).toBe('generateVerifiedCreative');
  });

  it('executes all stages in the canonical order (no bypass, no skip)', async () => {
    const r = await generateVerifiedCreative(inputFor('carousel'));
    expect(r.trace.executionOrder).toEqual([...PIPELINE_STAGES]);
    expect(r.trace.validation.ok).toBe(true);
    expect(r.trace.stages.every((s) => s.status === 'ok')).toBe(true);
  });

  it('byte-identical input → byte-identical result', async () => {
    const a = await generateVerifiedCreative(inputFor('carousel'));
    const b = await generateVerifiedCreative(inputFor('carousel'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('no duplicate prompt / population / verification / renderer (exactly one each)', async () => {
    const r = await generateVerifiedCreative(inputFor('carousel'));
    const count = (n: string) => r.trace.stages.filter((s) => s.name === n).length;
    for (const single of ['Prompt Specification', 'Template Population', 'Creative Verification', 'Renderer', 'Structured Creative Generation']) {
      expect(count(single)).toBe(1);
    }
    expect(validateRuntimeExecution(r.trace).ok).toBe(true);
  });

  it('verification always precedes rendering', async () => {
    const r = await generateVerifiedCreative(inputFor('carousel'));
    const order = r.trace.executionOrder;
    expect(order.indexOf('Creative Verification')).toBeLessThan(order.indexOf('Renderer'));
  });

  it('renders on PASS, with a complete execution trace + diagnostics', async () => {
    const r = await generateVerifiedCreative(inputFor('carousel'));
    expect(r.verification.status).toBe('PASS');
    expect(r.trace.renderStatus).toBe('RENDERED');
    expect(r.render).not.toBeNull();
    expect(r.diagnostics.pipelineHealth).toBe('HEALTHY');
    expect(r.diagnostics.stageCoverage).toBe(1);
    expect(r.diagnostics.templateVersion).toBe(3);
  });

  it('FAIL never reaches the renderer (verification gate)', async () => {
    // A generator that erases all message content → message verification FAIL.
    const wipe: StageGenerator = ({ fields }) => { const o: Record<string, string> = {}; for (const k of Object.keys(fields)) o[k] = 'xxx'; return o; };
    const r = await generateVerifiedCreative(inputFor('carousel'), { generate: wipe });
    expect(r.verification.status).toBe('FAIL');
    expect(r.trace.renderStatus).toBe('BLOCKED');
    expect(r.render).toBeNull();
    expect(r.trace.stages.find((s) => s.name === 'Renderer')!.status).toBe('skipped');
    // Even when blocked, the pipeline order is still valid.
    expect(validateRuntimeExecution(r.trace).ok).toBe(true);
  });

  it('uses the injected renderer (real renderer reused, never redesigned)', async () => {
    let called = 0;
    const r = await generateVerifiedCreative(inputFor('carousel'), { render: (c) => { called++; return { ok: true, status: 'RENDERED', payload: c.creativeId }; } });
    expect(called).toBe(1);
    expect(r.render!.status).toBe('RENDERED');
  });

  it('summary reports entry point, order, verification, render, validity', async () => {
    const s = summarizeRuntimeExecution(await generateVerifiedCreative(inputFor('carousel')));
    expect(s.entryPoint).toBe('carousel');
    expect(s.order).toEqual([...PIPELINE_STAGES]);
    expect(s.verification).toBe('PASS');
    expect(s.rendered).toBe(true);
    expect(s.valid).toBe(true);
    expect(s.health).toBe('HEALTHY');
  });

  it('every family runs through the one pipeline', async () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const r = await generateVerifiedCreative(inputFor(fam));
      expect(r.trace.validation.ok).toBe(true);
      expect(r.assetFamily).toBe(fam);
    }
  });
});
