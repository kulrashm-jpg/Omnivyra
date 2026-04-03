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

export interface RegenerationChange {
  instruction_code: string;
  status: 'applied' | 'failed' | 'skipped';
  reason?: string;
}

export interface RegenerationResult {
  updated_blocks: ContentBlock[];
  /** Present only when FIX_TITLE_KEYWORD was applied. */
  title_change?: string;
  changes: RegenerationChange[];
}

export interface BlogForRegeneration {
  id: string;
  title: string;
  content_blocks: ContentBlock[];
  company_id: string;
}

export interface RegenerationOptions {
  /**
   * Extra context appended to each AI instruction.
   * Use this for company voice, campaign objective, platform constraints,
   * and trend signals so targeted improvements stay aligned.
   */
  additionalContext?: string;
}

// ── AI system prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'You are a professional content editor optimizing blog content for SEO, AEO, and GEO. ' +
  'Rules: do not change tone drastically; preserve meaning; improve clarity, depth, and structure. ' +
  'Always respond with valid JSON only — no markdown fences, no prose outside the JSON object.';

// ── Text utilities ────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function blockToText(block: ContentBlock): string {
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
function extractSectionText(blocks: ContentBlock[], headingBlockId: string): string {
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
function insertionIndex(
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

function insertAt<T>(arr: T[], index: number, ...items: T[]): T[] {
  return [...arr.slice(0, index), ...items, ...arr.slice(index)];
}

function withAdditionalContext(prompt: string, additionalContext?: string): string {
  const extra = (additionalContext || '').trim();
  if (!extra) return prompt;
  return `${prompt}\n\nContext to respect:\n${extra}`;
}

// ── Action: ADD_SUMMARY ───────────────────────────────────────────────────────

async function applyAddSummary(
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
      { role: 'system', content: SYSTEM_PROMPT },
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

async function applyAddFaq(
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
      { role: 'system', content: SYSTEM_PROMPT },
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

async function applyExpandSection(
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
      { role: 'system', content: SYSTEM_PROMPT },
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

async function applyAddReferences(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
  options?: RegenerationOptions,
): Promise<{ blocks: ContentBlock[]; change: RegenerationChange }> {
  const existingRefs = blocks.find(b => b.type === 'references') as ReferencesBlock | undefined;

  if (existingRefs && existingRefs.items.length >= 3) {
    return {
      blocks,
      change: { instruction_code: 'ADD_REFERENCES', status: 'skipped', reason: 'Already has 3+ references' },
    };
  }

  const result = await runCompletionWithOperation({
    companyId:       blog.company_id,
    model:           'gpt-4o-mini',
    temperature:     0.3,
    response_format: { type: 'json_object' },
    operation:       'blogOptimization',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: withAdditionalContext(
          `Generate 3 authoritative external references for the blog post titled "${blog.title}".\n\n` +
          `Requirements:\n` +
          `- Use real, well-known sources (HBR, McKinsey, Statista, official docs, major journals)\n` +
          `- Titles must be specific and realistic to the topic\n` +
          `- URLs must be plausible and correctly formatted (real domains only)\n` +
          `- Do not fabricate obscure or unverifiable sources\n\n` +
          `Respond with JSON: { "references": [{ "title": "...", "url": "..." }] }`,
          options?.additionalContext,
        ),
      },
    ],
  });

  const parsed = JSON.parse(result.output) as { references?: Array<{ title: string; url: string }> };
  if (!Array.isArray(parsed.references) || parsed.references.length === 0) {
    throw new Error('No references returned from AI');
  }

  const newItems = parsed.references.slice(0, 3).map(r => ({
    id:    newId(),
    title: r.title.trim(),
    url:   r.url.trim(),
  }));

  let updated: ContentBlock[];

  if (existingRefs) {
    // Merge into the existing references block — preserve its position.
    updated = blocks.map(b =>
      b.type === 'references'
        ? ({ ...b, items: [...(b as ReferencesBlock).items, ...newItems] } as ReferencesBlock)
        : b,
    );
  } else {
    // Append a new references block at the end.
    const refsBlock: ReferencesBlock = {
      id:    newId(),
      type:  'references',
      items: newItems,
    };
    updated = [...blocks, refsBlock];
  }

  return {
    blocks: updated,
    change: { instruction_code: 'ADD_REFERENCES', status: 'applied' },
  };
}

// ── Action: ADD_INTERNAL_LINKS ────────────────────────────────────────────────

async function applyAddInternalLinks(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
): Promise<{ blocks: ContentBlock[]; change: RegenerationChange }> {
  // Skip if 2+ internal links already exist.
  const existingLinks = blocks.filter(b => b.type === 'internal_link');
  if (existingLinks.length >= 2) {
    return {
      blocks,
      change: { instruction_code: 'ADD_INTERNAL_LINKS', status: 'skipped', reason: 'Already has 2+ internal links' },
    };
  }

  const needed = 2 - existingLinks.length;

  // Fetch recent published posts from the same company, excluding this post.
  const { data: posts } = await supabase
    .from('blogs')
    .select('id, title, slug')
    .eq('company_id', blog.company_id)
    .eq('status', 'published')
    .neq('id', blog.id)
    .order('created_at', { ascending: false })
    .limit(needed);

  if (!posts || posts.length === 0) {
    return {
      blocks,
      change: { instruction_code: 'ADD_INTERNAL_LINKS', status: 'skipped', reason: 'No related published posts found' },
    };
  }

  const linkBlocks: InternalLinkBlock[] = posts.map(p => ({
    id:    newId(),
    type:  'internal_link' as const,
    slug:  (p.slug as string | null) ?? (p.id as string),
    title: (p.title as string | null) ?? undefined,
  }));

  const pos = insertionIndex(blocks, 'before_references');
  return {
    blocks: insertAt(blocks, pos, ...linkBlocks),
    change: { instruction_code: 'ADD_INTERNAL_LINKS', status: 'applied' },
  };
}

// ── Action: ADD_HEADINGS ─────────────────────────────────────────────────────

async function applyAddHeadings(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
  options?: RegenerationOptions,
): Promise<{ blocks: ContentBlock[]; change: RegenerationChange }> {
  const existingH2 = blocks.filter((b) => b.type === 'heading' && (b as HeadingBlock).level === 2).length;
  if (existingH2 >= 4) {
    return {
      blocks,
      change: { instruction_code: 'ADD_HEADINGS', status: 'skipped', reason: 'Already has 4+ H2 sections' },
    };
  }

  const contextText = blocks
    .filter((b) => b.type === 'heading' || b.type === 'paragraph' || b.type === 'summary' || b.type === 'key_insights')
    .map(blockToText)
    .join('\n')
    .slice(0, 1800);

  const result = await runCompletionWithOperation({
    companyId: blog.company_id,
    model: 'gpt-4o-mini',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    operation: 'blogOptimization',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: withAdditionalContext(
          `Add exactly 2 new H2 sections to improve depth and flow for the blog titled "${blog.title}".\n\n` +
          `Current content snapshot:\n${contextText}\n\n` +
          `Requirements:\n` +
          `- Each section must include: heading + one paragraph\n` +
          `- Paragraph length: 90-140 words\n` +
          `- Include one practical example or concrete action per section\n` +
          `- Keep continuity with existing narrative and avoid repetition\n` +
          `- HTML in paragraph can only use <p>, <strong>, <em>, <a>\n\n` +
          `Respond with JSON:\n` +
          `{ "sections": [{ "heading": "...", "paragraph_html": "<p>...</p>" }, { "heading": "...", "paragraph_html": "<p>...</p>" }] }`,
          options?.additionalContext,
        ),
      },
    ],
  });

  const parsed = JSON.parse(result.output) as {
    sections?: Array<{ heading?: string; paragraph_html?: string }>;
  };

  const validSections = (parsed.sections || [])
    .filter((s) => s && typeof s.heading === 'string' && s.heading.trim() && typeof s.paragraph_html === 'string' && s.paragraph_html.trim())
    .slice(0, 2);

  if (validSections.length === 0) {
    throw new Error('No valid sections returned for ADD_HEADINGS');
  }

  const newBlocks: ContentBlock[] = [];
  for (const section of validSections) {
    const headingText = section.heading!.trim();
    const anchor = headingText
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-') || `section-${newId().slice(0, 8)}`;

    const h: HeadingBlock = {
      id: newId(),
      type: 'heading',
      level: 2,
      text: headingText,
      anchor,
    };
    const p: ParagraphBlock = {
      id: newId(),
      type: 'paragraph',
      html: section.paragraph_html!.trim(),
    };
    newBlocks.push(h, p);
  }

  const pos = insertionIndex(blocks, 'before_references');
  return {
    blocks: insertAt(blocks, pos, ...newBlocks),
    change: { instruction_code: 'ADD_HEADINGS', status: 'applied' },
  };
}

// ── Action: FIX_TITLE_KEYWORD ─────────────────────────────────────────────────

async function applyFixTitleKeyword(
  blog: BlogForRegeneration,
  blocks: ContentBlock[],
  options?: RegenerationOptions,
): Promise<{ blocks: ContentBlock[]; titleChange: string; change: RegenerationChange }> {
  const result = await runCompletionWithOperation({
    companyId:       blog.company_id,
    model:           'gpt-4o-mini',
    temperature:     0.4,
    response_format: { type: 'json_object' },
    operation:       'blogOptimization',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: withAdditionalContext(
          `Rewrite this blog post title so it leads with the primary keyword.\n\n` +
          `Current title: "${blog.title}"\n\n` +
          `Requirements:\n` +
          `- Front-load the most important keyword\n` +
          `- Stay under 65 characters\n` +
          `- Keep the core topic and meaning intact\n` +
          `- Make it specific and compelling for search results\n\n` +
          `Respond with JSON: { "title": "..." }`,
          options?.additionalContext,
        ),
      },
    ],
  });

  const parsed = JSON.parse(result.output) as { title?: string };
  if (!parsed.title?.trim()) throw new Error('No title returned from AI');

  return {
    blocks,
    titleChange: parsed.title.trim(),
    change: { instruction_code: 'FIX_TITLE_KEYWORD', status: 'applied' },
  };
}

// ── Main executor ─────────────────────────────────────────────────────────────

/**
 * Applies a list of OptimizationActions to a blog post sequentially.
 *
 * Each action sees the blocks as modified by prior actions.
 * A failed action records the error in changes[] and execution continues.
 * Blocks outside the target of each action are never touched.
 */
export async function applyOptimizationActions(
  blog: BlogForRegeneration,
  actions: OptimizationAction[],
  options?: RegenerationOptions,
): Promise<RegenerationResult> {
  let blocks: ContentBlock[]        = [...blog.content_blocks];
  const changes: RegenerationChange[] = [];
  let titleChange: string | undefined;

  for (const action of actions) {
    try {
      switch (action.instruction_code) {
        case 'ADD_SUMMARY': {
          const r = await applyAddSummary(blog, blocks, options);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_FAQ': {
          const r = await applyAddFaq(blog, blocks, options);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'EXPAND_SECTION': {
          const r = await applyExpandSection(blog, blocks, action, options);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_REFERENCES': {
          const r = await applyAddReferences(blog, blocks, options);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_INTERNAL_LINKS': {
          const r = await applyAddInternalLinks(blog, blocks);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'ADD_HEADINGS': {
          const r = await applyAddHeadings(blog, blocks, options);
          blocks = r.blocks;
          changes.push(r.change);
          break;
        }
        case 'FIX_TITLE_KEYWORD': {
          const r = await applyFixTitleKeyword(blog, blocks, options);
          blocks      = r.blocks;
          titleChange = r.titleChange;
          changes.push(r.change);
          break;
        }
        default: {
          changes.push({
            instruction_code: action.instruction_code,
            status:           'skipped',
            reason:           `"${action.instruction_code}" is not handled by the regeneration executor`,
          });
        }
      }
    } catch (err) {
      changes.push({
        instruction_code: action.instruction_code,
        status:           'failed',
        reason:           err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    updated_blocks: blocks,
    ...(titleChange !== undefined ? { title_change: titleChange } : {}),
    changes,
  };
}
