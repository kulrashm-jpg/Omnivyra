/** Blog generation — assembly pipeline, validation, entrypoints — split from blogGenerationEngine.ts (barrel preserved; importers unchanged). */
/**
 * Blog Generation Engine
 *
 * Builds prompts for two AI calls:
 *   1. Angle generation  — 3 strategic directions (analytical / contrarian / strategic)
 *   2. Full generation   — complete publication-ready blog for the chosen angle
 *
 * Hard rules baked into prompts:
 *   - No hallucination — reason from first principles if unsure
 *   - Narrative construction, not content dumping
 *   - Required structure: Key Insights → executive intro → 3–5 H2s → Summary → References
 *   - Minimum 2–3 real references
 *   - Thought leadership tone — analytical, never promotional
 */

import { getStructureRules, getArticleStructureRules, getWhitepaperStructureRules, getNewsletterStructureRules, getStoryStructureRules, getGuideStructureRules, isValidArticleFormat, isValidWhitepaperFormat, isValidNewsletterFormat, isValidStoryFormat, isValidGuideFormat, type BlogFormatType, type ArticleFormatType, type WhitepaperFormatType, type NewsletterFormatType, type StoryFormatType, type GuideFormatType } from './blogStructureTemplates';
import {
  type CompanyIdentity,
  buildIdentityLock,
  buildAntiGenericRules,
} from '../content/companyContextBlock';
import type { OrganizationPerspective } from '../../backend/services/longForm/organizationPerspectiveEngine';

/**
 * Wrap a base system prompt with mandatory company enforcement.
 * Prepends identity lock (includes strategy perspective) and appends
 * anti-generic rules. Returns base unchanged when identity is empty
 * so zero-context flows are unaffected.
 */
import { wrapWithCompanyEnforcement, type BlogAngle, type BlogGenerationInput, type BlogGenerationOutput } from './blogGenerationEngineCore';

export function validateGenerationOutput(raw: unknown): BlogGenerationOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const title                = typeof r.title                === 'string' ? r.title.trim()                : '';
  const excerpt              = typeof r.excerpt              === 'string' ? r.excerpt.trim()              : '';
  const content_html         = typeof r.content_html         === 'string' ? r.content_html.trim()         : '';
  const category             = typeof r.category             === 'string' ? r.category.trim()             : '';
  const seo_meta_title       = typeof r.seo_meta_title       === 'string' ? r.seo_meta_title.trim()       : '';
  const seo_meta_description = typeof r.seo_meta_description === 'string' ? r.seo_meta_description.trim() : '';

  const tags         = Array.isArray(r.tags)         ? (r.tags as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).trim()) : [];
  const key_insights = Array.isArray(r.key_insights) ? (r.key_insights as unknown[]).filter(t => typeof t === 'string').map(t => (t as string).trim()) : [];

  if (!title || !content_html) return null;

  return { title, excerpt, content_html, tags, category, seo_meta_title, seo_meta_description, key_insights };
}

// ── Fallback angles ───────────────────────────────────────────────────────────

export function buildFallbackAngles(topic: string): BlogAngle[] {
  const short = topic.length > 50 ? topic.slice(0, 50) + '…' : topic;
  return [
    {
      type:          'analytical',
      label:         'Analytical',
      title:         `The Data Behind ${short}`,
      angle_summary: 'Examines the evidence, patterns, and causal relationships that explain why this matters.',
      hook:          'The numbers tell a story most practitioners are too busy to read.',
    },
    {
      type:          'contrarian',
      label:         'Contrarian',
      title:         `Why Everything You Know About ${short} Is Wrong`,
      angle_summary: 'Challenges the dominant narrative and exposes the assumptions that lead teams astray.',
      hook:          'The prevailing advice on this topic has a quiet but expensive flaw.',
    },
    {
      type:          'strategic',
      label:         'Strategic',
      title:         `How to Turn ${short} Into a Competitive Advantage`,
      angle_summary: 'Connects the topic directly to business outcomes and shows leaders how to act on it.',
      hook:          'Most companies treat this as a tactic. The ones winning treat it as infrastructure.',
    },
  ];
}

// ── Deterministic fallback ────────────────────────────────────────────────────

export function buildGenerationFallback(input: BlogGenerationInput): BlogGenerationOutput {
  const title = input.selected_angle?.title ?? (input.topic.length > 80 ? input.topic.slice(0, 80) : input.topic);

  const content_html = `<div class="key-insights">
<ul>
<li>Add your first key insight here</li>
<li>Add your second key insight here</li>
<li>Add your third key insight here</li>
</ul>
</div>

<p>${input.selected_angle?.hook ?? 'Start your introduction here — open with a sharp insight or surprising observation.'}</p>

<h2>Section One</h2>
<p>Develop your first major point here.</p>

<h2>Section Two</h2>
<p>Build on section one here.</p>

<h2>Section Three</h2>
<p>Drive toward your conclusion here.</p>

<h2>Summary</h2>
<p>Distil the most important takeaways and tell the reader what to do next.</p>

<h2>References</h2>
<ol>
<li><a href="#">Add your first reference</a></li>
<li><a href="#">Add your second reference</a></li>
</ol>`;

  return {
    title,
    excerpt:              '',
    content_html,
    tags:                 input.cluster ? [input.cluster] : [],
    category:             input.cluster ?? '',
    seo_meta_title:       title.slice(0, 60),
    seo_meta_description: '',
    key_insights:         [],
  };
}

// ── Template-Aware Generation ────────────────────────────────────────────────
// When a user provides a template (ContentBlock[] with hints), the AI fills
// each block's content directly instead of generating monolithic HTML.

import type { ContentBlock } from './blockTypes';

/**
 * Serialize a template block into a human-readable description for the prompt.
 */
function describeBlock(block: ContentBlock, depth = 0): string {
  const indent = '  '.repeat(depth);
  const hint = (block as any).hint ? ` — "${(block as any).hint}"` : '';

  switch (block.type) {
    case 'paragraph':
      return `${indent}- PARAGRAPH${hint || ' — "Write substantive content relevant to the surrounding headings and topic"}'}`;
    case 'heading':
      return `${indent}- H${block.level} HEADING${hint || ' — "Write a concise, descriptive heading for this section"'}`;
    case 'key_insights':
      return `${indent}- KEY INSIGHTS (${block.items.length} items)${hint || ' — "Summarize the most important takeaways"'}`;
    case 'callout':
      return `${indent}- CALLOUT (${block.variant})${hint || ` — "Write an important ${block.variant} for the reader"`}`;
    case 'quote':
      return `${indent}- QUOTE${hint || ' — "Provide a relevant expert quote with attribution"'}`;
    case 'image':
      return `${indent}- IMAGE${hint || ' — "Provide descriptive alt text and caption for an illustrative image"'}`;
    case 'media':
      return `${indent}- MEDIA EMBED${hint}`;
    case 'divider':
      return `${indent}- DIVIDER`;
    case 'list':
      return `${indent}- ${block.listType.toUpperCase()} LIST (${block.items.length} items)${hint || ' — "Write substantive list items relevant to this section"'}`;
    case 'references':
      return `${indent}- REFERENCES (${block.items.length} sources)${hint || ` — "Provide ${block.items.length} credible source references"`}`;
    case 'summary':
      return `${indent}- SUMMARY${hint || ' — "Synthesize the article into a concise conclusion"'}`;
    case 'internal_link':
      return `${indent}- INTERNAL LINK`;
    case 'columns':
      const colLines = block.columns.map((col, ci) => {
        const innerLines = col.blocks.map((b) => describeBlock(b, depth + 2));
        return `${indent}  Column ${ci + 1}:\n${innerLines.join('\n') || `${indent}    (empty)`}`;
      });
      return `${indent}- ${block.columnCount}-COLUMN LAYOUT:\n${colLines.join('\n')}`;
    default:
      return `${indent}- ${(block as any).type?.toUpperCase() ?? 'BLOCK'}${hint}`;
  }
}

function serializeTemplateStructure(blocks: ContentBlock[]): string {
  return blocks.map((b, i) => `Block ${i + 1}: ${describeBlock(b)}`).join('\n');
}

type TemplateSectionSummary = {
  title: string;
  blockTypes: string[];
  hints: string[];
};

function summarizeTemplateSections(blocks: ContentBlock[]): TemplateSectionSummary[] {
  const sections: TemplateSectionSummary[] = [];
  let current: TemplateSectionSummary | null = null;

  const ensureSection = (fallbackTitle: string) => {
    if (!current) {
      current = { title: fallbackTitle, blockTypes: [], hints: [] };
      sections.push(current);
    }
    return current;
  };

  const pushBlock = (block: ContentBlock, nested = false) => {
    if (block.type === 'heading' && block.level === 2 && !nested) {
      const headingTitle = block.text?.trim() || (block as any).hint?.trim() || `Section ${sections.length + 1}`;
      current = { title: headingTitle, blockTypes: ['heading'], hints: [] };
      if ((block as any).hint?.trim()) current.hints.push((block as any).hint.trim());
      sections.push(current);
      return;
    }

    const target = ensureSection(sections.length === 0 ? 'Introduction and setup' : `Section ${sections.length}`);
    target.blockTypes.push(block.type);

    const hint = typeof (block as any).hint === 'string' ? (block as any).hint.trim() : '';
    if (hint) target.hints.push(hint);

    if (block.type === 'columns') {
      for (const column of block.columns) {
        for (const inner of column.blocks) pushBlock(inner, true);
      }
    }
  };

  for (const block of blocks) pushBlock(block);

  return sections.map((section) => ({
    title: section.title,
    blockTypes: Array.from(new Set(section.blockTypes)),
    hints: Array.from(new Set(section.hints)).slice(0, 3),
  }));
}

function buildTemplateSectionGuidance(template: ContentBlock[]): string {
  const sections = summarizeTemplateSections(template);
  if (sections.length === 0) return '';

  const lines: string[] = ['## SECTION MAPPING RULES'];
  lines.push('Do not spread every input evenly across the whole article.');
  lines.push('Attach each chosen directive to the section where it is most relevant, based on the section title, block types, and hints below.');
  lines.push('Use campaign objective most strongly in the outcome / why-it-matters / action sections.');
  lines.push('Use trend context most strongly in context-setting, market-shift, or why-now sections.');
  lines.push('Use must-include points in the sections where they naturally belong, not as a forced checklist in every block.');
  lines.push('Use uniqueness directive to shape the strongest differentiating section and the article thesis.');

  sections.forEach((section, index) => {
    const hints = section.hints.length > 0 ? ` | hints: ${section.hints.join(' ; ')}` : '';
    lines.push(`${index + 1}. ${section.title} | block types: ${section.blockTypes.join(', ')}${hints}`);
  });

  return lines.join('\n');
}

/**
 * Build the generation output schema description for template-aware generation.
 * The AI returns a JSON object matching the template structure.
 */
function buildTemplateOutputSchema(blocks: ContentBlock[]): string {
  const lines: string[] = [];
  lines.push('Return a JSON object with these fields:');
  lines.push('{');
  lines.push('  "title": "SEO-optimized article title",');
  lines.push('  "excerpt": "2-sentence meta description",');
  lines.push('  "tags": ["tag1", "tag2", ...],');
  lines.push('  "category": "article category",');
  lines.push('  "seo_meta_title": "title for search (max 60 chars)",');
  lines.push('  "seo_meta_description": "meta description (max 160 chars)",');
  lines.push('  "key_insights": ["insight 1", "insight 2", ...],');
  lines.push('  "blocks": [');
  lines.push('    // One entry per block in the template, IN ORDER.');
  lines.push('    // Each entry fills that block\'s content:');
  lines.push('    // For paragraph: { "html": "<p>...</p>" }');
  lines.push('    // For heading:   { "text": "..." }');
  lines.push('    // For key_insights: { "items": ["...", "..."] }');
  lines.push('    // For callout:   { "title": "...", "body": "..." }');
  lines.push('    // For quote:     { "text": "...", "author": "...", "source": "..." }');
  lines.push('    // For image:     { "alt": "descriptive alt text aligned to the article topic", "caption": "contextual caption explaining the image relevance" }');
  lines.push('    // For list:      { "items": [{ "text": "..." }, ...] }');
  lines.push('    // For summary:   { "body": "..." }');
  lines.push('    // For references: { "items": [{ "title": "...", "url": "..." }, ...] }');
  lines.push('    // For divider:   {} (no content needed)');
  lines.push('    // For columns:   { "columns": [ { "blocks": [... filled inner blocks ...] }, ... ] }');
  lines.push('  ]');
  lines.push('}');
  return lines.join('\n');
}

export function buildTemplateAwareSystemPrompt(
  targetWordCount: number,
  contentType: string,
  template: ContentBlock[],
): string {
  const tw = targetWordCount;
  const structure = serializeTemplateStructure(template);
  // Count total paragraph blocks (including those inside columns)
  const paraCount = template.filter((b) => b.type === 'paragraph').length
    + template.reduce((n, b) => b.type === 'columns'
      ? n + b.columns.reduce((cn, c) => cn + c.blocks.filter((ib) => ib.type === 'paragraph').length, 0)
      : n, 0);
  const avgWordsPerBlock = Math.max(120, Math.round(tw / Math.max(1, paraCount)));
  const minWordsPerBlock = Math.max(100, Math.round(avgWordsPerBlock * 0.75));
  const paragraphTagGuidance =
    tw >= 2000 ? '3-5 <p> elements' :
    tw >= 1600 ? '2-4 <p> elements' :
    tw >= 1200 ? '2-3 <p> elements' :
    '1-3 <p> elements';

  return `You are a senior ${contentType} content strategist. You fill pre-designed content templates with high-quality, publication-ready content.

## YOUR TASK
You are given a template structure (a sequence of typed content blocks). Fill EVERY block with substantive content about the provided topic. Each block type has specific content requirements.

## TEMPLATE STRUCTURE
${structure}

## CONTENT RULES
- TARGET WORD COUNT: ${tw} words (±15%). This is the #1 constraint. YOU MUST REACH AT LEAST ${Math.round(tw * 0.85)} words.
- Distribute words proportionally across blocks. Paragraph blocks should average ${Math.round(tw / Math.max(1, paraCount))} words each — NEVER write a paragraph under 80 words.
- For ${tw}+ word targets: paragraphs should be 100-200 words each with multiple sentences, concrete examples, data points, and analysis.
- Paragraph HTML must use <p>, <strong>, <em>, and <a> tags. No other HTML elements.
- Headings must be concise (3-8 words) and descriptive.
- Key insights must be complete sentences, each expressing a standalone takeaway.
- Lists must have substantive items (10-30 words each), not single-word bullets.
- Summary must synthesize the article's key arguments, not just repeat headings.
- References must have real, plausible titles and URLs.
- For columns: fill each column's blocks independently but ensure they relate to each other contextually (e.g., comparison columns should compare the same criteria).

## QUALITY STANDARDS
- Thought leadership tone — analytical, evidence-based, never promotional
- Concrete examples, data points, and practitioner implications
- Each paragraph: 60-120 words, no single-sentence paragraphs
- Narrative flow: each section should logically lead to the next
- No hallucination — reason from first principles if data is unavailable

## OUTPUT FORMAT
${buildTemplateOutputSchema(template)}

The "blocks" array MUST have exactly ${template.length} entries, one per template block, in order.`;
}

export function buildTemplateAwareUserPrompt(
  input: BlogGenerationInput,
  template: ContentBlock[],
): string {
  const lines: string[] = [];
  const templateName = typeof input.templateName === 'string' ? input.templateName.trim().toLowerCase() : '';
  const isNewsletter = input.contentType === 'newsletter';
  const isInsightLetter = isNewsletter && input.formatType === 'insight-letter';
  const isMinimalThesis = templateName === 'minimal thesis';
  const isSplitScreenInsight = templateName === 'split-screen insight';

  lines.push(`## TOPIC: ${input.topic}`);

  if (input.selected_angle) {
    lines.push(`\n## ANGLE: ${input.selected_angle.title}`);
    lines.push(input.selected_angle.angle_summary);
  }

  if (input.answers) {
    const companyLines: string[] = [];
    if (input.answers.companyName) companyLines.push(`Company: ${input.answers.companyName}`);
    if (input.answers.industry) companyLines.push(`Industry: ${input.answers.industry}`);
    if (input.answers.audience || input.answers.target_audience) companyLines.push(`Target audience: ${input.answers.audience || input.answers.target_audience}`);
    if (input.answers.company_context) companyLines.push(`Context: ${input.answers.company_context}`);
    if (companyLines.length > 0) {
      lines.push(`\n## COMPANY CONTEXT\n${companyLines.join('\n')}`);
    }
    if (input.answers.uniqueness_directive) {
      lines.push(`\n## UNIQUENESS DIRECTIVE: ${input.answers.uniqueness_directive}`);
    }
    // Phase 2.7 — Section-level strategic assignments are the primary
    // anchor-distribution mechanism. The model receives per-section
    // bundles rather than a single comma-joined checklist.
    if (input.answers.section_strategic_assignments) {
      lines.push(`\n## ${input.answers.section_strategic_assignments}`);
    }
    if (input.answers.must_include_points) {
      lines.push(`\n## MUST-INCLUDE POINTS: ${input.answers.must_include_points}`);
    }
    if (input.answers.strategy_perspective) {
      lines.push(`\n## STRATEGIC PERSPECTIVE\n${input.answers.strategy_perspective}`);
    }
    if (input.answers.campaign_objective) {
      lines.push(`\n## CAMPAIGN OBJECTIVE: ${input.answers.campaign_objective}`);
    }
    if (input.answers.trend_context) {
      lines.push(`\n## TREND CONTEXT: ${input.answers.trend_context}`);
    }
  }

  if (input.unifiedPromptContext) {
    lines.push(`\n## INTELLIGENCE CONTEXT\n${input.unifiedPromptContext}`);
  }

  const sectionGuidance = buildTemplateSectionGuidance(template);
  if (sectionGuidance) {
    lines.push(`\n${sectionGuidance}`);
  }

  if (isInsightLetter) {
    lines.push('\n## INSIGHT LETTER CONTRACT');
    lines.push('- The final newsletter must clearly deliver Hook, Context, Insight, Expansion, Implication, and Closing.');
    lines.push('- The core idea should feel original, specific, and reusable, not like a generic article summary.');
    lines.push('- Use at least one concrete example, recognizable pattern, or grounded scenario so the argument is not abstract.');
    lines.push('- Key Insights and Summary must be strong enough to stand alone in AI answers, forwarding, and inbox previews.');
    lines.push('- The writing should leave the reader with a changed lens, not just information.');
  }

  if (isMinimalThesis) {
    lines.push('\n## MINIMAL THESIS DEPTH CONTRACT');
    lines.push('- Give real weight to Hook, Insight, Expansion, and Implication. These sections cannot read like placeholders.');
    lines.push('- Build the idea through first-principles reasoning, a reusable mental model, and one grounded scenario or pattern.');
    lines.push('- Make the quote block genuinely memorable and thesis-sharpening.');
    lines.push('- The summary must synthesize the thesis and the resulting decision or perspective shift.');
    lines.push('- Keep the exact section sequence visible: Hook, Context, Insight, Expansion, Implication, Closing. Do not merge or skip them.');
    lines.push('- Key Insights, quote, callout, and summary should each add something distinct so the letter is structurally complete and GEO-friendly.');
  }

  if (isSplitScreenInsight) {
    lines.push('\n## SPLIT-SCREEN INSIGHT CONTRACT');
    lines.push('- Make the contrast between the surface story and the deeper reality unmistakably clear and useful.');
    lines.push('- The framing callout, quote, and summary must all be extractable on their own.');
    lines.push('- The surface story should sound plausible; the deeper reality should reveal the hidden mechanism or second-order effect.');
    lines.push('- Turn that contrast into a practical implication the reader can actually use.');
    lines.push('- Add enough body depth that the contrast feels argued, not merely stated. Use one grounded example, clear mechanism, and an earned implication.');
  }

  if (input.series_summaries?.length) {
    lines.push('\n## SERIES CONTEXT (prior articles):');
    for (const s of input.series_summaries) {
      lines.push(`- "${s.title}": ${s.summary}`);
    }
  }

  const tw = input.answers?.target_word_count ? parseInt(String(input.answers.target_word_count), 10) : 1200;
  lines.push(`\n## WORD COUNT TARGET: ${tw} words (MANDATORY)`);
  lines.push(`Fill all ${template.length} blocks in the template. The total content must be ${tw} words (±15%).`);

  return lines.join('\n');
}

export function buildTemplateAwareSystemPromptV2(
  targetWordCount: number,
  contentType: string,
  template: ContentBlock[],
  templateName?: string,
  companyIdentity?: CompanyIdentity,
): string {
  const tw = targetWordCount;
  const structure = serializeTemplateStructure(template);
  const normalizedTemplateName = typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
  const paraCount = template.filter((b) => b.type === 'paragraph').length
    + template.reduce((n, b) => b.type === 'columns'
      ? n + b.columns.reduce((cn, c) => cn + c.blocks.filter((ib) => ib.type === 'paragraph').length, 0)
      : n, 0);
  const avgWordsPerBlock = Math.max(120, Math.round(tw / Math.max(1, paraCount)));
  const minWordsPerBlock = Math.max(100, Math.round(avgWordsPerBlock * 0.75));
  const paragraphTagGuidance =
    tw >= 2000 ? '3-5 <p> elements' :
    tw >= 1600 ? '2-4 <p> elements' :
    tw >= 1200 ? '2-3 <p> elements' :
    '1-3 <p> elements';

  const base = `You are a senior ${contentType} content strategist. You fill pre-designed content templates with high-quality, publication-ready content.

## YOUR TASK
You are given a template structure (a sequence of typed content blocks). Fill EVERY block with substantive content about the provided topic. Each block type has specific content requirements.

## TEMPLATE STRUCTURE
${structure}

## CONTENT RULES
- TARGET WORD COUNT: ${tw} words (+/-15%). This is the #1 constraint. YOU MUST REACH AT LEAST ${Math.round(tw * 0.85)} words.
- Distribute words proportionally across blocks. Paragraph blocks are the main depth carriers and should average about ${avgWordsPerBlock} words each.
- Treat ${minWordsPerBlock} words per paragraph block as the practical minimum unless the block is clearly just a short transition.
- A single paragraph block may contain ${paragraphTagGuidance} when needed. Do not assume one block means one short paragraph.
- For body sections, use layered depth: explanation + example + implication + action step where relevant.
- The draft is INVALID unless all must_include_points are materially covered in the body. Mentioning them is not sufficient - they must be explained, demonstrated, or applied.
- STRATEGIC PERSPECTIVE (MANDATORY): You must reflect the company's perspective, beliefs, and differentiation in every section.
- Paragraph HTML must use only <p>, <strong>, <em>, and <a> tags. No other HTML elements.
- Headings must be concise (3-8 words) and descriptive.
- Key insights must be complete sentences, each expressing a standalone takeaway.
- Lists must have substantive items (10-30 words each), not single-word bullets.
- Summary must synthesize the article's key arguments, not just repeat headings.
- References must have real, plausible titles and URLs.
- For columns: fill each column's blocks independently but ensure they relate to each other contextually.
- Fill EVERY substantive block. Never leave paragraph HTML empty, headings blank, or list items skeletal.
${normalizedTemplateName === 'comparison' ? '- For comparison templates: compare the same decision criteria across both options, explain tradeoffs explicitly, and make every verdict scenario-specific.\n- In comparison columns, each option needs real analysis plus concrete strengths or limitations, not headline bullets only.' : ''}
${normalizedTemplateName === 'tutorial' ? '- For tutorial templates: every step needs action, rationale, and at least one caution, check, or implementation note.' : ''}
${normalizedTemplateName === 'magazine' ? '- For magazine templates: quotes, columns, and visual moments should deepen the editorial argument instead of replacing it.' : ''}
${normalizedTemplateName === 'visual feature' ? '- For visual feature templates: images can support the story, but the written sections must still carry full analytical weight.\n- Fill every H2 heading, write a complete summary, include at least 3 credible references, and give every image block both a descriptive alt text and a contextual caption.' : ''}
${normalizedTemplateName === 'comparison' ? '- For comparison templates: every top-level H2 must be filled, the verdict callout must be decisive, the summary must be complete, and the references block must include at least 3 credible sources.' : ''}
${contentType === 'newsletter' ? '- For newsletter templates: write for forwarding and extraction. Key insights, callouts, quotes, and summary blocks must be sharp enough to stand alone in inbox previews, AI answers, and social sharing.\n- Make every section feel like part of one coherent letter, not detached article fragments.\n- Use current, concrete stakes so the newsletter feels timely and reader-relevant right now.' : ''}
${contentType === 'newsletter' ? '- For newsletter templates: do not underwrite the main idea. Build depth through reasoning, concrete examples, recognizable patterns, and clear implications for the reader.\n- Every substantive newsletter paragraph must feel complete and standalone, not like a note to expand later.' : ''}
${contentType === 'newsletter' ? '- For insight-letter newsletters specifically: the reader must be able to point to a clear hook, context, insight, expansion, implication, and closing by the time the draft is finished.' : ''}
${normalizedTemplateName === 'minimal thesis' ? '- For the Minimal Thesis template: the writing must feel like original thinking, not curated recap. Build the argument through first-principles reasoning, one reusable mental model, and a memorable perspective shift.\n- The hook must carry real tension, the insight must explain the mechanism, and the closing synthesis must feel quotable and complete.\n- Include at least one concrete example, recognizable pattern, or grounded scenario so the insight does not stay abstract.\n- The quote block should sharpen the thesis with a line worth saving, not filler commentary.' : ''}
${normalizedTemplateName === 'minimal thesis' ? '- Keep the six core insight-letter sections visibly intact: Hook, Context, Insight, Expansion, Implication, and Closing.\n- Key Insights, callout, quote, and summary must all be filled with distinct, extractable value so the structure feels complete and GEO-ready.' : ''}
${normalizedTemplateName === 'split-screen insight' ? '- For the Split-Screen Insight template: make the contrast between the surface story and the deeper reality unmistakably clear and genuinely useful.\n- The surface story should sound plausible and familiar, while the deeper reality must reveal a hidden mechanism, second-order effect, or better lens.\n- The framing callout, quote block, and summary must each be strong enough to stand alone in GEO extraction, inbox previews, and AI answers.\n- The insight and implication sections should translate that contrast into a reusable mental model and a practical shift for the reader.\n- Add one grounded example or observed pattern that proves why the deeper reality is more useful than the surface story, so the draft has real body depth.' : ''}

## QUALITY STANDARDS
- Thought leadership tone: analytical, evidence-based, never promotional
- Concrete examples, data points, practitioner implications, and implementation detail
- Each paragraph block must feel complete and substantial, not like notes or an outline
- Narrative flow: each section should logically lead to the next
- No hallucination: reason from first principles if data is unavailable

## OUTPUT FORMAT
${buildTemplateOutputSchema(template)}

The "blocks" array MUST have exactly ${template.length} entries, one per template block, in order.`;

  return wrapWithCompanyEnforcement(base, `${contentType} template`, companyIdentity);
}

/**
 * Parse the AI output and merge it back into the template structure.
 */
export function parseTemplateOutput(
  raw: any,
  template: ContentBlock[],
): (BlogGenerationOutput & { content_blocks: ContentBlock[] }) | null {
  if (!raw || typeof raw !== 'object') return null;

  // Flexible key detection: AI might use "blocks", "template_blocks", "filled_blocks", "content_blocks"
  const blocksArr = raw.blocks ?? raw.template_blocks ?? raw.filled_blocks ?? raw.content_blocks ?? raw.content;
  const title = raw.title || raw.seo_meta_title || 'Untitled';

  if (!Array.isArray(blocksArr)) {
    console.error('[parseTemplateOutput] No blocks array found. Keys:', Object.keys(raw));
    return null;
  }

  const filledBlocks: ContentBlock[] = [];

  for (let i = 0; i < template.length; i++) {
    const tplBlock = template[i];
    const aiBlock = blocksArr[i] || {};

    filledBlocks.push(mergeBlockContent(tplBlock, aiBlock));
  }

  const topLevelKeyInsights = Array.isArray(raw.key_insights)
    ? raw.key_insights
        .map((item: unknown) => String(item ?? '').trim())
        .filter(Boolean)
    : [];
  const topLevelReferences = Array.isArray(raw.references)
    ? raw.references
    : Array.isArray(raw.sources)
    ? raw.sources
    : [];
  const fallbackSummary =
    typeof raw.summary === 'string' ? raw.summary.trim() :
    typeof raw.excerpt === 'string' ? raw.excerpt.trim() :
    '';

  const normalizedBlocks = filledBlocks.map((block) => {
    if (block.type === 'key_insights') {
      const hasFilledItems = block.items.some((item) => item.trim().length > 0);
      if (!hasFilledItems && topLevelKeyInsights.length > 0) {
        return {
          ...block,
          items: block.items.map((_, index) => topLevelKeyInsights[index] ?? ''),
        };
      }
    }

    if (block.type === 'summary' && block.body.trim().length === 0 && fallbackSummary) {
      return {
        ...block,
        body: fallbackSummary,
      };
    }

    if (block.type === 'references') {
      const hasFilledRefs = block.items.some((item) => item.title.trim().length > 0 || item.url.trim().length > 0);
      if (!hasFilledRefs && topLevelReferences.length > 0) {
        return {
          ...block,
          items: block.items.map((existing, index) => {
            const ref = topLevelReferences[index];
            if (!ref) return existing;
            if (typeof ref === 'string') {
              return { ...existing, title: ref.trim(), url: '' };
            }
            return {
              ...existing,
              title: String(ref?.title ?? ref?.text ?? '').trim(),
              url: String(ref?.url ?? ref?.href ?? '').trim(),
            };
          }),
        };
      }
    }

    return block;
  });

  return {
    title,
    excerpt:              raw.excerpt || '',
    content_html:         '', // not used for template path
    tags:                 Array.isArray(raw.tags) ? raw.tags : [],
    category:             raw.category || '',
    seo_meta_title:       raw.seo_meta_title || '',
    seo_meta_description: raw.seo_meta_description || '',
    key_insights:         Array.isArray(raw.key_insights) ? raw.key_insights : [],
    content_blocks:       normalizedBlocks,
  };
}

function normalizeParagraphHtml(aiData: any): string {
  const rawHtml = typeof aiData?.html === 'string' ? aiData.html.trim() : '';
  if (rawHtml) return rawHtml;

  const rawTextCandidate =
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.body === 'string' ? aiData.body :
    typeof aiData?.content === 'string' ? aiData.content :
    typeof aiData?.value === 'string' ? aiData.value :
    '';

  const rawText = rawTextCandidate.trim();
  if (!rawText) return '<p></p>';

  if (/<p[\s>]/i.test(rawText)) return rawText;

  const paragraphs = rawText
    .split(/\n\s*\n/)
    .map((part: string) => part.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return '<p></p>';
  return paragraphs.map((part: string) => `<p>${part}</p>`).join('');
}

function normalizeHeadingText(aiData: any): string {
  const value =
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.title === 'string' ? aiData.title :
    typeof aiData?.heading === 'string' ? aiData.heading :
    typeof aiData?.label === 'string' ? aiData.label :
    '';
  return value.trim();
}

function fallbackHeadingFromHint(tplBlock: ContentBlock): string {
  const hint = typeof (tplBlock as any)?.hint === 'string' ? (tplBlock as any).hint.trim() : '';
  if (!hint) return '';

  const beforeDash = hint.split(/[-—–]/)[0]?.trim() ?? '';
  const candidate = (beforeDash || hint)
    .replace(/^write\s+/i, '')
    .replace(/^add\s+/i, '')
    .replace(/^create\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!candidate) return '';
  return candidate.length <= 80 ? candidate : candidate.slice(0, 77).trimEnd();
}

function normalizeSummaryBody(aiData: any): string {
  const value =
    typeof aiData?.body === 'string' ? aiData.body :
    typeof aiData?.text === 'string' ? aiData.text :
    typeof aiData?.content === 'string' ? aiData.content :
    '';
  return value.trim();
}

function mergeBlockContent(tplBlock: ContentBlock, aiData: any): ContentBlock {
  const { hint: _hint, ...rest } = tplBlock as any; // strip hint
  switch (tplBlock.type) {
    case 'paragraph':
      return { ...rest, html: normalizeParagraphHtml(aiData) };
    case 'heading':
      return {
        ...rest,
        text: typeof tplBlock.text === 'string' && tplBlock.text.trim().length > 0
          ? tplBlock.text
          : (normalizeHeadingText(aiData) || fallbackHeadingFromHint(tplBlock)),
        anchor: '',
      };
    case 'key_insights':
      return {
        ...rest,
        items: Array.isArray(aiData.items)
          ? aiData.items.map((item: any) => String(typeof item === 'string' ? item : item?.text || '').trim())
          : Array.isArray(aiData.points)
          ? aiData.points.map((item: any) => String(item ?? '').trim())
          : tplBlock.items,
      };
    case 'callout':
      return {
        ...rest,
        title: typeof aiData?.title === 'string' ? aiData.title : '',
        body: typeof aiData?.body === 'string'
          ? aiData.body
          : typeof aiData?.text === 'string'
          ? aiData.text
          : '',
      };
    case 'quote':
      return {
        ...rest,
        text: typeof aiData?.text === 'string' ? aiData.text : typeof aiData?.quote === 'string' ? aiData.quote : '',
        author: typeof aiData?.author === 'string' ? aiData.author : '',
        source: typeof aiData?.source === 'string' ? aiData.source : '',
      };
    case 'image':
      return {
        ...rest,
        url: typeof aiData?.url === 'string' ? aiData.url : rest.url || '',
        alt: typeof aiData?.alt === 'string'
          ? aiData.alt
          : typeof aiData?.caption === 'string'
          ? aiData.caption
          : '',
        caption: typeof aiData?.caption === 'string' ? aiData.caption : '',
      };
    case 'list':
      return {
        ...rest,
        items: Array.isArray(aiData.items)
          ? aiData.items.map((item: any) => ({
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
              text: typeof item === 'string' ? item : item?.text || '',
              children: item?.children,
            }))
          : tplBlock.items,
      };
    case 'summary':
      return { ...rest, body: normalizeSummaryBody(aiData) };
    case 'references':
      return {
        ...rest,
        items: Array.isArray(aiData.items)
          ? aiData.items.map((ref: any) => ({
              id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
              title: typeof ref === 'string' ? ref : ref?.title || ref?.text || '',
              url: typeof ref === 'string' ? '' : ref?.url || ref?.href || '',
            }))
          : tplBlock.items,
      };
    case 'divider':
      return { ...rest };
    case 'columns': {
      const aiCols = Array.isArray(aiData?.columns)
        ? aiData.columns
        : Array.isArray(aiData)
        ? aiData
        : [];
      return {
        ...rest,
        columns: tplBlock.columns.map((tplCol, ci) => {
          const aiCol = aiCols[ci] || {};
          const aiInnerBlocks = Array.isArray(aiCol?.blocks)
            ? aiCol.blocks
            : Array.isArray(aiCol)
            ? aiCol
            : [];
          return {
            ...tplCol,
            blocks: tplCol.blocks.map((innerTpl, bi) =>
              mergeBlockContent(innerTpl, aiInnerBlocks[bi] || {}),
            ),
          };
        }),
      };
    }
    default:
      return { ...rest };
  }
}

