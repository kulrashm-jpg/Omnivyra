/**
 * Pure helper functions extracted from runBlogGeneration.ts.
 * No external I/O, no supabase, no AI calls — safe to unit-test in isolation.
 */

import { flattenBlocks } from './blockUtils';
import type { ContentBlock } from './blockTypes';
import type { BlogGenerationOutput } from './blogGenerationEngine';
import { getBlogTemplateDepthGuidance } from './blogTemplateGuidance';
import { getNewsletterTemplateDepthGuidance } from '../newsletter/newsletterTemplateGuidance';
import { calculateContentQualityScore } from '../content/qualityScoringCore';
import type { BlogFormatType, ArticleFormatType, WhitepaperFormatType, NewsletterFormatType, StoryFormatType, GuideFormatType } from './blogStructureTemplates';

// ── UUID ─────────────────────────────────────────────────────────────────────

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Text utilities ────────────────────────────────────────────────────────────

export function stripHtmlForWordCount(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function countListWords(
  items: Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }> = [],
): number {
  let total = 0;
  for (const item of items) {
    total += String(item?.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (Array.isArray(item?.children) && item.children.length > 0) {
      total += countListWords(item.children as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>);
    }
  }
  return total;
}

const DEPTH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'by', 'for', 'from', 'how', 'if',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'there', 'these',
  'this', 'to', 'was', 'were', 'will', 'with', 'your', 'you',
]);

function extractDepthTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !DEPTH_STOP_WORDS.has(token));
}

function blockToDepthText(block: ContentBlock): string {
  switch (block.type) {
    case 'paragraph':
      return stripHtmlForWordCount(block.html);
    case 'heading':
      return block.text.trim();
    case 'summary':
      return block.body.trim();
    case 'key_insights':
      return block.items.join(' ').trim();
    case 'callout':
      return `${block.title ?? ''} ${block.body ?? ''}`.trim();
    case 'quote':
      return `${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`.trim();
    case 'list':
      return (block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>)
        .map((item) => String(item?.text ?? '').trim())
        .join(' ')
        .trim();
    case 'references':
      return block.items.map((item) => `${item.title ?? ''} ${item.url ?? ''}`.trim()).join(' ').trim();
    default:
      return '';
  }
}

export function parseSerializedMustIncludePoints(serialized?: string | null): string[] {
  if (!serialized) return [];
  return Array.from(new Set(
    serialized
      .split(/[;|]/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 12),
  ));
}

function splitDepthSentences(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
}

function hasSpecificDepthSignal(text: string): boolean {
  return (
    /\b\d+(?:\.\d+)?%?\b/.test(text) ||
    /\b(?:step|steps)\s+\d+\b/i.test(text) ||
    /\b[a-z0-9]+\/(?:week|month|quarter|year)\b/i.test(text) ||
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/.test(text) ||
    /\b(?:saas|b2b|b2c|enterprise|fintech|healthcare|ecommerce|marketplace|agency|growth team|sales team|marketing team|product team)\b/i.test(text) ||
    /\b(?:publishing|running|relying on|migrating|launching|auditing|prioritizing|optimizing|segmenting|distributing)\b/i.test(text) ||
    /\b(?:saw|increased|reduced|improved|grew|dropped|lifted|cut|resulted in|led to|generated|shifted)\b/i.test(text)
  );
}

function detectShallowDepthElements(text: string): string[] {
  const snippets = splitDepthSentences(text);
  const shallow: string[] = [];

  for (const rule of SPECIFIC_DEPTH_ELEMENT_RULES) {
    const matches = snippets.filter((snippet) => rule.patterns.some((pattern) => pattern.test(snippet)));
    if (matches.length === 0) continue;

    const hasSpecificMatch = matches.some((snippet) => hasSpecificDepthSignal(snippet));
    if (!hasSpecificMatch) shallow.push(rule.label);
  }

  return Array.from(new Set(shallow));
}

type DepthRequirement = {
  label: string;
  patterns: RegExp[];
};

type DepthElementRule = {
  label: string;
  patterns: RegExp[];
};

const SPECIFIC_DEPTH_ELEMENT_RULES: DepthElementRule[] = [
  { label: 'case study', patterns: [/\bcase study\b/i, /\bbefore\b.*\bafter\b/i, /\bcustomer story\b/i] },
  { label: 'framework', patterns: [/\bframework\b/i, /\bplaybook\b/i, /\bchecklist\b/i, /\b3-step\b/i, /\b4-step\b/i, /\bstep-by-step\b/i] },
  { label: 'comparison', patterns: [/\bcompare\b/i, /\bcomparison\b/i, /\bversus\b/i, /\bvs\.?\b/i, /\balternative\b/i] },
  { label: 'example', patterns: [/\bfor example\b/i, /\bfor instance\b/i, /\bexample\b/i] },
  { label: 'scenario', patterns: [/\bscenario\b/i, /\bin practice\b/i, /\bconsider\b/i, /\bimagine\b/i, /\bif your\b/i, /\bwhen a\b/i, /\bwhen teams\b/i] },
];

function getTierDepthRequirements(targetWords: number): DepthRequirement[] {
  const requirements: DepthRequirement[] = [];

  if (targetWords >= 1200) {
    requirements.push(
      {
        label: 'examples or scenarios',
        patterns: [/\bfor example\b/i, /\bfor instance\b/i, /\bin practice\b/i, /\bscenario\b/i, /\bconsider\b/i, /\bimagine\b/i],
      },
      {
        label: 'mistakes or misconceptions',
        patterns: [/\bmistake\b/i, /\bmistakes\b/i, /\bmisconception\b/i, /\bpitfall\b/i, /\banti-pattern\b/i, /\bwrong\b/i],
      },
      {
        label: 'differentiation or tradeoffs',
        patterns: [/\bdifferentiat/i, /\bdistinct/i, /\badvantage\b/i, /\btrade-?off/i, /\bversus\b/i, /\bvs\.?\b/i, /\bunlike\b/i],
      },
    );
  }

  if (targetWords >= 1600) {
    requirements.push(
      {
        label: 'frameworks or step-by-step structure',
        patterns: [/\bframework\b/i, /\bchecklist\b/i, /\bplaybook\b/i, /\bstep-by-step\b/i, /\bprocess\b/i, /\bsystem\b/i],
      },
      {
        label: 'mechanism or cause-effect explanation',
        patterns: [/\bmechanism\b/i, /\bhow this works\b/i, /\bwhy this works\b/i, /\bdrives\b/i, /\bcauses\b/i, /\bunder the hood\b/i],
      },
      {
        label: 'brand or expert perspective',
        patterns: [/\bperspective\b/i, /\blens\b/i, /\bcontrarian\b/i, /\bcounterintuitive\b/i, /\bfrom .* perspective\b/i, /\bexpertise\b/i],
      },
    );
  }

  if (targetWords >= 2000) {
    requirements.push(
      {
        label: 'case study or before-after evidence',
        patterns: [/\bcase study\b/i, /\bbefore\b.*\bafter\b/i, /\bmeasurable\b/i, /\bimpact\b/i, /\bresulted in\b/i, /\blift\b/i],
      },
      {
        label: 'comparison with alternatives',
        patterns: [/\bcomparison\b/i, /\bcompare\b/i, /\bversus\b/i, /\bvs\.?\b/i, /\balternative\b/i, /\boption\b/i],
      },
      {
        label: 'decision logic or when-to-use guidance',
        patterns: [/\bdecision\b/i, /\bwhen to\b/i, /\bwhen not to\b/i, /\bchoose\b/i, /\bbest fit\b/i, /\bdecision matrix\b/i],
      },
    );
  }

  return requirements;
}

function getSectionDepthSignals(text: string): {
  hasExplanation: boolean;
  hasExampleOrScenario: boolean;
  hasImplicationOrAction: boolean;
} {
  return {
    hasExplanation: /\bbecause\b|\bwhy\b|\bhow\b|\bthis means\b|\btherefore\b|\bas a result\b|\bdrives\b|\bcauses\b/i.test(text),
    hasExampleOrScenario: /\bfor example\b|\bfor instance\b|\bin practice\b|\bscenario\b|\bconsider\b|\bimagine\b|\bif your\b|\bwhen a\b|\bwhen teams\b/i.test(text),
    hasImplicationOrAction: /\bimplication\b|\bnext step\b|\baction\b|\bshould\b|\bto do this\b|\btakeaway\b|\bwhat to do\b|\buse this\b/i.test(text),
  };
}

function buildSectionBodies(blocks: ContentBlock[]): string[] {
  const flat = flattenBlocks(blocks);
  const sections: string[] = [];
  let currentSection: string[] = [];
  let seenH2 = false;

  for (const block of flat) {
    if (block.type === 'references') break;

    if (block.type === 'heading' && block.level === 2) {
      const headingText = block.text.trim().toLowerCase();
      if (/^references?$/.test(headingText)) break;
      if (/^summary$|^the bottom line$|^closing$/.test(headingText)) {
        if (seenH2 && currentSection.length > 0) {
          sections.push(currentSection.join(' ').trim());
        }
        currentSection = [];
        seenH2 = false;
        continue;
      }
      if (seenH2 && currentSection.length > 0) {
        sections.push(currentSection.join(' ').trim());
      }
      seenH2 = true;
      currentSection = [blockToDepthText(block)];
      continue;
    }

    if (!seenH2) continue;
    const text = blockToDepthText(block);
    if (text) currentSection.push(text);
  }

  if (seenH2 && currentSection.length > 0) {
    sections.push(currentSection.join(' ').trim());
  }

  return sections.filter((section) => section.length > 0);
}

function isMustIncludeCovered(point: string, contentText: string, contentTokens: Set<string>): boolean {
  const normalizedPoint = point.toLowerCase();
  if (contentText.includes(normalizedPoint)) return true;

  const pointTokens = Array.from(new Set(extractDepthTokens(point)));
  if (pointTokens.length === 0) return false;

  const overlap = pointTokens.filter((token) => contentTokens.has(token)).length;
  return overlap >= Math.min(3, Math.max(2, Math.ceil(pointTokens.length * 0.4)));
}

export function describeSectionDepthNeeds(
  text: string,
  targetWords: number,
): string[] {
  const needs: string[] = [];
  const signals = getSectionDepthSignals(text);

  if (!signals.hasExplanation) needs.push('explanation of why the point matters or how it works');
  if (!signals.hasExampleOrScenario) needs.push('a concrete example or scenario');
  if (!signals.hasImplicationOrAction) needs.push('an implication, takeaway, or action');

  const missingTierSignals = getTierDepthRequirements(targetWords)
    .filter((requirement) => !requirement.patterns.some((pattern) => pattern.test(text)))
    .map((requirement) => requirement.label);

  return Array.from(new Set([...needs, ...missingTierSignals.slice(0, 2)]));
}

export function auditDepthCoverage(blocks: ContentBlock[], options: {
  targetWords: number;
  mustIncludePoints?: string | null;
}): {
  missingMustIncludePoints: string[];
  missingDepthElements: string[];
  shallowDepthElements: string[];
  thinSectionCount: number;
  sectionCount: number;
  thinSectionRatio: number;
  missingDepth: boolean;
} {
  const flat = flattenBlocks(blocks);
  const originalContentText = flat
    .map((block) => blockToDepthText(block))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const contentText = originalContentText.toLowerCase();
  const contentTokens = new Set(extractDepthTokens(contentText));
  const mustIncludePoints = parseSerializedMustIncludePoints(options.mustIncludePoints);
  const missingMustIncludePoints = mustIncludePoints.filter((point) => !isMustIncludeCovered(point, contentText, contentTokens));

  const missingDepthElements = getTierDepthRequirements(options.targetWords)
    .filter((requirement) => !requirement.patterns.some((pattern) => pattern.test(contentText)))
    .map((requirement) => requirement.label);
  const shallowDepthElements = detectShallowDepthElements(originalContentText);

  const sections = buildSectionBodies(blocks);
  const thinSectionCount = sections.filter((section) => {
    const wordCount = section.split(/\s+/).filter(Boolean).length;
    const signals = getSectionDepthSignals(section);
    return wordCount < 110 || !signals.hasExplanation || !signals.hasExampleOrScenario;
  }).length;
  const sectionCount = sections.length;
  const thinSectionRatio = sectionCount > 0 ? thinSectionCount / sectionCount : 0;

  return {
    missingMustIncludePoints,
    missingDepthElements,
    shallowDepthElements,
    thinSectionCount,
    sectionCount,
    thinSectionRatio,
    missingDepth:
      missingMustIncludePoints.length > 0 ||
      missingDepthElements.length > 0 ||
      shallowDepthElements.length > 0 ||
      (sectionCount > 0 && thinSectionRatio > 0.3),
  };
}

// ── Block analysis ────────────────────────────────────────────────────────────

export function analyzeTemplateContentBlocks(blocks: ContentBlock[]): {
  wordCount: number;
  paragraphCount: number;
  averageParagraphWords: number;
  h2Count: number;
  emptyParagraphs: number;
  emptyHeadings: number;
  emptySummaries: number;
  emptyKeyInsights: number;
  emptyLists: number;
  weakLists: number;
  thinListItems: number;
  emptyCallouts: number;
  thinCallouts: number;
  emptyQuotes: number;
  thinQuotes: number;
  weakReferences: number;
  refsCount: number;
  imagesMissingAlt: number;
  substantiveEmptyBlocks: number;
  thinParagraphs: number;
  thinSummaries: number;
  weakKeyInsights: number;
} {
  const flat = flattenBlocks(blocks);
  let wordCount = 0;
  let emptyParagraphs = 0;
  let emptyHeadings = 0;
  let emptySummaries = 0;
  let emptyKeyInsights = 0;
  let emptyLists = 0;
  let weakLists = 0;
  let thinListItems = 0;
  let emptyCallouts = 0;
  let thinCallouts = 0;
  let emptyQuotes = 0;
  let thinQuotes = 0;
  let weakReferences = 0;
  let refsCount = 0;
  let imagesMissingAlt = 0;
  let thinParagraphs = 0;
  let thinSummaries = 0;
  let weakKeyInsights = 0;
  let paragraphCount = 0;
  let paragraphWordTotal = 0;
  let h2Count = 0;

  for (const block of flat) {
    switch (block.type) {
      case 'paragraph': {
        const wc = stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        paragraphCount += 1;
        paragraphWordTotal += wc;
        if (wc === 0) emptyParagraphs += 1;
        else if (wc < 70) thinParagraphs += 1;
        break;
      }
      case 'heading': {
        const wc = block.text.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (block.level === 2 && wc > 0) h2Count += 1;
        if (wc === 0) emptyHeadings += 1;
        break;
      }
      case 'key_insights': {
        const filled = block.items.map((item) => item.trim()).filter(Boolean);
        wordCount += filled.join(' ').split(/\s+/).filter(Boolean).length;
        if (filled.length === 0) emptyKeyInsights += 1;
        else if (filled.length < 3) weakKeyInsights += 1;
        break;
      }
      case 'summary': {
        const wc = block.body.trim().split(/\s+/).filter(Boolean).length;
        wordCount += wc;
        if (wc === 0) emptySummaries += 1;
        else if (wc < 50) thinSummaries += 1;
        break;
      }
      case 'callout':
        {
          const wc = `${block.title ?? ''} ${block.body ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
          wordCount += wc;
          if (wc === 0) emptyCallouts += 1;
          else if (wc < 18) thinCallouts += 1;
        }
        break;
      case 'quote':
        {
          const wc = `${block.text ?? ''} ${block.author ?? ''} ${block.source ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
          wordCount += wc;
          if (wc === 0) emptyQuotes += 1;
          else if (wc < 12) thinQuotes += 1;
        }
        break;
      case 'list': {
        const itemTexts = (block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>)
          .map((item) => String(item?.text ?? '').trim())
          .filter(Boolean);
        const wc = countListWords(block.items as Array<{ text?: string; children?: Array<{ text?: string; children?: any[] }> }>);
        wordCount += wc;
        if (wc === 0) emptyLists += 1;
        else {
          const shortItems = itemTexts.filter((text) => text.split(/\s+/).filter(Boolean).length < 5).length;
          thinListItems += shortItems;
          if (itemTexts.length === 0 || wc < itemTexts.length * 8 || shortItems >= Math.ceil(itemTexts.length / 2)) {
            weakLists += 1;
          }
        }
        break;
      }
      case 'references':
        {
          const filledRefs = block.items.filter((ref) => String(ref.title ?? '').trim() || String(ref.url ?? '').trim());
          refsCount += filledRefs.length;
          wordCount += filledRefs
            .map((ref) => `${ref.title ?? ''} ${ref.url ?? ''}`.trim())
            .join(' ')
            .split(/\s+/)
            .filter(Boolean).length;
          if (filledRefs.length === 0 || (filledRefs.length > 0 && filledRefs.length < Math.min(2, block.items.length))) weakReferences += 1;
        }
        break;
      case 'image':
        if (!String(block.alt ?? '').trim()) imagesMissingAlt += 1;
        wordCount += `${block.alt ?? ''} ${block.caption ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
        break;
      case 'internal_link':
        wordCount += `${block.title ?? ''} ${block.excerpt ?? ''}`.trim().split(/\s+/).filter(Boolean).length;
        break;
      default:
        break;
    }
  }

  const substantiveEmptyBlocks = emptyParagraphs + emptyHeadings + emptySummaries + emptyKeyInsights + emptyLists + emptyCallouts;
  return {
    wordCount,
    paragraphCount,
    averageParagraphWords: paragraphCount > 0 ? Math.round(paragraphWordTotal / paragraphCount) : 0,
    h2Count,
    emptyParagraphs,
    emptyHeadings,
    emptySummaries,
    emptyKeyInsights,
    emptyLists,
    weakLists,
    thinListItems,
    emptyCallouts,
    thinCallouts,
    emptyQuotes,
    thinQuotes,
    weakReferences,
    refsCount,
    imagesMissingAlt,
    substantiveEmptyBlocks,
    thinParagraphs,
    thinSummaries,
    weakKeyInsights,
  };
}

// ── Template guidance ─────────────────────────────────────────────────────────

export function deriveTemplateDepthGuidance(
  contentType: 'blog' | 'article' | 'whitepaper' | 'newsletter' | 'story' | 'guide' | undefined,
  templateName: string | undefined,
  formatType: BlogFormatType | ArticleFormatType | WhitepaperFormatType | NewsletterFormatType | StoryFormatType | GuideFormatType | undefined,
  targetWords: number,
): { uniquenessRule: string; mustIncludePoints: string[]; retryFocus: string[] } | null {
  const normalized = typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';

  if (contentType === 'blog') {
    const guidance = getBlogTemplateDepthGuidance(templateName, typeof formatType === 'string' ? formatType : undefined, targetWords);
    if (guidance) return guidance;
  }

  if (contentType === 'newsletter') {
    const guidance = getNewsletterTemplateDepthGuidance(templateName, typeof formatType === 'string' ? formatType : undefined, targetWords);
    if (guidance) return guidance;
  }

  if (normalized) {
    return {
      uniquenessRule: targetWords >= 1600
        ? 'Honor the selected custom template layout, but fill it like a publication-ready deep dive: every substantive block should contribute real standalone value, layered explanation, and practical meaning.'
        : 'Honor the selected custom template layout, but do not let structure become an excuse for shallow writing; each substantive block must feel complete.',
      mustIncludePoints: [
        'Fill every substantive block fully and preserve the layout without returning skeletal content',
        'If the template uses columns, callouts, or special blocks, each one should add meaningful standalone value',
        'Use examples, implications, and reader-useful detail to create real depth across the whole template',
      ],
      retryFocus: [
        'Keep the layout, but make every substantive block more complete and informative',
        'Replace outline-like writing with explanation, examples, and practical meaning',
      ],
    };
  }

  return null;
}

export function normalizeTemplateName(templateName: string | undefined): string {
  return typeof templateName === 'string' ? templateName.trim().toLowerCase() : '';
}

// ── Block repair helpers ──────────────────────────────────────────────────────

export function mergeClassicShortParagraphBlocks(
  blocks: ContentBlock[],
  targetWords: number,
): ContentBlock[] {
  if (targetWords >= 1200) return blocks;

  const merged: ContentBlock[] = [];

  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.type === 'paragraph' && previous?.type === 'paragraph') {
      const previousWords = stripHtmlForWordCount(previous.html).split(/\s+/).filter(Boolean).length;
      const currentWords = stripHtmlForWordCount(block.html).split(/\s+/).filter(Boolean).length;
      if (previousWords < 55 || currentWords < 55) {
        merged[merged.length - 1] = {
          ...previous,
          html: `${previous.html}${block.html}`,
        };
        continue;
      }
    }
    merged.push(block);
  }

  return merged;
}

export function ensureClassicSummaryBlock(
  blocks: ContentBlock[],
  excerpt: string,
): ContentBlock[] {
  if (blocks.some((block) => block.type === 'summary' && block.body.trim().length > 0)) {
    return blocks;
  }

  const summarySource = [...blocks]
    .reverse()
    .find((block) =>
      (block.type === 'paragraph' && stripHtmlForWordCount(block.html).trim().length > 0) ||
      (block.type === 'callout' && String(block.body ?? '').trim().length > 0),
    );

  let summaryBody = excerpt.trim();
  if (!summaryBody && summarySource?.type === 'paragraph') {
    summaryBody = stripHtmlForWordCount(summarySource.html);
  } else if (!summaryBody && summarySource?.type === 'callout') {
    summaryBody = String(summarySource.body ?? '').trim();
  }

  summaryBody = summaryBody.trim();
  if (!summaryBody) return blocks;

  const summaryBlock: ContentBlock = {
    id: uuid(),
    type: 'summary',
    body: summaryBody,
  };

  const referencesIndex = blocks.findIndex((block) => block.type === 'references');
  if (referencesIndex >= 0) {
    return [
      ...blocks.slice(0, referencesIndex),
      summaryBlock,
      ...blocks.slice(referencesIndex),
    ];
  }

  return [...blocks, summaryBlock];
}

export function buildExcerptFromHtml(html: string): string {
  const text = stripHtmlForWordCount(html);
  if (!text) return '';
  if (text.length <= 150) return text;
  const clipped = text.slice(0, 157).trim();
  return `${clipped.replace(/[,:;.\-–—\s]+$/g, '')}...`;
}

export function ensureGeneratedMetadata(generated: BlogGenerationOutput): BlogGenerationOutput {
  const excerpt = generated.excerpt.trim() || buildExcerptFromHtml(generated.content_html);
  const seoMetaTitle = generated.seo_meta_title.trim() || generated.title.trim().slice(0, 60);
  const seoMetaDescription = generated.seo_meta_description.trim() || excerpt;

  return {
    ...generated,
    excerpt,
    seo_meta_title: seoMetaTitle,
    seo_meta_description: seoMetaDescription,
  };
}

export function buildExcerptFromBlocks(blocks: ContentBlock[]): string {
  const text = flattenBlocks(blocks)
    .flatMap((block) => {
      switch (block.type) {
        case 'paragraph':
          return [stripHtmlForWordCount(block.html)];
        case 'summary':
          return [block.body.trim()];
        case 'key_insights':
          return [block.items.join(' ').trim()];
        case 'callout':
          return [`${block.title ?? ''} ${block.body ?? ''}`.trim()];
        default:
          return [];
      }
    })
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return '';
  if (text.length <= 150) return text;
  const clipped = text.slice(0, 157).trim();
  return `${clipped.replace(/[,:;.\-–—\s]+$/g, '')}...`;
}

export function applyClassicStructuredRepair(
  blocks: ContentBlock[],
  repair: {
    excerpt?: string;
    seo_meta_description?: string;
    key_insights?: unknown;
    paragraphs?: unknown;
    summary_body?: string;
    references?: unknown;
  } | null | undefined,
): { blocks: ContentBlock[]; excerpt: string; seoMetaDescription: string; keyInsights: string[] } {
  if (!repair || typeof repair !== 'object') {
    return { blocks, excerpt: '', seoMetaDescription: '', keyInsights: [] };
  }

  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  let paragraphCursor = 0;
  const repairedItems = Array.isArray(repair.key_insights)
    ? repair.key_insights.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

  const mapBlocks = (input: ContentBlock[]): ContentBlock[] => input.map((block) => {
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column) => ({
          ...column,
          blocks: mapBlocks(column.blocks),
        })),
      };
    }

    if (block.type === 'paragraph') {
      const nextEntry = paragraphEntries[paragraphCursor++];
      const html =
        typeof nextEntry === 'string' ? nextEntry :
        typeof nextEntry?.html === 'string' ? nextEntry.html :
        '';
      if (html.trim()) return { ...block, html };
    }

    if (block.type === 'key_insights') {
      if (repairedItems.length > 0) {
        return { ...block, items: block.items.map((_, index) => repairedItems[index] ?? '') };
      }
    }

    if (block.type === 'summary') {
      const summaryBody = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';
      if (summaryBody) return { ...block, body: summaryBody };
    }

    if (block.type === 'references') {
      const refs = Array.isArray(repair.references)
        ? repair.references
            .map((ref) => ({
              id: uuid(),
              title: typeof ref === 'string' ? ref.trim() : String(ref?.title ?? ref?.text ?? '').trim(),
              url: typeof ref === 'string' ? '' : String(ref?.url ?? ref?.href ?? '').trim(),
            }))
            .filter((ref) => ref.title || ref.url)
        : [];
      if (refs.length > 0) {
        return {
          ...block,
          items: block.items.map((_, index) => refs[index] ?? { id: uuid(), title: '', url: '' }),
        };
      }
    }

    return block;
  });

  const repairedBlocks = mapBlocks(blocks);

  return {
    blocks: repairedBlocks,
    excerpt: typeof repair.excerpt === 'string' ? repair.excerpt.trim() : '',
    seoMetaDescription: typeof repair.seo_meta_description === 'string' ? repair.seo_meta_description.trim() : '',
    keyInsights: Array.isArray(repair.key_insights)
      ? repair.key_insights.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [],
  };
}

export function applyTemplateStructuredRepair(
  blocks: ContentBlock[],
  repair: {
    excerpt?: string;
    seo_meta_description?: string;
    paragraphs?: unknown;
    lists?: unknown;
    summary_body?: string;
    references?: unknown;
  } | null | undefined,
): { blocks: ContentBlock[]; excerpt: string; seoMetaDescription: string } {
  if (!repair || typeof repair !== 'object') {
    return { blocks, excerpt: '', seoMetaDescription: '' };
  }

  const paragraphEntries = Array.isArray(repair.paragraphs) ? repair.paragraphs : [];
  const listEntries = Array.isArray(repair.lists) ? repair.lists : [];
  let paragraphCursor = 0;
  let listCursor = 0;

  const mapBlocks = (input: ContentBlock[]): ContentBlock[] => input.map((block) => {
    if (block.type === 'columns') {
      return {
        ...block,
        columns: block.columns.map((column) => ({
          ...column,
          blocks: mapBlocks(column.blocks),
        })),
      };
    }

    if (block.type === 'paragraph') {
      const nextEntry = paragraphEntries[paragraphCursor++];
      const html =
        typeof nextEntry === 'string' ? nextEntry :
        typeof nextEntry?.html === 'string' ? nextEntry.html :
        '';
      if (html.trim()) return { ...block, html };
    }

    if (block.type === 'list') {
      const nextList = listEntries[listCursor++];
      const repairedItems = Array.isArray(nextList)
        ? nextList.map((item) => String(item ?? '').trim()).filter(Boolean)
        : Array.isArray(nextList?.items)
        ? nextList.items.map((item: any) => String(typeof item === 'string' ? item : item?.text ?? '').trim()).filter(Boolean)
        : [];
      if (repairedItems.length > 0) {
        return {
          ...block,
          items: block.items.map((existing, index) => ({
            ...existing,
            text: repairedItems[index] ?? existing.text,
          })),
        };
      }
    }

    if (block.type === 'summary') {
      const summaryBody = typeof repair.summary_body === 'string' ? repair.summary_body.trim() : '';
      if (summaryBody) return { ...block, body: summaryBody };
    }

    if (block.type === 'references') {
      const refs = Array.isArray(repair.references)
        ? repair.references
            .map((ref) => ({
              id: uuid(),
              title: typeof ref === 'string' ? ref.trim() : String(ref?.title ?? ref?.text ?? '').trim(),
              url: typeof ref === 'string' ? '' : String(ref?.url ?? ref?.href ?? '').trim(),
            }))
            .filter((ref) => ref.title || ref.url)
        : [];
      if (refs.length > 0) {
        return {
          ...block,
          items: block.items.map((_, index) => refs[index] ?? { id: uuid(), title: '', url: '' }),
        };
      }
    }

    return block;
  });

  const repairedBlocks = mapBlocks(blocks);

  return {
    blocks: repairedBlocks,
    excerpt: typeof repair.excerpt === 'string' ? repair.excerpt.trim() : '',
    seoMetaDescription: typeof repair.seo_meta_description === 'string' ? repair.seo_meta_description.trim() : '',
  };
}

// ── Paragraph targets ─────────────────────────────────────────────────────────

export type ParagraphTarget = {
  headingContext: string;
  hint: string;
  currentHtml: string;
  currentWords: number;
};

export function collectParagraphTargets(blocks: ContentBlock[]): ParagraphTarget[] {
  const targets: ParagraphTarget[] = [];

  const walk = (input: ContentBlock[], currentHeading: string) => {
    let headingContext = currentHeading;

    for (const block of input) {
      if (block.type === 'heading') {
        const nextHeading = String(block.text || block.hint || '').trim();
        if (nextHeading) headingContext = nextHeading;
        continue;
      }

      if (block.type === 'columns') {
        for (const column of block.columns) {
          walk(column.blocks, headingContext);
        }
        continue;
      }

      if (block.type === 'paragraph') {
        const currentHtml = String(block.html ?? '');
        const currentWords = stripHtmlForWordCount(currentHtml).split(/\s+/).filter(Boolean).length;
        targets.push({
          headingContext,
          hint: String(block.hint ?? '').trim(),
          currentHtml,
          currentWords,
        });
      }
    }
  };

  walk(blocks, '');
  return targets;
}

// ── Quality scoring ───────────────────────────────────────────────────────────

export function assessBlogQualityScore(
  blocks: ContentBlock[],
  meta: {
    title: string;
    excerpt: string;
    seo_meta_title: string;
    seo_meta_description: string;
    tags: string[];
    target_word_count: number;
    format_type?: BlogFormatType;
  },
) {
  return calculateContentQualityScore(blocks, {
    title: meta.title,
    excerpt: meta.excerpt,
    seo_meta_title: meta.seo_meta_title,
    seo_meta_description: meta.seo_meta_description,
    tags: meta.tags,
    target_word_count: meta.target_word_count,
    format_type: meta.format_type,
    content_type: 'blog',
  });
}
