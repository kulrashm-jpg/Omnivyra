import { runCompletionWithOperation } from '../../backend/services/aiGateway';
import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationInput } from './blogGenerationEngine';
import { buildSectionEnforcementPrompt, type CompanyIdentity } from '../content/companyContextBlock';


// Agent-B split: private helpers live in ./runEditorialBlogGenerationHelpers (behavior-preserving).
import { EditorialDraft, ImageBlueprint, ParagraphBlueprint, QuoteBlueprint, applyEditorialDraft, buildExcerptFromBlocks, collectEditorialBlueprints, countWords, materializeHeadingText, stripHtml } from './runEditorialBlogGenerationHelpers';

export async function runEditorialBlogGeneration(args: {
  companyId: string;
  cacheVersion?: string;
  topic: string;
  templateBlocks: ContentBlock[];
  generationInput: BlogGenerationInput;
  targetWords: number;
  angleLabel?: string;
  templateLabel: 'Visual Feature' | 'Magazine';
  /** Blog Governance Parity — optional governance prompt context. */
  governance?: import('../../backend/services/creator/strategyGovernancePromptContext').GovernancePromptContext | null;
}): Promise<EditorialDraft | null> {
  // Blog Governance Parity — lazy-imported shared helper.
  const { applyGovernancePreambleToSystemPrompt } =
    await import('../../backend/services/creator/strategyGovernancePromptContext');
  const govPreamble = (base: string) =>
    applyGovernancePreambleToSystemPrompt(base, args.governance ?? null);
  // ── Company context injection ──
  const a = args.generationInput.answers || {};
  const companyContextBlock = [
    a.companyName ? `Company: ${a.companyName}` : null,
    a.industry ? `Industry: ${a.industry}` : null,
    a.audience || a.target_audience ? `Target audience: ${a.audience || a.target_audience}` : null,
    a.uniqueness_directive ? `Unique positioning: ${a.uniqueness_directive}` : null,
    a.must_include_points ? `Must-include points: ${a.must_include_points}` : null,
    a.campaign_objective ? `Campaign objective: ${a.campaign_objective}` : null,
    a.trend_context ? `Market context: ${a.trend_context}` : null,
  ].filter(Boolean).join('\n');

  const _sectionIdentity: CompanyIdentity = {
    companyName: a.companyName || undefined,
    targetAudience: a.audience || a.target_audience || undefined,
    coreProblem: a.campaign_objective || undefined,
    painPoints: a.must_include_points
      ? a.must_include_points.split(';').map(s => s.trim()).filter(s => s.length > 10).slice(0, 4)
      : undefined,
    uniqueValue: a.uniqueness_directive || undefined,
  };

  const { paragraphs, images, quotes } = collectEditorialBlueprints(args.templateBlocks);
  const paragraphTarget = Math.max(
    args.targetWords >= 1600 ? 165 : args.targetWords >= 1200 ? 145 : 125,
    Math.round((args.targetWords * 0.78) / Math.max(1, paragraphs.length)),
  );
  const summaryTarget = Math.max(90, Math.round(args.targetWords * 0.1));
  const minAcceptable = Math.round(args.targetWords * 0.82);

  const completion = await runCompletionWithOperation({
    operation: 'blogGeneration',
    companyId: args.companyId,
    cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:dedicated`,
    model: 'gpt-4o',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    max_tokens: Math.min(16384, Math.max(4096, Math.round(args.targetWords * 6))),
    messages: [
      {
        role: 'system',
        content: govPreamble(
          `You are writing a ${args.templateLabel} blog article.\n` +
          (companyContextBlock ? `\nCOMPANY CONTEXT:\n${companyContextBlock}\n\n` : '') +
          `CONTENT QUALITY RULES (MANDATORY):\n` +
          `- Every section MUST reference the company context above. Do NOT write generic content.\n` +
          `- Use specific scenarios, workflows, or real-world situations — not abstract statements.\n` +
          `- Include at least one contrarian insight or non-obvious observation per major section.\n` +
          `- Replace buzzwords with concrete examples.\n` +
          `- The article must read as if written BY this specific company, not ABOUT a generic topic.\n\n` +
          `Return JSON only with this exact shape:\n` +
          `{\n` +
          `  "title": "string",\n` +
          `  "excerpt": "string",\n` +
          `  "seo_meta_title": "string",\n` +
          `  "seo_meta_description": "string",\n` +
          `  "tags": ["string"],\n` +
          `  "category": "string",\n` +
          `  "key_insights": ["...", "...", "..."],\n` +
          `  "paragraphs": [{ "html": "<p>...</p><p>...</p>" }],\n` +
          `  "images": [{ "alt": "...", "caption": "..." }],\n` +
          `  "quotes": [{ "text": "...", "author": "...", "source": "..." }],\n` +
          `  "callout_body": "string",\n` +
          `  "summary_body": "string",\n` +
          `  "references": [{ "title": "...", "url": "..." }]\n` +
          `}\n` +
          `Rules:\n` +
          `- Return exactly ${paragraphs.length} paragraph entries in order.\n` +
          `- Return exactly ${images.length} image entries in order.\n` +
          `- Return exactly ${quotes.length} quote entries in order.\n` +
          `- Each paragraph entry must use valid HTML with 2-3 <p> tags and contain at least ${paragraphTarget} words.\n` +
          `- Fill every image alt and caption with concrete, relevant editorial text.\n` +
          `- Fill every quote with a real editorial-quality line; do not leave quotes blank.\n` +
          `- The article must reach at least ${minAcceptable} words and aim for ${args.targetWords} words.\n` +
          `- references must contain at least 3 credible entries with real titles and URLs whenever possible.\n` +
          `- summary_body must contain at least ${summaryTarget} words.\n`,
        ),
      },
      {
        role: 'user',
        content:
          `Topic: ${args.topic}\n` +
          `Angle: ${args.angleLabel || args.generationInput.selected_angle?.label || 'Analytical'}\n` +
          `Working title: ${args.generationInput.selected_angle?.title || args.topic}\n` +
          (companyContextBlock ? `\nCOMPANY CONTEXT:\n${companyContextBlock}\n` : '') +
          `${args.generationInput.unifiedPromptContext ? `\nMARKET INTELLIGENCE:\n${args.generationInput.unifiedPromptContext}\n` : ''}` +
          `\nParagraph slots to fill in order:\n` +
          `${paragraphs.map((item) => `- Paragraph ${item.index}: section "${item.heading || args.templateLabel}" :: ${item.hint || 'Write a full editorial section.'}`).join('\n')}\n\n` +
          `Image slots to fill in order:\n` +
          `${images.map((item) => `- Image ${item.index}: section "${item.heading || args.templateLabel}" :: ${item.hint || 'Write specific alt text and caption.'}`).join('\n')}\n\n` +
          `Quote slots to fill in order:\n` +
          `${quotes.map((item) => `- Quote ${item.index}: section "${item.heading || args.templateLabel}" :: ${item.hint || 'Write a sharp quote.'}`).join('\n')}\n\n` +
          `Write the full article now.`,
      },
    ],
  });

  let raw: any = null;
  try {
    raw = completion.output ? JSON.parse(completion.output) : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return null;

  let contentBlocks = applyEditorialDraft(args.templateBlocks, raw);

  const refsCount = flattenBlocks(contentBlocks).reduce((count, block) => {
    if (block.type !== 'references') return count;
    return count + block.items.filter((item) => item.title.trim() || item.url.trim()).length;
  }, 0);
  const thinParagraphs = flattenBlocks(contentBlocks)
    .filter((block): block is Extract<ContentBlock, { type: 'paragraph' }> => block.type === 'paragraph')
    .filter((block) => stripHtml(block.html).split(/\s+/).filter(Boolean).length < Math.max(75, Math.round(paragraphTarget * 0.55)))
    .length;
  const imagesMissingAlt = flattenBlocks(contentBlocks)
    .filter((block): block is Extract<ContentBlock, { type: 'image' }> => block.type === 'image')
    .filter((block) => !String(block.alt ?? '').trim())
    .length;
  const emptyQuotes = flattenBlocks(contentBlocks)
    .filter((block): block is Extract<ContentBlock, { type: 'quote' }> => block.type === 'quote')
    .filter((block) => !String(block.text ?? '').trim())
    .length;

  if (countWords(contentBlocks) < minAcceptable || refsCount < 3 || thinParagraphs > 0 || imagesMissingAlt > 0 || emptyQuotes > 0) {
    const repairedParagraphs: Array<{ html: string }> = [];
    const repairedImages: Array<{ alt: string; caption: string }> = [];
    const repairedQuotes: Array<{ text: string; author: string; source: string }> = [];

    for (const blueprint of paragraphs) {
      const sectionResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:section:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.35,
        response_format: { type: 'json_object' },
        max_tokens: 1400,
        messages: [
          {
            role: 'system',
            content: govPreamble(
              `Return JSON only: { "html": "<p>...</p><p>...</p>" }\n` +
              `Write one substantial ${args.templateLabel} section with at least ${paragraphTarget} words.\n` +
              `Use 2-3 <p> tags, include analysis and examples, and do not output headings or bullets.\n` +
              (companyContextBlock ? `Reference this company context throughout:\n${companyContextBlock}\n` : '') +
              buildSectionEnforcementPrompt(_sectionIdentity, blueprint.index - 1),
            ),
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Section heading: ${blueprint.heading || args.templateLabel}\n` +
              `Section brief: ${blueprint.hint || 'Write a full editorial section.'}\n`,
          },
        ],
      });

      try {
        const sectionRaw = sectionResult.output ? JSON.parse(sectionResult.output) : null;
        repairedParagraphs.push({ html: String(sectionRaw?.html ?? '').trim() });
      } catch {
        repairedParagraphs.push({ html: '' });
      }
    }

    for (const blueprint of images) {
      const imageResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:image:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.25,
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: govPreamble(`Return JSON only: { "alt": "string", "caption": "string" }. Write specific, accessible, relevant image metadata.`),
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Image section: ${blueprint.heading || args.templateLabel}\n` +
              `Image brief: ${blueprint.hint || 'Editorial image for the article.'}\n`,
          },
        ],
      });

      try {
        const imageRaw = imageResult.output ? JSON.parse(imageResult.output) : null;
        repairedImages.push({
          alt: String(imageRaw?.alt ?? '').trim(),
          caption: String(imageRaw?.caption ?? '').trim(),
        });
      } catch {
        repairedImages.push({ alt: '', caption: '' });
      }
    }

    for (const blueprint of quotes) {
      const quoteResult = await runCompletionWithOperation({
        operation: 'blogGeneration',
        companyId: args.companyId,
        cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:quote:${blueprint.index}`,
        model: 'gpt-4o',
        temperature: 0.35,
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: govPreamble(`Return JSON only: { "text": "string", "author": "string", "source": "string" }. Write a specific editorial pull quote, not a placeholder.`),
          },
          {
            role: 'user',
            content:
              `Topic: ${args.topic}\n` +
              `Quote section: ${blueprint.heading || args.templateLabel}\n` +
              `Quote brief: ${blueprint.hint || 'Sharp editorial quote.'}\n`,
          },
        ],
      });

      try {
        const quoteRaw = quoteResult.output ? JSON.parse(quoteResult.output) : null;
        repairedQuotes.push({
          text: String(quoteRaw?.text ?? '').trim(),
          author: String(quoteRaw?.author ?? '').trim(),
          source: String(quoteRaw?.source ?? '').trim(),
        });
      } catch {
        repairedQuotes.push({ text: '', author: '', source: '' });
      }
    }

    const supportResult = await runCompletionWithOperation({
      operation: 'blogGeneration',
      companyId: args.companyId,
      cache_version: `${args.cacheVersion ?? ''}:${args.templateLabel.toLowerCase().replace(/\s+/g, '-')}:support`,
      model: 'gpt-4o',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      messages: [
        {
          role: 'system',
          content: govPreamble(
            `Return JSON only with keys excerpt, seo_meta_description, key_insights, callout_body, summary_body, references.\n` +
            `summary_body must be at least ${summaryTarget} words. references must include at least 3 credible entries.\n`,
          ),
        },
        {
          role: 'user',
          content: `Topic: ${args.topic}\nWrite the support blocks for a ${args.templateLabel} article so it feels complete, polished, and reference-backed.`,
        },
      ],
    });

    let supportRaw: any = null;
    try {
      supportRaw = supportResult.output ? JSON.parse(supportResult.output) : null;
    } catch {
      supportRaw = null;
    }

    contentBlocks = applyEditorialDraft(contentBlocks, {
      key_insights: supportRaw?.key_insights,
      paragraphs: repairedParagraphs,
      images: repairedImages,
      quotes: repairedQuotes,
      callout_body: supportRaw?.callout_body,
      summary_body: supportRaw?.summary_body,
      references: supportRaw?.references,
    });

    const repairedExcerpt = typeof supportRaw?.excerpt === 'string' && supportRaw.excerpt.trim()
      ? supportRaw.excerpt.trim()
      : buildExcerptFromBlocks(contentBlocks);

    return {
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (args.generationInput.selected_angle?.title || args.topic),
      excerpt: repairedExcerpt,
      seo_meta_title: typeof raw.seo_meta_title === 'string' && raw.seo_meta_title.trim() ? raw.seo_meta_title.trim() : (typeof raw.title === 'string' ? raw.title.trim() : args.topic).slice(0, 60),
      seo_meta_description: typeof supportRaw?.seo_meta_description === 'string' && supportRaw.seo_meta_description.trim()
        ? supportRaw.seo_meta_description.trim()
        : repairedExcerpt,
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag: unknown) => String(tag ?? '').trim()).filter(Boolean) : [],
      category: typeof raw.category === 'string' ? raw.category.trim() : '',
      key_insights: Array.isArray(supportRaw?.key_insights)
        ? supportRaw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
        : Array.isArray(raw.key_insights) ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [],
      content_blocks: contentBlocks,
    };
  }

  const excerpt = typeof raw.excerpt === 'string' && raw.excerpt.trim()
    ? raw.excerpt.trim()
    : buildExcerptFromBlocks(contentBlocks);

  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (args.generationInput.selected_angle?.title || args.topic),
    excerpt,
    seo_meta_title: typeof raw.seo_meta_title === 'string' && raw.seo_meta_title.trim() ? raw.seo_meta_title.trim() : (typeof raw.title === 'string' ? raw.title.trim() : args.topic).slice(0, 60),
    seo_meta_description: typeof raw.seo_meta_description === 'string' && raw.seo_meta_description.trim() ? raw.seo_meta_description.trim() : excerpt,
    tags: Array.isArray(raw.tags) ? raw.tags.map((tag: unknown) => String(tag ?? '').trim()).filter(Boolean) : [],
    category: typeof raw.category === 'string' ? raw.category.trim() : '',
    key_insights: Array.isArray(raw.key_insights) ? raw.key_insights.map((item: unknown) => String(item ?? '').trim()).filter(Boolean) : [],
    content_blocks: contentBlocks,
  };
}
