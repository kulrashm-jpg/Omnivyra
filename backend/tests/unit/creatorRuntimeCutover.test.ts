import {
  executeCreatorRuntime, llmGatewayToStageGenerator, renderAssetToRenderAdapter,
  CREATOR_PRODUCTION_PATHS, isRoutedThroughOrchestrator, RUNTIME_PIPELINE, PIPELINE_VERSION,
  type ProductionDeps, type RealRenderFn,
} from '../../../lib/creator-templates/runtimeCutover';
import type { StageGenerator } from '../../../lib/creator-templates/creativeGeneration';
import type { RuntimeInput } from '../../../lib/creator-templates/runtimeOrchestrator';
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

// Mock production systems (the REAL gateway + renderAsset are wrapped identically in prod).
const passThroughGateway: StageGenerator = llmGatewayToStageGenerator(({ fields }) => fields);
function makeDeps(): { deps: ProductionDeps; rendered: { count: number; lastPayload: unknown } } {
  const rendered = { count: 0, lastPayload: null as unknown };
  const fakeRenderAsset = async (payload: Record<string, unknown>) => { rendered.count++; rendered.lastPayload = payload; return { bundle: 'rendered', payload }; };
  const renderAsset: RealRenderFn = renderAssetToRenderAdapter(fakeRenderAsset, (creative) => ({ creator_card: { id: creative.creativeId, family: creative.assetFamily, fields: creative.fields, slides: creative.slides } }));
  return { deps: { generate: passThroughGateway, renderAsset }, rendered };
}

describe('Runtime Cutover — single production execution engine', () => {
  it('every production path is routed through executeCreatorRuntime', () => {
    const paths = ['creator-content/generate.ts', 'render-inline.ts', 'creatorExecutionEngine.ts', 'creatorRenderDurableQueue.ts', 'creatorRenderWorkerProcessor.ts', 'preview', 'batch', 'regeneration', 'aiCreator', 'writerToCreator', 'campaign'] as const;
    for (const p of paths) {
      expect(CREATOR_PRODUCTION_PATHS[p]).toBe('executeCreatorRuntime');
      expect(isRoutedThroughOrchestrator(p)).toBe(true);
    }
  });

  it('executes through the orchestrator pipeline in canonical order', async () => {
    const { deps } = makeDeps();
    const { result } = await executeCreatorRuntime(inputFor('carousel'), deps);
    expect(result.trace.executionOrder).toEqual([...RUNTIME_PIPELINE]);
    expect(result.trace.validation.ok).toBe(true);
  });

  it('the real renderer is invoked exactly once on PASS', async () => {
    const { deps, rendered } = makeDeps();
    const { result, render } = await executeCreatorRuntime(inputFor('carousel'), deps);
    expect(result.verification.status).toBe('PASS');
    expect(rendered.count).toBe(1);
    expect(render!.status).toBe('RENDERED');
  });

  it('verification precedes rendering; FAIL never reaches the renderer', async () => {
    const { deps, rendered } = makeDeps();
    const wipe: StageGenerator = llmGatewayToStageGenerator(({ fields }) => { const o: Record<string, string> = {}; for (const k of Object.keys(fields)) o[k] = 'xxx'; return o; });
    const { result, render } = await executeCreatorRuntime(inputFor('carousel'), { ...deps, generate: wipe });
    expect(result.verification.status).toBe('FAIL');
    expect(rendered.count).toBe(0);     // renderer never called
    expect(render).toBeNull();
    expect(result.trace.renderStatus).toBe('BLOCKED');
  });

  it('renderer input mapping keeps the existing creator_card shape (renderer unchanged)', async () => {
    const { deps, rendered } = makeDeps();
    await executeCreatorRuntime(inputFor('carousel'), deps);
    expect((rendered.lastPayload as any).creator_card).toBeTruthy();
    expect((rendered.lastPayload as any).creator_card.family).toBe('carousel');
  });

  it('emits a complete RuntimeExecutionRecord (telemetry)', async () => {
    const { deps } = makeDeps();
    const { record } = await executeCreatorRuntime(inputFor('carousel'), deps, { executionId: 'exec-1' });
    expect(record.executionId).toBe('exec-1');
    expect(record.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(record.verificationResult).toBe('PASS');
    expect(record.rendererResult).toBe('RENDERED');
    expect(record.generationStages).toEqual(['headline', 'body', 'evidence', 'cta', 'consistency']);
    expect(record.templateVersion).toBe(3);
    expect(typeof record.retryCount).toBe('number');
  });

  it('identical request → identical API response + identical rendered payload', async () => {
    const a = await executeCreatorRuntime(inputFor('carousel'), makeDeps().deps);
    const b = await executeCreatorRuntime(inputFor('carousel'), makeDeps().deps);
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    expect(JSON.stringify(a.record)).toBe(JSON.stringify(b.record));
    expect(JSON.stringify(a.render)).toBe(JSON.stringify(b.render));
  });

  it('all families route through the one engine', async () => {
    for (const fam of ['image', 'carousel', 'infographic'] as TemplateAssetFamily[]) {
      const { result } = await executeCreatorRuntime(inputFor(fam), makeDeps().deps);
      expect(result.trace.validation.ok).toBe(true);
    }
  });
});
