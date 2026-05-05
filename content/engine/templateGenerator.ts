import type { ContentBlock } from '../../lib/blog/blockTypes';
import type { BlogAngle, BlogGenerationInput, BlogGenerationOutput } from './generator';
import { generateContent } from './generator';
import { formatToBlocks } from './formatter';
import { sanitizeBlocks } from './sanitizer';
import { validateBlocks } from '../core/contentValidator';
import type { BlogGenerationResult } from '../../lib/blog/blogRunnerTypes';
import type { OrchestratorResult } from '../../lib/content/contentGenerationOrchestrator';
import type { CompanyIdentity } from '../../lib/content/companyContextBlock';
import { buildExcerptFromBlocks, normalizeTemplateName } from '../../lib/blog/runBlogGenerationPureHelpers';

export interface TemplateBlogGenerationParams {
  company_id: string;
  topic: string;
  blogTable: string;
  cache_version: string | undefined;
  contentType: string;
  formatType: string;
  effectiveTemplateBlocks: ContentBlock[];
  effectiveTemplateName: string | undefined;
  targetWc: number | undefined;
  maxTokens: number;
  generationInput: BlogGenerationInput;
  ctx: OrchestratorResult | null;
  confidence: 'high' | 'medium';
  selected_angle?: BlogAngle;
  companyIdentity?: CompanyIdentity;
}

function normalizePipelineType(type: string): 'blog' | 'article' | 'newsletter' | 'guide' {
  if (type === 'article' || type === 'newsletter' || type === 'guide') return type;
  return 'blog';
}

function extractTitle(topic: string, blocks: ContentBlock[]): string {
  const firstHeading = blocks.find((block): block is Extract<ContentBlock, { type: 'heading' }> => {
    return block.type === 'heading' && typeof block.text === 'string' && block.text.trim().length > 0;
  });
  return firstHeading?.text?.trim() || topic;
}

function extractKeyInsights(blocks: ContentBlock[]): string[] {
  const insights = blocks.find((block): block is Extract<ContentBlock, { type: 'key_insights' }> => {
    return block.type === 'key_insights' && Array.isArray(block.items);
  });
  return insights?.items.filter(Boolean).slice(0, 6) || [];
}

function buildTemplateInput(params: TemplateBlogGenerationParams) {
  return {
    topic: params.topic,
    contentType: params.contentType,
    formatType: params.formatType,
    targetWords: params.targetWc,
    selectedAngle: params.selected_angle,
    generationInput: params.generationInput,
    intelligenceContext: params.ctx,
    templateBlocks: params.effectiveTemplateBlocks,
  };
}

export async function runTemplateGenerationPath(
  params: TemplateBlogGenerationParams,
): Promise<BlogGenerationResult | null> {
  if (!Array.isArray(params.effectiveTemplateBlocks) || params.effectiveTemplateBlocks.length === 0) {
    return null;
  }

  const raw = await generateContent({
    type: normalizePipelineType(params.contentType),
    input: buildTemplateInput(params),
    template: normalizeTemplateName(params.effectiveTemplateName || params.formatType),
    companyId: params.company_id,
  });

  const blocks = sanitizeBlocks(validateBlocks(formatToBlocks(raw)));
  if (!blocks.length) {
    throw new Error('Invalid generation output: formatter produced no blocks.');
  }

  const contentHtml = raw;
  const result: BlogGenerationOutput & { content_blocks: ContentBlock[] } = {
    title: extractTitle(params.topic, blocks),
    excerpt: buildExcerptFromBlocks(blocks) || params.topic,
    content_html: contentHtml,
    content_blocks: blocks,
    tags: [],
    category: params.formatType || params.contentType,
    seo_meta_title: extractTitle(params.topic, blocks),
    seo_meta_description: buildExcerptFromBlocks(blocks) || params.topic,
    key_insights: extractKeyInsights(blocks),
  };

  return {
    needs_clarification: false,
    mode: 'full',
    confidence: params.confidence,
    result,
    hook_assessment: {
      strength: 'moderate',
      note: 'Generated through the unified template wrapper; review the opening paragraph before publishing.',
    },
    template_used: true,
  };
}
