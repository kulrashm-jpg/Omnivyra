/**
 * runTemplateDeepening
 *
 * AI-powered paragraph-by-paragraph deepening for template-aware blog generation.
 * Extracted from runBlogGeneration.ts to keep the main orchestrator under 500 lines.
 */

import { runCompletionWithOperation } from '../../content/engine/generator';
import type { ContentBlock } from './blockTypes';
import {
  stripHtmlForWordCount,
  analyzeTemplateContentBlocks,
  collectParagraphTargets,
  applyClassicStructuredRepair,
  applyTemplateStructuredRepair,
  describeSectionDepthNeeds,
} from './runBlogGenerationPureHelpers';
import { validateContentVariation } from '../content/contentVariationValidator';

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
    const sectionDepthNeeds = describeSectionDepthNeeds(
      stripHtmlForWordCount(target.currentHtml),
      args.targetWords,
    );
    const previousText = index > 0 ? repairedParagraphs[index - 1]?.html || paragraphTargets[index - 1]?.currentHtml || '' : '';
    const similarityToPrevious = previousText
      ? validateContentVariation([
          { id: 'previous', text: previousText },
          { id: 'current', text: target.currentHtml },
        ]).maxSectionSimilarity
      : 0;
    const mustRegenerateCompletely = similarityToPrevious >= 0.7;
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
            `- Rewrite the section to include explanation, an example or scenario, and an implication or action\n` +
            `- Do not write bullets, headings, or placeholders\n` +
            `- If this section overlaps too much with the prior section, replace the angle completely instead of paraphrasing it\n` +
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
            (sectionDepthNeeds.length > 0
              ? `This section is missing: ${sectionDepthNeeds.join('; ')}.\nRewrite the section to include explanation, an example or scenario, and an implication or action.\n`
              : '') +
            (mustRegenerateCompletely
              ? `This section is too similar to the previous section (${Math.round(similarityToPrevious * 100)}% similarity). Regenerate it completely with a different pain point, scenario, product detail, or outcome.\n`
              : '') +
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

