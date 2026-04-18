/**
 * runTemplateDeepening
 *
 * AI-powered paragraph-by-paragraph deepening for template-aware blog generation.
 * Extracted from runBlogGeneration.ts to keep the main orchestrator under 500 lines.
 */

import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import type { ContentBlock } from './blockTypes';
import {
  stripHtmlForWordCount,
  analyzeTemplateContentBlocks,
  collectParagraphTargets,
  applyClassicStructuredRepair,
  applyTemplateStructuredRepair,
} from './runBlogGenerationPureHelpers';

export async function deepenTemplateParagraphsIndividually(args: {
  blocks: ContentBlock[];
  companyId: string;
  cacheVersion?: string;
  topic: string;
  templateLabel: string;
  targetWords: number;
  minAcceptable: number;
  minParagraphWords: number;
  useClassicRepair?: boolean;
}): Promise<{
  blocks: ContentBlock[];
  analysis: ReturnType<typeof analyzeTemplateContentBlocks>;
}> {
  const paragraphTargets = collectParagraphTargets(args.blocks);
  if (paragraphTargets.length === 0) {
    return {
      blocks: args.blocks,
      analysis: analyzeTemplateContentBlocks(args.blocks),
    };
  }

  const repairedParagraphs: Array<{ html: string }> = [];

  for (let index = 0; index < paragraphTargets.length; index++) {
    const target = paragraphTargets[index];
    const result = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: args.companyId,
      cache_version: args.cacheVersion,
      model: 'gpt-4o',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content:
            `You are expanding one paragraph block inside a ${args.templateLabel} blog article.\n` +
            `Return JSON only: { "html": "<p>...</p><p>...</p>" }\n` +
            `Rules:\n` +
            `- Write valid HTML using 2-3 <p> tags\n` +
            `- Write at least ${args.minParagraphWords} words\n` +
            `- Add real explanation, examples, implications, and practical detail\n` +
            `- Do not write bullets, headings, or placeholders\n` +
            `- Do not mention word counts or writing instructions\n`,
        },
        {
          role: 'user',
          content:
            `Topic: ${args.topic}\n` +
            `Template: ${args.templateLabel}\n` +
            `Target article length: ${args.targetWords} words (minimum acceptable ${args.minAcceptable})\n` +
            `Section heading: ${target.headingContext || 'Body section'}\n` +
            `Block hint: ${target.hint || 'Expand the current paragraph block into a complete body section.'}\n` +
            `Current paragraph depth: ${target.currentWords} words\n` +
            `Current block text:\n${stripHtmlForWordCount(target.currentHtml).trim() || '[empty]'}\n\n` +
            `Rewrite this block so it becomes a complete long-form section for the article.`,
        },
      ],
    });

    let html = '';
    try {
      const raw = result.output ? JSON.parse(result.output) : null;
      html = typeof raw?.html === 'string' ? raw.html.trim() : '';
    } catch {
      html = '';
    }

    repairedParagraphs.push({
      html: html || target.currentHtml,
    });
  }

  const repaired = args.useClassicRepair
    ? applyClassicStructuredRepair(args.blocks, { paragraphs: repairedParagraphs }).blocks
    : applyTemplateStructuredRepair(args.blocks, { paragraphs: repairedParagraphs }).blocks;

  return {
    blocks: repaired,
    analysis: analyzeTemplateContentBlocks(repaired),
  };
}
