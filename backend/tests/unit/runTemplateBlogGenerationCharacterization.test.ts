/**
 * CHARACTERIZATION SUITE — lib/blog/runTemplateBlogGeneration.ts
 * (runTemplateBlogGenerationPath — the template-driven blog/newsletter/longform
 * generation runner).
 *
 * Locks CURRENT observable behavior: dedicated-template routing (classic/
 * tutorial/comparison/editorial) with fail-open fallback to the shared
 * template path, the shared path's AI JSON contract (flexible block-key
 * parsing via parseTemplateOutput), the null fall-through contract (template
 * failure ⇒ caller runs standard HTML generation), and the company-context
 * enforcement gate.
 *
 * Seams mocked (external boundaries only): aiGateway (runCompletionWithOperation),
 * profile fetch, internal-link injection (DB), hook assessment (AI), the four
 * dedicated sub-runners (own modules with own coverage), paragraph deepening.
 *
 * Kept REAL: prompt builders + parseTemplateOutput (blogGenerationEngine),
 * runBlogGenerationPureHelpers (analysis/quality/repair helpers),
 * companyContextBlock (identity extraction, scoring, enforcement),
 * contentVariationValidator, governance prompt context.
 *
 * NOTE ON SCENARIOS: targetWc is kept BELOW 300 in shared-path scenarios so the
 * retry/repair loop (guarded by `targetWc >= 300`) does not fire — those repair
 * chains are AI-call-heavy and are documented as an uncovered path.
 */

jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(async () => ({ output: '' })),
}));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: jest.fn(async () => null),
}));
jest.mock('../../../lib/blog/runBlogGenerationDataAccess', () => ({
  injectInternalLinks: jest.fn(async (blocks: unknown[]) => blocks),
}));
jest.mock('../../../lib/blog/hookAssessment', () => ({
  checkHookStrength: jest.fn(async () => ({ strength: 'strong', note: 'mock-hook' })),
}));
jest.mock('../../../lib/blog/runClassicBlogGeneration', () => ({
  runClassicBlogGeneration: jest.fn(async () => null),
}));
jest.mock('../../../lib/blog/runComparisonBlogGeneration', () => ({
  runComparisonBlogGeneration: jest.fn(async () => null),
}));
jest.mock('../../../lib/blog/runEditorialBlogGeneration', () => ({
  runEditorialBlogGeneration: jest.fn(async () => null),
}));
jest.mock('../../../lib/blog/runTutorialBlogGeneration', () => ({
  runTutorialBlogGeneration: jest.fn(async () => null),
}));
jest.mock('../../../lib/blog/runTemplateDeepening', () => ({
  deepenTemplateParagraphsIndividually: jest.fn(async () => null),
}));

import { runTemplateBlogGenerationPath } from '../../../lib/blog/runTemplateBlogGeneration';
import { runCompletionWithOperation } from '../../services/aiGateway';
import { runClassicBlogGeneration } from '../../../lib/blog/runClassicBlogGeneration';
import { injectInternalLinks } from '../../../lib/blog/runBlogGenerationDataAccess';
import { CompanyContextEnforcementError } from '../../../lib/content/companyContextBlock';

const para = (id: string) => ({ id, type: 'paragraph' as const, html: '' });
const TEMPLATE_BLOCKS = [para('b1'), para('b2'), para('b3')];

const LONG_PARA = (label: string) =>
  `<p>${label}: Automation changes how retail operators plan their week. Teams that adopt ` +
  `structured checks ship campaigns faster, catch defects before customers see them, and ` +
  `reuse proven assets instead of rebuilding from scratch every cycle. The compounding ` +
  `effect shows up within a quarter as fewer escalations and steadier publishing cadence.</p>`;

const AI_TEMPLATE_OUTPUT = JSON.stringify({
  title: 'Automation Payoffs for Retail Teams',
  excerpt: 'How automation compounds across retail operations.',
  tags: ['automation', 'retail'],
  category: 'Operations',
  seo_meta_title: 'Automation Payoffs',
  seo_meta_description: 'How automation compounds across retail teams.',
  key_insights: ['Speed compounds weekly', 'Quality gates prevent rework'],
  blocks: [
    { html: LONG_PARA('Speed') },
    { html: LONG_PARA('Quality') },
    { html: LONG_PARA('Reuse') },
  ],
});

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    company_id: 'co-1',
    topic: 'Automation Payoffs',
    blogTable: 'blogs',
    cache_version: undefined,
    contentType: 'blog',
    formatType: 'standard',
    effectiveTemplateBlocks: TEMPLATE_BLOCKS as any,
    effectiveTemplateName: 'Standard',
    targetWc: 250, // < 300 ⇒ the AI-heavy retry/repair loop is skipped (uncovered path)
    maxTokens: 2000,
    generationInput: { answers: {} } as any,
    ctx: { seo: { intent: 'informational' }, trends: null } as any,
    confidence: 'high' as const,
    ...overrides,
  };
}

beforeEach(() => {
  (runCompletionWithOperation as jest.Mock).mockResolvedValue({ output: AI_TEMPLATE_OUTPUT });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

describe('dedicated template routing', () => {
  it('Classic template uses the dedicated runner and skips the shared AI path', async () => {
    (runClassicBlogGeneration as jest.Mock).mockResolvedValueOnce({
      title: 'Classic Title',
      excerpt: 'Classic excerpt.',
      tags: ['classic'],
      category: 'Ops',
      seo_meta_title: 'Classic Title',
      seo_meta_description: 'Classic description.',
      key_insights: ['One'],
      content_blocks: [{ id: 'c1', type: 'paragraph', html: LONG_PARA('Classic') }],
    });
    const result = await runTemplateBlogGenerationPath(
      baseParams({ effectiveTemplateName: 'Classic', targetWc: 600 }) as any,
    );
    expect(result).not.toBeNull();
    expect(result!.template_used).toBe(true);
    expect(result!.result.title).toBe('Classic Title');
    expect(result!.hook_assessment).toEqual({ strength: 'strong', note: 'mock-hook' });
    expect(injectInternalLinks).toHaveBeenCalledTimes(1);
    // Dedicated path returned → the shared template AI call never fired.
    expect(runCompletionWithOperation).not.toHaveBeenCalled();
  });

  it('Classic runner returning null falls open to the shared template path', async () => {
    (runClassicBlogGeneration as jest.Mock).mockResolvedValueOnce(null);
    const result = await runTemplateBlogGenerationPath(
      baseParams({ effectiveTemplateName: 'Classic' }) as any,
    );
    expect(runCompletionWithOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'blogGeneration',
        model: 'gpt-4o',
        response_format: { type: 'json_object' },
      }),
    );
    expect(result).not.toBeNull(); // shared path succeeded with the fixture output
  });
});

describe('shared template path', () => {
  it('golden master: parses the AI JSON, fills template blocks, returns the full envelope', async () => {
    const result = await runTemplateBlogGenerationPath(baseParams() as any);
    expect(result).not.toBeNull();
    expect(result!.needs_clarification).toBe(false);
    expect(result!.mode).toBe('full');
    expect(result!.confidence).toBe('high');
    expect(result!.template_used).toBe(true);
    expect(result!.result.title).toBe('Automation Payoffs for Retail Teams');
    expect(result!.result.content_blocks).toHaveLength(3);
    // Template block ids are preserved; AI html is merged in by index.
    expect((result!.result.content_blocks[0] as any).id).toBe('b1');
    expect((result!.result.content_blocks[0] as any).html).toContain('Speed:');
    expect(result!.seo_intelligence).toEqual({ intent: 'informational' });
    expect(result!.result).toMatchSnapshot('shared-path-result');
  });

  it('AI output that is not JSON ⇒ returns null (fall-through to standard generation)', async () => {
    (runCompletionWithOperation as jest.Mock).mockResolvedValue({ output: 'not json at all' });
    const result = await runTemplateBlogGenerationPath(baseParams() as any);
    expect(result).toBeNull();
  });

  it('AI output missing a blocks array ⇒ returns null', async () => {
    (runCompletionWithOperation as jest.Mock).mockResolvedValue({
      output: JSON.stringify({ title: 'No blocks here' }),
    });
    const result = await runTemplateBlogGenerationPath(baseParams() as any);
    expect(result).toBeNull();
  });

  it('strips markdown code fences before JSON parsing', async () => {
    (runCompletionWithOperation as jest.Mock).mockResolvedValue({
      output: '```json\n' + AI_TEMPLATE_OUTPUT + '\n```',
    });
    const result = await runTemplateBlogGenerationPath(baseParams() as any);
    expect(result).not.toBeNull();
    expect(result!.result.title).toBe('Automation Payoffs for Retail Teams');
  });

  it('company-context enforcement gate rejects generic content for a supplied identity', async () => {
    await expect(
      runTemplateBlogGenerationPath(
        baseParams({
          companyIdentity: {
            companyName: 'Zephyrix Dynamics',
            industry: 'quantum logistics',
            coreProblem: 'fragmented cold-chain telemetry',
          },
        }) as any,
      ),
    ).rejects.toThrow(CompanyContextEnforcementError);
  });
});
