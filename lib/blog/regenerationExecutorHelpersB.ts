/** Part of regenerationExecutor (Agent-B split — main module keeps the original path). */
import { type BlogForRegeneration, type RegenerationOptions, type RegenerationChange, effectiveSystemPrompt } from './regenerationExecutor';
import { parseModelOutputOr } from '../../backend/services/ai/safety';
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

import { applyAddFaq, applyAddSummary, applyExpandSection, blockToText, extractSectionText, insertAt, insertionIndex, stripHtml, withAdditionalContext } from './regenerationExecutorHelpersA';

export async function applyAddReferences(
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
      { role: 'system', content: effectiveSystemPrompt(options) },
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

  const parsed = parseModelOutputOr<{ references?: Array<{ title: string; url: string }> }>(result.output, {}, { surface: 'blog.regen.refs' });
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

export async function applyAddInternalLinks(
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

export async function applyAddHeadings(
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
      { role: 'system', content: effectiveSystemPrompt(options) },
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

  const parsed = parseModelOutputOr<any>(result.output, {}, { surface: 'blog.regen.multi' }) as {
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

export async function applyFixTitleKeyword(
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
      { role: 'system', content: effectiveSystemPrompt(options) },
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

  const parsed = parseModelOutputOr<{ title?: string }>(result.output, {}, { surface: 'blog.regen.title' });
  if (!parsed.title?.trim()) throw new Error('No title returned from AI');

  return {
    blocks,
    titleChange: parsed.title.trim(),
    change: { instruction_code: 'FIX_TITLE_KEYWORD', status: 'applied' },
  };
}

