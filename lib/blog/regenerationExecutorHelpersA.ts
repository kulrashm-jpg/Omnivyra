/** Part of regenerationExecutor (Agent-B split — main module keeps the original path). */
import { type BlogForRegeneration, type RegenerationOptions, type RegenerationChange, effectiveSystemPrompt } from './regenerationExecutor';
/**
 * Regeneration Executor
 *
 * Applies targeted OptimizationActions to a blog post's content_blocks.
 *
 * Design rules:
 *   - Surgical updates only — never replaces the entire content_blocks array.
 *   - Each action targets a specific block or appends to a specific position.
 *   - AI is only used for text generation; block structure is deterministic.
 *   - Actions are applied sequentially so each action sees the prior result.
 *   - A failed action records an error in changes[] and execution continues.
 *
 * Supported instruction codes:
 *   ADD_SUMMARY        — Insert a summary block near the top.
 *   ADD_FAQ            — Append a FAQ section (heading + callout pairs).
 *   EXPAND_SECTION     — Replace paragraph(s) in a target section with AI-expanded text.
 *   ADD_REFERENCES     — Append (or merge) a references block.
 *   ADD_INTERNAL_LINKS — Insert internal_link blocks from other company posts.
 *   ADD_HEADINGS       — Add 2 strategic H2 sections with paragraph content.
 *   FIX_TITLE_KEYWORD  — Rewrite the post title to lead with its primary keyword.
 */

import { newId } from './blockUtils';
import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { supabase } from '../../backend/db/supabaseClient';
import type {
  ContentBlock,
  SummaryBlock,
  HeadingBlock,
  ParagraphBlock,
  CalloutBlock,
  ReferencesBlock,
  InternalLinkBlock,
} from './blockTypes';
import type { OptimizationAction } from './optimizationEngine';

// ── Public types ──────────────────────────────────────────────────────────────


// ── Text utilities ────────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function blockToText(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':    return stripHtml(block.html);
    case 'heading':      return block.text;
    case 'callout':      return `${block.title ?? ''} ${block.body}`.trim();
    case 'summary':      return block.body;
    case 'key_insights': return block.items.join('. ');
    case 'list':         return block.items.map(i => i.text).join('. ');
    case 'quote':        return block.text;
    default:             return '';
  }
}

/**
 * Extracts the plain-text content of the section that starts with the given
 * heading block id, stopping at the next heading (or end of document).
 */
export function extractSectionText(blocks: ContentBlock[], headingBlockId: string): string {
  let inSection = false;
  const parts: string[] = [];

  for (const b of blocks) {
    if (b.id === headingBlockId) { inSection = true; continue; }
    if (!inSection) continue;
    if (b.type === 'heading') break;
    const t = blockToText(b);
    if (t) parts.push(t);
  }

  return parts.join('\n\n');
}

// ── Insertion position helpers ────────────────────────────────────────────────

/** Returns the index at which new blocks should be inserted. */
export function insertionIndex(
  blocks: ContentBlock[],
  strategy: 'top' | 'before_references' | 'end',
): number {
  if (strategy === 'top') {
    // After key_insights if one exists, otherwise at position 0.
    const ki = blocks.findIndex(b => b.type === 'key_insights');
    return ki >= 0 ? ki + 1 : 0;
  }
  if (strategy === 'before_references') {
    const ri = blocks.findIndex(b => b.type === 'references');
    return ri >= 0 ? ri : blocks.length;
  }
  return blocks.length;
}

export function insertAt<T>(arr: T[], index: number, ...items: T[]): T[] {
  return [...arr.slice(0, index), ...items, ...arr.slice(index)];
}

export function withAdditionalContext(prompt: string, additionalContext?: string): string {
  const extra = (additionalContext || '').trim();
  if (!extra) return prompt;
  return `${prompt}\n\nContext to respect:\n${extra}`;
}

// ── Action: ADD_SUMMARY ───────────────────────────────────────────────────────

export async function applyAddSummary(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
  options?: RegenerationOptions,
): Promise<{ blocks: ContentBlock[]; change: RegenerationChange }> {
  // Skip if a summary already exists — let a targeted EXPAND action handle it.
  if (blocks.some(b => b.type === 'summary')) {
    return {
      blocks,
      change: { instruction_code: 'ADD_SUMMARY', status: 'skipped', reason: 'Summary block already exists' },
    };
  }

  const contextText = blocks
    .filter(b => b.type === 'paragraph' || b.type === 'heading')
    .slice(0, 8)
    .map(blockToText)
    .join('\n')
    .slice(0, 1500);

  const result = await runCompletionWithOperation({
    companyId:       blog.company_id,
    model:           'gpt-4o-mini',
    temperature:     0.4,
    response_format: { type: 'json_object' },
    operation:       'blogOptimization',
    messages: [
      { role: 'system', content: effectiveSystemPrompt(options) },
      {
        role: 'user',
        content: withAdditionalContext(
          `Write a 2–3 sentence summary for the blog post titled "${blog.title}".\n\n` +
          `The summary must capture the core value for readers who skim, ` +
          `and should be at least 40 words.\n\n` +
          `Content excerpt:\n${contextText}\n\n` +
          `Respond with JSON: { "summary": "..." }`,
          options?.additionalContext,
        ),
      },
    ],
  });

  const parsed = JSON.parse(result.output) as { summary?: string };
  if (!parsed.summary?.trim()) throw new Error('No summary returned from AI');

  const summaryBlock: SummaryBlock = {
    id:   newId(),
    type: 'summary',
    body: parsed.summary.trim(),
  };

  const pos = insertionIndex(blocks, 'top');
  return {
    blocks: insertAt(blocks, pos, summaryBlock),
    change: { instruction_code: 'ADD_SUMMARY', status: 'applied' },
  };
}

// ── Action: ADD_FAQ ───────────────────────────────────────────────────────────

export async function applyAddFaq(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
  options?: RegenerationOptions,
): Promise<{ blocks: ContentBlock[]; change: RegenerationChange }> {
  // Skip if an FAQ heading already exists.
  const hasFaq = blocks.some(
    b => b.type === 'heading' && /faq|frequently asked/i.test((b as HeadingBlock).text),
  );
  if (hasFaq) {
    return {
      blocks,
      change: { instruction_code: 'ADD_FAQ', status: 'skipped', reason: 'FAQ section already present' },
    };
  }

  const contextText = blocks
    .filter(b => b.type === 'paragraph' || b.type === 'heading')
    .map(blockToText)
    .join('\n')
    .slice(0, 2000);

  const result = await runCompletionWithOperation({
    companyId:       blog.company_id,
    model:           'gpt-4o-mini',
    temperature:     0.5,
    response_format: { type: 'json_object' },
    operation:       'blogOptimization',
    messages: [
      { role: 'system', content: effectiveSystemPrompt(options) },
      {
        role: 'user',
        content: withAdditionalContext(
          `Generate 4 FAQ pairs for the blog post titled "${blog.title}".\n\n` +
          `Rules:\n` +
          `- Each answer must be 30–60 words\n` +
          `- Cover different angles — do not repeat the same point\n` +
          `- Write answers in plain, direct language\n\n` +
          `Content:\n${contextText}\n\n` +
          `Respond with JSON: { "pairs": [{ "question": "...", "answer": "..." }] }`,
          options?.additionalContext,
        ),
      },
    ],
  });

  const parsed = JSON.parse(result.output) as { pairs?: Array<{ question: string; answer: string }> };
  if (!Array.isArray(parsed.pairs) || parsed.pairs.length === 0) {
    throw new Error('No FAQ pairs returned from AI');
  }

  const faqHeading: HeadingBlock = {
    id:     newId(),
    type:   'heading',
    level:  2,
    text:   'Frequently Asked Questions',
    anchor: 'frequently-asked-questions',
  };

  const faqBlocks: CalloutBlock[] = parsed.pairs.slice(0, 5).map(p => ({
    id:      newId(),
    type:    'callout',
    variant: 'insight',
    title:   p.question.trim(),
    body:    p.answer.trim(),
  }));

  const pos = insertionIndex(blocks, 'before_references');
  return {
    blocks: insertAt(blocks, pos, faqHeading, ...faqBlocks),
    change: { instruction_code: 'ADD_FAQ', status: 'applied' },
  };
}

// ── Action: EXPAND_SECTION ────────────────────────────────────────────────────

export async function applyExpandSection(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
  action: OptimizationAction,
  options?: RegenerationOptions,
): Promise<{ blocks: ContentBlock[]; change: RegenerationChange }> {
  if (!action.target_block_id) {
    return {
      blocks,
      change: { instruction_code: 'EXPAND_SECTION', status: 'skipped', reason: 'No target_block_id provided' },
    };
  }

  const headingIdx = blocks.findIndex(
    b => b.id === action.target_block_id && b.type === 'heading',
  );
  if (headingIdx === -1) {
    return {
      blocks,
      change: {
        instruction_code: 'EXPAND_SECTION',
        status: 'skipped',
        reason: `Heading block "${action.target_block_id}" not found`,
      },
    };
  }

  const headingBlock  = blocks[headingIdx] as HeadingBlock;
  const sectionText   = extractSectionText(blocks, action.target_block_id);

  const result = await runCompletionWithOperation({
    companyId:       blog.company_id,
    model:           'gpt-4o-mini',
    temperature:     0.5,
    response_format: { type: 'json_object' },
    operation:       'blogOptimization',
    messages: [
      { role: 'system', content: effectiveSystemPrompt(options) },
      {
        role: 'user',
        content: withAdditionalContext(
          `Expand the section titled "${headingBlock.text}" from the blog post "${blog.title}".\n\n` +
          `Current content:\n${sectionText || '(empty)'}\n\n` +
          `Requirements:\n` +
          `- Rewrite to 80–120 words\n` +
          `- Include one concrete, practical example\n` +
          `- Preserve the original tone and meaning\n` +
          `- Return valid HTML using only <p>, <strong>, <em>, and <a> tags\n\n` +
          `Respond with JSON: { "expanded_html": "<p>...</p>" }`,
          options?.additionalContext,
        ),
      },
    ],
  });

  const parsed = JSON.parse(result.output) as { expanded_html?: string };
  if (!parsed.expanded_html?.trim()) throw new Error('No expanded content returned from AI');

  const newParagraph: ParagraphBlock = {
    id:   newId(),
    type: 'paragraph',
    html: parsed.expanded_html.trim(),
  };

  // Find where this section ends (next heading or document end).
  let sectionEndIdx = blocks.length;
  for (let i = headingIdx + 1; i < blocks.length; i++) {
    if (blocks[i].type === 'heading') { sectionEndIdx = i; break; }
  }

  // Replace all paragraph blocks in the section with the new expanded one.
  // Non-paragraph blocks (callouts, quotes, lists) are preserved after it.
  const sectionNonParagraphs = blocks
    .slice(headingIdx + 1, sectionEndIdx)
    .filter(b => b.type !== 'paragraph');

  const updated: ContentBlock[] = [
    ...blocks.slice(0, headingIdx + 1),
    newParagraph,
    ...sectionNonParagraphs,
    ...blocks.slice(sectionEndIdx),
  ];

  return {
    blocks: updated,
    change: { instruction_code: 'EXPAND_SECTION', status: 'applied' },
  };
}

// ── Action: ADD_REFERENCES ────────────────────────────────────────────────────

