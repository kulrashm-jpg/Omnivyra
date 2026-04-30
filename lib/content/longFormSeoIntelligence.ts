import type { ContentBlock } from '../blog/blockTypes';
import type { CompanyContext } from '../blog/runBlogGeneration';
import { contentTypeConfig, type LongFormContentType } from './longFormContentTypeConfig';
import type { ContentPlan, SectionGenerationResult } from './longFormPlanningEngine';
import type { PerformanceInsights } from './longFormPerformanceLearning';

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'comparison' | 'navigational';

export interface TopicEntityMap {
  primaryTopic: string;
  relatedEntities: string[];
  subtopics: string[];
  semanticVariations: string[];
}

export interface SerpStructureHints {
  requiredCoverage: Array<'What' | 'How' | 'Why' | 'Examples'>;
  preferredSectionTypes: string[];
  requiredStructures: string[];
  intentGuidance: string;
}

export interface ContentScore {
  seo: number;
  aeo: number;
  geo: number;
  differentiation: number;
  readability: number;
  overall: number;
  performanceWeight: {
    seo: number;
    aeo: number;
    geo: number;
    differentiation: number;
    readability: number;
  };
}

export interface ContentImprovementHooks {
  weak_sections: Array<{ section_title: string; reasons: string[] }>;
  missing_entities: string[];
  low_insight_areas: string[];
}

export interface ScoringThresholds {
  seo: number;
  aeo: number;
  geo: number;
}

export const DEFAULT_CONTENT_SCORE_THRESHOLDS: ScoringThresholds = {
  seo: 72,
  aeo: 72,
  geo: 72,
};

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'between',
  'content', 'from', 'have', 'into', 'over', 'that', 'their', 'there', 'these',
  'this', 'through', 'what', 'when', 'where', 'which', 'with', 'your',
]);

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unique(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = value.trim().replace(/\s+/g, ' ');
    const key = normalize(cleaned);
    if (!cleaned || key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= limit) break;
  }
  return output;
}

function topicTokens(topic: string): string[] {
  return unique(
    normalize(topic)
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOP_WORDS.has(token)),
    8,
  );
}

function splitContextPhrases(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[;,.\n|]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2);
}

export function classifySearchIntent(input: {
  topic: string;
  contentType: LongFormContentType;
  formatType?: string;
  intent?: string;
  goalType?: string;
}): SearchIntent {
  const haystack = normalize([
    input.topic,
    input.formatType,
    input.intent,
    input.goalType,
    input.contentType,
  ].filter(Boolean).join(' '));

  if (/\b(vs|versus|compare|comparison|alternative|alternatives|pros cons|which is better)\b/.test(haystack)) {
    return 'comparison';
  }
  if (/\b(pricing|price|demo|buy|purchase|signup|subscribe|trial|book|hire)\b/.test(haystack)) {
    return 'transactional';
  }
  if (/\b(best|top|review|reviews|benefit|benefits|evaluate|evaluation|vendor|solution|tool|software)\b/.test(haystack)) {
    return 'commercial';
  }
  if (/\b(login|homepage|official|brand|company|support|contact)\b/.test(haystack)) {
    return 'navigational';
  }
  return 'informational';
}

export function expandTopicEntities(input: {
  topic: string;
  contentType: LongFormContentType;
  formatType?: string;
  cluster?: string;
  seoContext?: string;
  companyContext?: CompanyContext;
}): TopicEntityMap {
  const tokens = topicTokens(input.topic);
  const company = input.companyContext;
  const related = unique([
    input.cluster || '',
    company?.industry || '',
    company?.audience || '',
    company?.productsServices || '',
    company?.uniqueValue || '',
    ...(company?.authorityDomains || []),
    ...splitContextPhrases(company?.competitiveAdvantages),
    ...splitContextPhrases(input.seoContext),
    ...tokens.map((token) => `${token} strategy`),
  ], 10);

  const subtopics = unique([
    `${input.topic} definition`,
    `${input.topic} framework`,
    `${input.topic} implementation`,
    `${input.topic} examples`,
    `${input.topic} mistakes`,
    ...tokens.map((token) => `${token} use cases`),
  ], 10);

  const semanticVariations = unique([
    `what is ${input.topic}`,
    `how to approach ${input.topic}`,
    `why ${input.topic} matters`,
    `${input.topic} examples`,
    `${input.topic} comparison`,
    `${input.topic} playbook`,
    `${input.topic} framework`,
    `${contentTypeConfig[input.contentType].structureStyle}`,
  ], 10);

  return {
    primaryTopic: input.topic.trim(),
    relatedEntities: related,
    subtopics,
    semanticVariations,
  };
}

export function buildSerpStructureHints(searchIntent: SearchIntent): SerpStructureHints {
  const base = {
    requiredCoverage: ['What', 'How', 'Why', 'Examples'] as Array<'What' | 'How' | 'Why' | 'Examples'>,
    requiredStructures: ['definitions', 'FAQs'],
  };

  if (searchIntent === 'commercial') {
    return {
      ...base,
      preferredSectionTypes: ['explanation', 'framework', 'comparison', 'example', 'insight'],
      requiredStructures: [...base.requiredStructures, 'evaluation criteria', 'decision support'],
      intentGuidance: 'Commercial intent: emphasize benefits, evaluation criteria, tradeoffs, and decision support.',
    };
  }
  if (searchIntent === 'comparison') {
    return {
      ...base,
      preferredSectionTypes: ['comparison', 'framework', 'example', 'insight'],
      requiredStructures: [...base.requiredStructures, 'comparison table', 'tradeoffs', 'verdict'],
      intentGuidance: 'Comparison intent: use structured comparisons, tradeoffs, criteria, and scenario-based recommendations.',
    };
  }
  if (searchIntent === 'transactional') {
    return {
      ...base,
      preferredSectionTypes: ['application', 'framework', 'example', 'insight'],
      requiredStructures: [...base.requiredStructures, 'buyer readiness', 'implementation path'],
      intentGuidance: 'Transactional intent: clarify readiness, action path, proof, and next decision.',
    };
  }
  if (searchIntent === 'navigational') {
    return {
      ...base,
      preferredSectionTypes: ['explanation', 'application', 'summary'],
      requiredStructures: [...base.requiredStructures, 'brand context', 'next steps'],
      intentGuidance: 'Navigational intent: make entity context, brand relevance, and next steps clear.',
    };
  }
  return {
    ...base,
    preferredSectionTypes: ['explanation', 'application', 'example', 'insight'],
    requiredStructures: [...base.requiredStructures, 'step-by-step guide', 'examples'],
    intentGuidance: 'Informational intent: explain, educate, show examples, and make the concept easy to apply.',
  };
}

function containsEntity(text: string, entity: string): boolean {
  const normalizedText = normalize(text);
  const normalizedEntity = normalize(entity);
  if (!normalizedEntity) return false;
  if (normalizedText.includes(normalizedEntity)) return true;
  const parts = normalizedEntity.split(/\s+/).filter((part) => part.length > 3);
  return parts.length > 0 && parts.every((part) => normalizedText.includes(part));
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + ((text.match(pattern) || []).length), 0);
}

function scoreEntityDistribution(
  sections: SectionGenerationResult[],
  entityMap: TopicEntityMap,
): { score: number; missingEntities: string[]; sectionCoverage: Map<string, string[]> } {
  const entities = unique([
    entityMap.primaryTopic,
    ...entityMap.relatedEntities,
    ...entityMap.subtopics,
    ...entityMap.semanticVariations,
  ], 16);
  const sectionCoverage = new Map<string, string[]>();
  const covered = new Set<string>();

  for (const section of sections) {
    const text = stripHtml(section.html);
    const matches = entities.filter((entity) => containsEntity(text, entity)).slice(0, 4);
    sectionCoverage.set(section.section_title, matches);
    matches.forEach((entity) => covered.add(normalize(entity)));
  }

  const missingEntities = entities.filter((entity) => !covered.has(normalize(entity))).slice(0, 8);
  const majorSectionCoverage = sections.length === 0
    ? 0
    : sections.filter((section) => (sectionCoverage.get(section.section_title) || []).length > 0).length / sections.length;
  const entityCoverage = entities.length === 0 ? 1 : (entities.length - missingEntities.length) / entities.length;
  return {
    score: clampScore((majorSectionCoverage * 55) + (entityCoverage * 45)),
    missingEntities,
    sectionCoverage,
  };
}

function scoreBrandVoice(text: string, companyContext?: CompanyContext): number {
  if (!companyContext) return 62;
  const anchors = unique([
    companyContext.companyName || '',
    companyContext.industry || '',
    companyContext.audience || '',
    companyContext.uniqueValue || '',
    companyContext.coreProblemStatement || '',
    companyContext.productsServices || '',
    companyContext.competitiveAdvantages || '',
    ...(companyContext.authorityDomains || []),
  ], 10);
  if (anchors.length === 0) return 62;
  const matches = anchors.filter((anchor) => containsEntity(text, anchor)).length;
  return clampScore(45 + (matches / anchors.length) * 55);
}

function scoreReadability(text: string): number {
  const sentences = text.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length === 0) return 50;
  const wordCounts = sentences.map((sentence) => sentence.split(/\s+/).filter(Boolean).length);
  const avg = wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length;
  const variance = wordCounts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / wordCounts.length;
  const avgScore = avg <= 24 ? 95 : avg <= 32 ? 82 : avg <= 42 ? 65 : 48;
  const variationScore = variance >= 16 && variance <= 160 ? 92 : variance < 16 ? 68 : 76;
  const paragraphCount = (text.match(/\n|<\/p>/g) || []).length;
  const flowScore = paragraphCount >= 4 ? 88 : 72;
  return clampScore((avgScore * 0.45) + (variationScore * 0.35) + (flowScore * 0.2));
}

function hasInternalLink(contentBlocks: unknown[]): boolean {
  return JSON.stringify(contentBlocks || []).includes('href') || JSON.stringify(contentBlocks || []).includes('url');
}

export function scoreLongFormContent(input: {
  plan: ContentPlan;
  sections: SectionGenerationResult[];
  contentHtml: string;
  contentBlocks: ContentBlock[] | unknown[];
  contentType: LongFormContentType;
  searchIntent: SearchIntent;
  topicEntityMap: TopicEntityMap;
  companyContext?: CompanyContext;
  performanceInsights?: PerformanceInsights;
}): { contentScore: ContentScore; improvementHooks: ContentImprovementHooks } {
  const text = stripHtml(input.contentHtml);
  const lowerHtml = input.contentHtml.toLowerCase();
  const h2Count = (lowerHtml.match(/<h2/g) || []).length;
  const h3Count = (lowerHtml.match(/<h3/g) || []).length;
  const entityDistribution = scoreEntityDistribution(input.sections, input.topicEntityMap);
  const keywordCoverage = containsEntity(text, input.topicEntityMap.primaryTopic) ? 100 : 55;
  const headingStructure = h2Count >= Math.min(4, input.sections.length) && h3Count >= 2 ? 92 : h2Count >= 3 ? 78 : 58;
  const internalLinking = hasInternalLink(input.contentBlocks) || contentTypeConfig[input.contentType].linkingStrategy === 'minimal' ? 85 : 60;
  const seo = clampScore((keywordCoverage * 0.3) + (headingStructure * 0.25) + (entityDistribution.score * 0.3) + (internalLinking * 0.15));

  const faqCount = input.plan.faq.length;
  const conciseAnswers = input.plan.faq.filter((item) => item.answer.split(/\s+/).length <= 45).length;
  const directAnswers = countMatches(lowerHtml, [/direct answer/g, /what is /g, /how to /g]);
  const snippetSignals = countMatches(lowerHtml, [/what /g, /how /g, /why /g, /example/g]);
  const aeo = clampScore(
    ((faqCount >= 4 ? 95 : 55) * 0.3)
    + ((faqCount > 0 ? (conciseAnswers / faqCount) * 100 : 45) * 0.25)
    + ((directAnswers >= 2 ? 95 : directAnswers === 1 ? 72 : 45) * 0.25)
    + ((snippetSignals >= 6 ? 90 : snippetSignals >= 3 ? 72 : 50) * 0.2),
  );

  const frameworkPresent = input.plan.framework.name && containsEntity(text, input.plan.framework.name);
  const insightSections = input.sections.filter((section) => (
    /common assumption|most teams|mistake|miss|counterintuitive|non-obvious|instead/i.test(section.html)
  ));
  const brandVoice = scoreBrandVoice(text, input.companyContext);
  const geo = clampScore(
    ((frameworkPresent ? 95 : 45) * 0.35)
    + ((Math.min(1, insightSections.length / 2) * 100) * 0.3)
    + (brandVoice * 0.25)
    + ((input.plan.framework.components.length >= 3 ? 92 : 65) * 0.1),
  );

  const readability = scoreReadability(input.contentHtml);
  const differentiation = geo;
  const performanceWeight = buildAdaptiveWeights(input.performanceInsights);
  const overall = clampScore(
    (seo * performanceWeight.seo)
    + (aeo * performanceWeight.aeo)
    + (geo * performanceWeight.geo)
    + (differentiation * performanceWeight.differentiation)
    + (readability * performanceWeight.readability),
  );
  const weakSections = input.sections.map((section) => {
    const reasons: string[] = [];
    const entities = entityDistribution.sectionCoverage.get(section.section_title) || [];
    if (entities.length === 0) reasons.push('missing entity coverage');
    if (!/example|use case|scenario|for example|in practice/i.test(section.html)) reasons.push('low example density');
    if (!/common assumption|most teams|mistake|miss|counterintuitive|non-obvious|instead/i.test(section.html)) reasons.push('low insight density');
    return { section_title: section.section_title, reasons };
  }).filter((section) => section.reasons.length > 0);

  return {
    contentScore: { seo, aeo, geo, differentiation, readability, overall, performanceWeight },
    improvementHooks: {
      weak_sections: weakSections,
      missing_entities: entityDistribution.missingEntities,
      low_insight_areas: weakSections
        .filter((section) => section.reasons.includes('low insight density'))
        .map((section) => section.section_title),
    },
  };
}

function buildAdaptiveWeights(insights?: PerformanceInsights): ContentScore['performanceWeight'] {
  const base = {
    seo: 0.3,
    aeo: 0.22,
    geo: 0.24,
    differentiation: 0.1,
    readability: 0.14,
  };
  if (!insights || insights.confidence === 'none') return base;

  const adjusted = {
    seo: Math.max(0.05, base.seo + insights.scoringWeightAdjustments.seo),
    aeo: Math.max(0.05, base.aeo + insights.scoringWeightAdjustments.aeo),
    geo: Math.max(0.05, base.geo + insights.scoringWeightAdjustments.geo),
    differentiation: Math.max(0.05, base.differentiation + insights.scoringWeightAdjustments.differentiation),
    readability: Math.max(0.05, base.readability + insights.scoringWeightAdjustments.readability),
  };
  const total = adjusted.seo + adjusted.aeo + adjusted.geo + adjusted.differentiation + adjusted.readability;
  return {
    seo: Number((adjusted.seo / total).toFixed(3)),
    aeo: Number((adjusted.aeo / total).toFixed(3)),
    geo: Number((adjusted.geo / total).toFixed(3)),
    differentiation: Number((adjusted.differentiation / total).toFixed(3)),
    readability: Number((adjusted.readability / total).toFixed(3)),
  };
}

export function scoreNeedsRepair(score: ContentScore, thresholds: ScoringThresholds = DEFAULT_CONTENT_SCORE_THRESHOLDS): boolean {
  return score.seo < thresholds.seo || score.aeo < thresholds.aeo || score.geo < thresholds.geo;
}
