/**
 * blockEnrichEngine.ts — Server-side per-block AI enrichment
 *
 * Enriches a single content block using surrounding context and blog metadata.
 * Each block type gets a tailored prompt so the AI knows what kind of improvement to make.
 */

import { runCompletionWithOperation } from './aiGateway';
// WAVE-1C-001 §C1: canonical safe-parse for model output.
import { parseModelOutputOr } from './ai/safety';
import type { ContentBlock, BlockType } from '../../lib/blog/blockTypes';

export type EnrichBlockInput = {
  companyId: string;
  block: ContentBlock;
  contextBlocks: ContentBlock[];
  blogMeta: { title: string; excerpt: string; tags: string[] };
  writingStyle?: string;
};

export type EnrichBlockOutput = {
  enriched_block: ContentBlock;
  changes_summary: string;
};

const ENRICHABLE_TYPES: Set<BlockType> = new Set([
  'paragraph', 'heading', 'key_insights', 'callout', 'quote', 'list', 'summary',
]);

export function isEnrichableType(type: BlockType): boolean {
  return ENRICHABLE_TYPES.has(type);
}

// ── Per-type prompt instructions ──────────────────────────────────────────────

function getBlockInstruction(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':
      return 'Expand this paragraph with more depth, concrete examples, data points, and stronger transitions. Maintain the existing voice and tone. Aim for 100-150 words. Return { "html": "<p>...</p>" }.';
    case 'heading':
      return 'Suggest a more compelling, SEO-friendly heading that accurately reflects the section content. Keep it 3-8 words. Return { "text": "..." }.';
    case 'key_insights':
      return 'Sharpen existing insights and add 1-2 new ones based on the surrounding content. Each insight must be a standalone sentence. Return { "title": "...", "items": ["...", ...] }.';
    case 'callout':
      return `Strengthen this ${block.variant} callout with a more specific claim, data-backed assertion, or actionable advice. Return { "title": "...", "body": "..." }.`;
    case 'quote':
      return 'If no quote exists, suggest a relevant expert quote with attribution. If a quote exists, improve the framing. Return { "text": "...", "author": "...", "source": "..." }.';
    case 'list':
      return `Expand list items with more detail (10-30 words each) and add 1-2 relevant items. Return { "listType": "${block.listType}", "items": [{ "text": "..." }, ...] }.`;
    case 'summary':
      return 'Strengthen the synthesis with a clearer takeaway and action-oriented language. Aim for 80-120 words. Return { "body": "..." }.';
    default:
      return 'Improve this content block. Return the updated content as JSON matching the block type.';
  }
}

function serializeBlockContent(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':    return block.html.replace(/<[^>]+>/g, ' ').trim() || '(empty)';
    case 'heading':      return block.text || '(empty)';
    case 'key_insights': return block.items.filter(Boolean).join('; ') || '(empty)';
    case 'callout':      return `[${block.variant}] ${block.title}: ${block.body}`;
    case 'quote':        return `"${block.text}" — ${block.author}`;
    case 'list':         return block.items.map((i) => i.text).filter(Boolean).join('; ') || '(empty)';
    case 'summary':      return block.body || '(empty)';
    default:             return '(block)';
  }
}

function serializeContext(blocks: ContentBlock[]): string {
  return blocks
    .map((b) => `[${b.type}] ${serializeBlockContent(b)}`)
    .join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function enrichSingleBlock(input: EnrichBlockInput): Promise<EnrichBlockOutput> {
  const { companyId, block, contextBlocks, blogMeta, writingStyle } = input;

  const systemPrompt = `You are a senior content editor. You improve individual content blocks within a blog post, maintaining coherence with the surrounding content.

## BLOG CONTEXT
Title: ${blogMeta.title}
Excerpt: ${blogMeta.excerpt}
Tags: ${blogMeta.tags.join(', ')}
${writingStyle ? `\nWriting style: ${writingStyle}` : ''}

## SURROUNDING CONTENT
${serializeContext(contextBlocks)}

## TASK
${getBlockInstruction(block)}

## RULES
- Maintain the same tone and voice as the surrounding content
- Be substantive — add real value, not filler
- Keep the content aligned with the blog's topic and angle
- Return ONLY valid JSON matching the specified format`;

  const userPrompt = `Here is the current block content to improve:

[${block.type}]
${serializeBlockContent(block)}

Return the improved block as JSON.`;

  const result = await runCompletionWithOperation({
    operation:       'blockEnrich',
    companyId,
    model:           'gpt-4o-mini',
    temperature:     0.5,
    response_format: { type: 'json_object' },
    max_tokens:      1500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });

  const raw = parseModelOutputOr<any>(result.output, {}, { surface: 'blockEnrich' });

  // Merge AI output into original block (preserve id, type)
  const enriched = mergeEnrichedContent(block, raw);
  const summary = raw.changes_summary || `Enriched ${block.type} block`;

  return { enriched_block: enriched, changes_summary: summary };
}

function mergeEnrichedContent(original: ContentBlock, ai: any): ContentBlock {
  const base = { ...original };
  // Strip hint if present
  if ('hint' in base) delete (base as any).hint;

  switch (original.type) {
    case 'paragraph':
      return { ...base, html: ai.html || (original as any).html } as ContentBlock;
    case 'heading':
      return { ...base, text: ai.text || (original as any).text } as ContentBlock;
    case 'key_insights':
      return {
        ...base,
        title: ai.title || (original as any).title,
        items: Array.isArray(ai.items) ? ai.items : (original as any).items,
      } as ContentBlock;
    case 'callout':
      return {
        ...base,
        title: ai.title ?? (original as any).title,
        body: ai.body ?? (original as any).body,
      } as ContentBlock;
    case 'quote':
      return {
        ...base,
        text: ai.text ?? (original as any).text,
        author: ai.author ?? (original as any).author,
        source: ai.source ?? (original as any).source,
      } as ContentBlock;
    case 'list':
      return {
        ...base,
        items: Array.isArray(ai.items)
          ? ai.items.map((item: any) => ({
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
              text: typeof item === 'string' ? item : item?.text || '',
            }))
          : (original as any).items,
      } as ContentBlock;
    case 'summary':
      return { ...base, body: ai.body ?? (original as any).body } as ContentBlock;
    default:
      return original;
  }
}
