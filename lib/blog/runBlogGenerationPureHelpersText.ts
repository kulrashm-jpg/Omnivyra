/** Part of runBlogGenerationPureHelpers (Agent-B split — barrel keeps the original path). */
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

export const DEPTH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'by', 'for', 'from', 'how', 'if',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'there', 'these',
  'this', 'to', 'was', 'were', 'will', 'with', 'your', 'you',
]);

export function extractDepthTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !DEPTH_STOP_WORDS.has(token));
}

export function blockToDepthText(block: ContentBlock): string {
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

export function splitDepthSentences(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20);
}

export function hasSpecificDepthSignal(text: string): boolean {
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

export function detectShallowDepthElements(text: string): string[] {
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

export type DepthRequirement = {
  label: string;
  patterns: RegExp[];
};

export type DepthElementRule = {
  label: string;
  patterns: RegExp[];
};

export const SPECIFIC_DEPTH_ELEMENT_RULES: DepthElementRule[] = [
  { label: 'case study', patterns: [/\bcase study\b/i, /\bbefore\b.*\bafter\b/i, /\bcustomer story\b/i] },
  { label: 'framework', patterns: [/\bframework\b/i, /\bplaybook\b/i, /\bchecklist\b/i, /\b3-step\b/i, /\b4-step\b/i, /\bstep-by-step\b/i] },
  { label: 'comparison', patterns: [/\bcompare\b/i, /\bcomparison\b/i, /\bversus\b/i, /\bvs\.?\b/i, /\balternative\b/i] },
  { label: 'example', patterns: [/\bfor example\b/i, /\bfor instance\b/i, /\bexample\b/i] },
  { label: 'scenario', patterns: [/\bscenario\b/i, /\bin practice\b/i, /\bconsider\b/i, /\bimagine\b/i, /\bif your\b/i, /\bwhen a\b/i, /\bwhen teams\b/i] },
];

export function getTierDepthRequirements(targetWords: number): DepthRequirement[] {
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

export function getSectionDepthSignals(text: string): {
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

export function buildSectionBodies(blocks: ContentBlock[]): string[] {
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

export function isMustIncludeCovered(point: string, contentText: string, contentTokens: Set<string>): boolean {
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

